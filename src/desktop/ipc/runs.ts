import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { runAgent } from "../../agent/loop.js";
import { threadSubagent, type SubagentProfile } from "../../agent/subagents/profile.js";
import { ProviderCapacity } from "../../agent/subagents/capacity.js";
import { runSubagents, type SubagentProviderRoute } from "../../agent/subagents/runner.js";
import { delegateTaskTool } from "../../agent/subagents/tool.js";
import type { Trace } from "../../agent/trace.js";
import type { AttachmentStore } from "../../attachments/store.js";
import { MAX_ATTACHMENTS } from "../../attachments/store.js";
import type { AttachmentRef } from "../../attachments/types.js";
import { describeImages, type ImageUnderstandingProfile } from "../../attachments/vision.js";
import { imageInspectionTool } from "./image-inspection.js";
import { activeCapabilities, type ActiveCapabilities } from "../../capabilities/active.js";
import { compactionThreshold, type CompactionMode } from "../../context/budget.js";
import { compactionBoundary, type ContextCompactor } from "../../context/compaction.js";
import { initialMessages } from "../../context/prompt.js";
import { projectContext } from "../../context/projection.js";
import { estimateContextCharacters, estimateContextTokens } from "../../context/budget.js";
import { probeNativeSandbox } from "../../execution/native/sandbox.js";
import { LocalWorkspace, type CommandApprovalRequest } from "../../execution/workspace.js";
import {
  isReasoningEffort,
  type ModelProvider,
  type ProviderConnection,
  type ReasoningEffort,
} from "../../providers/provider.js";
import type { CommandApprovalDecision, Message, RunEvent } from "../../protocol.js";
import {
  withRecoveredPlan,
  type PlanItem,
} from "../../tools/plan.js";
import type { DesktopState, StartRunInput } from "../api.js";
import type { DesktopStore } from "../store.js";

export type RunIpc = {
  runningThreadIds(): string[];
  unsafeThreadIds(): string[];
  isThreadRunning(threadId: string): boolean;
  isWorkspaceRunning(workspaceId: string): boolean;
  forgetThreads(threadIds: string[]): void;
  stopAll(): void;
};

export function registerRunIpc(options: {
  store: DesktopStore;
  attachments: AttachmentStore;
  compactor: ContextCompactor;
  state: (includeConversation?: boolean) => Promise<DesktopState>;
  capabilities: (
    workspacePath: string,
    connectionId: string,
    model: string,
    explicitlyActive?: string[],
  ) => ActiveCapabilities;
  provider: (
    connectionId: string,
    model: string,
    resolveAttachment: (attachment: AttachmentRef) => ReturnType<AttachmentStore["resolve"]>,
    reasoningEffort?: ReasoningEffort,
  ) => ModelProvider;
  connection(connectionId: string): ProviderConnection;
  settings: () => {
    maxSteps: number;
    providerTimeoutMinutes: number;
    providerRetries: number;
    compactionMode: CompactionMode;
    compactionThreshold: number;
    subagent: SubagentProfile;
    systemPrompt: string;
    disabledTools: string[];
    imageUnderstanding: ImageUnderstandingProfile;
  };
  sendEvent: (threadId: string, event: RunEvent) => void;
}): RunIpc {
  const active = new Map<string, {
    controller: AbortController;
    threadId: string;
    workspaceId: string;
    steering: string[];
    acceptingSteering: boolean;
  }>();
  const unsafe = new Set<string>();
  const providerCapacity = new ProviderCapacity();
  const implementCapacity = new ProviderCapacity();
  const approvals = new Map<string, {
    threadId: string;
    resolve: (decision: CommandApprovalDecision) => void;
  }>();

  const emitPermission = async (threadId: string, event: RunEvent): Promise<void> => {
    await memoryTrace.write(event);
    options.sendEvent(threadId, event);
  };

  const resolveApprovals = (threadId: string, decision: CommandApprovalDecision): void => {
    for (const [approvalId, pending] of approvals) {
      if (pending.threadId !== threadId) continue;
      approvals.delete(approvalId);
      void emitPermission(threadId, { type: "permission.resolved", id: approvalId, decision });
      pending.resolve(decision);
    }
  };

  const requestApproval = async (
    threadId: string,
    request: CommandApprovalRequest,
  ): Promise<CommandApprovalDecision> => {
    const approvalId = randomUUID();
    const event: RunEvent = {
      type: "permission.requested",
      id: approvalId,
      command: request.command,
      cwd: request.cwd,
      reason: request.reason.slice(0, 2000),
    };
    const decision = new Promise<CommandApprovalDecision>((resolve) => {
      approvals.set(approvalId, { threadId, resolve });
    });
    await emitPermission(threadId, event);
    return decision;
  };

  ipcMain.handle("desktop:start-run", async (_event, rawInput: unknown): Promise<void> => {
    const input = parseStartRunInput(rawInput);
    const state = await options.store.state();
    const selectedWorkspace = state.workspaces.find(
      (workspace) => workspace.threads.some((thread) => thread.id === input.threadId),
    );
    if (!selectedWorkspace) throw new Error("The selected thread no longer exists");
    const selectedThread = selectedWorkspace.threads.find((thread) => thread.id === input.threadId);
    if (!selectedThread) throw new Error("The selected thread no longer exists");
    if (active.has(input.threadId)) throw new Error("This thread is already running");
    const unrestricted = unsafe.has(input.threadId);
    if (!unrestricted) {
      const sandbox = await probeNativeSandbox();
      if (!sandbox.available) throw new Error(sandbox.detail);
    }

    const settings = options.settings();
    await options.store.setThreadModel(
      input.threadId,
      input.providerConnectionId,
      input.model,
      input.reasoningEffort ?? "",
    );
    const controller = new AbortController();
    const threadId = input.threadId;
    const workspace = new LocalWorkspace(
      selectedWorkspace.path,
      unrestricted ? "unsafe" : "restricted",
      (request) => requestApproval(threadId, request),
    );
    const run = {
      controller,
      threadId,
      workspaceId: selectedWorkspace.id,
      steering: [] as string[],
      acceptingSteering: true,
    };
    active.set(threadId, run);
    const baseCapabilities = options.capabilities(
      selectedWorkspace.path,
      input.providerConnectionId,
      input.model,
      input.explicitlyActiveTools,
    );
    const configuredSubagent = threadSubagent(settings.subagent, selectedThread.subagentMode);
    const subagent = configuredSubagent
      ? {
          ...configuredSubagent,
          providerConnectionId: configuredSubagent.modelMode === "main"
            ? input.providerConnectionId
            : configuredSubagent.providerConnectionId,
          model: configuredSubagent.modelMode === "main" ? input.model : configuredSubagent.model,
        }
      : null;
    let capabilities = subagent && !settings.disabledTools.includes("delegate_task")
      ? activeCapabilities([
          ...baseCapabilities.tools,
          {
            source: { type: "built-in" },
            tool: delegateTaskTool(async (request, onUpdate) => {
              const releaseImplement = request.profile === "implement"
                ? await implementCapacity.acquire(selectedWorkspace.id, 1, controller.signal)
                : () => {};
              try {
                return await runSubagents({
                  ...request,
                  provider: (signal) => providerRoute(
                    subagent.providerConnectionId,
                    subagent.model,
                    providerCapacity,
                    signal,
                    options.connection,
                    (connectionId, model) => options.provider(
                      connectionId,
                      model,
                      (attachment) => options.attachments.resolve(attachment),
                    ),
                    {
                      overflowConnectionId: subagent.overflowProviderConnectionId,
                      overflowModel: subagent.overflowModel,
                    },
                  ),
                  workspace,
                  signal: controller.signal,
                  maxSteps: subagent.maxSteps,
                  ...(onUpdate ? { onUpdate } : {}),
                });
              } finally {
                releaseImplement();
              }
            }),
          },
        ])
      : baseCapabilities;
    let toolSpecs = capabilities.tools.map(({ tool }) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
    const compactionInput = {
      threadId,
      providerConnectionId: input.providerConnectionId,
      model: input.model,
      contextLength: input.contextLength,
      tools: toolSpecs,
    };
    let conversation: Message[];
    let initialPlan: PlanItem[] | null = null;
    let nextSequence: number;

    try {
      if (toolSpecs.some((tool) => tool.name === "update_plan")) {
        initialPlan = await options.store.activePlan(threadId);
      }
      const lastSequence = await options.store.lastSequence(threadId);
      if (lastSequence < 0) {
        const initial = initialMessages(input.task, input.attachments, settings.systemPrompt);
        await options.store.appendMessage(threadId, 0, initial[0]!);
        await options.store.appendMessage(threadId, 1, initial[1]!);
        conversation = [initial[0]!];
        nextSequence = 2;
      } else {
        let checkpoint = await options.store.context.latest(threadId);
        let entries = await options.store.context.entries(threadId, checkpoint);
        let projection = projectContext(entries, checkpoint, toolSpecs);
        options.compactor.schedule({ ...compactionInput, throughSequence: compactionBoundary(entries) });
        const threshold = compactionThreshold(
          input.contextLength,
          settings.compactionMode,
          settings.compactionThreshold,
        );
        if (projection.estimatedTokens >= input.contextLength * threshold / 100) {
          await options.compactor.ready(threadId);
          checkpoint = await options.store.context.latest(threadId);
          entries = await options.store.context.entries(threadId, checkpoint);
          projection = projectContext(entries, checkpoint, toolSpecs);
        }
        conversation = projection.messages;
        const userMessage: Message = {
          role: "user",
          content: input.task,
          ...(input.attachments?.length ? { attachments: input.attachments } : {}),
        };
        nextSequence = lastSequence + 1;
        await options.store.appendMessage(threadId, nextSequence, userMessage);
        nextSequence += 1;
        if (checkpoint) {
          const injectedCharacters = estimateContextCharacters([...conversation, userMessage], toolSpecs);
          await options.store.context.markApplied(checkpoint.id, injectedCharacters, lastSequence);
          options.sendEvent(threadId, {
            type: "context.applied",
            id: checkpoint.id,
            injectedCharacters,
            estimatedTokens: estimateContextTokens(injectedCharacters),
          });
        }
      }
    } catch (error) {
      active.delete(threadId);
      throw error;
    }

    let modelTask = input.task;
    let modelAttachments = input.attachments;
    if (!input.imageInputSupported && hasContextImages(conversation, input.attachments)) {
      const profile = settings.imageUnderstanding;
      if (!profile.enabled || !profile.providerConnectionId || !profile.model) {
        active.delete(threadId);
        throw new Error("The selected model cannot read images. Configure Image understanding in Agent settings.");
      }
      try {
        const connection = options.connection(profile.providerConnectionId);
        const provider = providerCapacity.limit(
          options.provider(
            connection.id,
            profile.model,
            (attachment) => options.attachments.resolve(attachment),
          ),
          connection.requestLimit,
        );
        const currentUser: Message = {
          role: "user",
          content: input.task,
          ...(input.attachments?.length ? { attachments: input.attachments } : {}),
        };
        const contextImages = contextImageAttachments([...conversation, currentUser]);
        const projected = await describeImages({
          messages: [...conversation, currentUser],
          profile,
          attachments: options.attachments,
          provider,
          signal: controller.signal,
          onActivity: (activity) => options.sendEvent(threadId, {
            type: "image.understanding.completed",
            imageName: activity.attachment.name,
            kind: activity.kind,
            cached: activity.cached,
            model: activity.model,
            providerId: activity.providerId,
            providerConnectionId: activity.providerConnectionId,
            ...(activity.usage ? { usage: activity.usage } : {}),
            ...(activity.durationMs === undefined ? {} : { durationMs: activity.durationMs }),
            ...(activity.question ? { question: activity.question } : {}),
          }),
        });
        const projectedUser = projected.at(-1)!;
        if (projectedUser.role !== "user") throw new Error("Image interpretation lost the current user message");
        conversation = projected.slice(0, -1);
        modelTask = projectedUser.content;
        modelAttachments = projectedUser.attachments;
        capabilities = activeCapabilities([
          ...capabilities.tools,
          {
            source: { type: "built-in" },
            tool: imageInspectionTool({
              attachments: contextImages,
              profile,
              attachmentStore: options.attachments,
              provider,
              signal: controller.signal,
              onActivity: (activity) => options.sendEvent(threadId, {
                type: "image.understanding.completed",
                imageName: activity.attachment.name,
                kind: activity.kind,
                cached: activity.cached,
                model: activity.model,
                providerId: activity.providerId,
                providerConnectionId: activity.providerConnectionId,
                ...(activity.usage ? { usage: activity.usage } : {}),
                ...(activity.durationMs === undefined ? {} : { durationMs: activity.durationMs }),
                ...(activity.question ? { question: activity.question } : {}),
              }),
            }),
          },
        ]);
        toolSpecs = capabilities.tools.map(({ tool }) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }));
        compactionInput.tools = toolSpecs;
      } catch (error) {
        active.delete(threadId);
        throw error;
      }
    }

    if (initialPlan) modelTask = withRecoveredPlan(modelTask, initialPlan);

    let mainRoute: ProviderRoute;
    try {
      mainRoute = await providerRoute(
        input.providerConnectionId,
        input.model,
        providerCapacity,
        controller.signal,
        options.connection,
        (connectionId, model) => options.provider(
          connectionId,
          model,
          (attachment) => options.attachments.resolve(attachment),
          input.reasoningEffort,
        ),
        {
          foreground: true,
          onWait: (connection, active) => options.sendEvent(threadId, {
            type: "provider.waiting",
            connectionName: connection.name,
            active,
            limit: connection.requestLimit,
          }),
          onReady: () => options.sendEvent(threadId, { type: "provider.ready" }),
        },
      );
    } catch (error) {
      active.delete(threadId);
      throw error;
    }
    void runAgent({
      task: modelTask,
      provider: mainRoute.provider,
      capabilities,
      workspace,
      trace: memoryTrace,
      signal: controller.signal,
      history: conversation,
      ...(modelAttachments?.length ? { attachments: modelAttachments } : {}),
      maxSteps: settings.maxSteps,
      ...(initialPlan ? { initialPlan } : {}),
      onPlan: (items) => options.store.setActivePlan(threadId, items),
      sequenceStart: nextSequence,
      onMessage: (message, sequence) => options.store.appendMessage(threadId, sequence, message),
      takeSteering: () => run.steering.splice(0),
      systemPrompt: settings.systemPrompt,
      onEvent: (event) => {
        if (event.type === "run.completed" || event.type === "run.failed") run.acceptingSteering = false;
        options.sendEvent(threadId, event);
      },
    }).then(async () => {
      const entries = await options.store.entries(threadId);
      options.sendEvent(threadId, {
        type: "run.persisted",
        entries: entries.map((entry) => ({ sequence: entry.sequence, entryId: entry.id })),
      });
      options.compactor.schedule(compactionInput);
    }).catch(() => undefined).finally(() => {
      mainRoute.release();
      if (active.get(threadId) === run) active.delete(threadId);
    });
  });

  ipcMain.handle("desktop:restore-thread", async (
    _event,
    rawThreadId: unknown,
    rawSequence: unknown,
  ): Promise<DesktopState> => {
    const threadId = id(rawThreadId, "Thread");
    if (!Number.isInteger(rawSequence) || Number(rawSequence) < 0) throw new Error("Invalid restore point");
    if (active.has(threadId)) throw new Error("Wait for the current run to finish before restoring");
    await options.compactor.ready(threadId);
    await options.store.restoreThread(threadId, Number(rawSequence));
    return options.state();
  });

  ipcMain.handle("desktop:steer-run", (_event, rawThreadId: unknown, rawMessage: unknown): boolean => {
    const run = active.get(id(rawThreadId, "Thread"));
    const message = steeringMessage(rawMessage);
    if (!run?.acceptingSteering) return false;
    run.steering.push(message);
    return true;
  });

  ipcMain.handle("desktop:stop-run", (_event, value: unknown): boolean => {
    const run = active.get(id(value, "Thread"));
    if (!run) return false;
    run.controller.abort();
    resolveApprovals(run.threadId, "deny");
    return true;
  });

  ipcMain.handle("desktop:set-thread-unsafe", async (
    _event,
    rawThreadId: unknown,
    value: unknown,
  ): Promise<DesktopState> => {
    const threadId = id(rawThreadId, "Thread");
    if (typeof value !== "boolean") throw new Error("Unsafe state must be a boolean");
    if (active.has(threadId)) throw new Error("Execution mode cannot change during a run");
    if (value) unsafe.add(threadId);
    else unsafe.delete(threadId);
    return options.state(false);
  });

  ipcMain.handle("desktop:resolve-command-approval", async (
    _event,
    rawId: unknown,
    rawDecision: unknown,
  ): Promise<DesktopState> => {
    const approvalId = id(rawId, "Approval");
    const decision = approvalDecision(rawDecision);
    const pending = approvals.get(approvalId);
    if (!pending) throw new Error("This approval request is no longer active");
    approvals.delete(approvalId);
    if (decision === "thread") unsafe.add(pending.threadId);
    await emitPermission(pending.threadId, { type: "permission.resolved", id: approvalId, decision });
    pending.resolve(decision);
    return options.state(false);
  });

  return {
    runningThreadIds: () => [...active.keys()],
    unsafeThreadIds: () => [...unsafe],
    isThreadRunning: (threadId) => active.has(threadId),
    isWorkspaceRunning: (workspaceId) => [...active.values()].some((run) => run.workspaceId === workspaceId),
    forgetThreads: (threadIds) => threadIds.forEach((threadId) => unsafe.delete(threadId)),
    stopAll: () => {
      for (const run of active.values()) {
        run.controller.abort();
        resolveApprovals(run.threadId, "deny");
      }
    },
  };
}

type ProviderRoute = SubagentProviderRoute;

async function providerRoute(
  connectionId: string,
  model: string,
  capacity: ProviderCapacity,
  signal: AbortSignal,
  connection: (connectionId: string) => ProviderConnection,
  create: (connectionId: string, model: string) => ModelProvider,
  routing: {
    overflowConnectionId?: string;
    overflowModel?: string;
    foreground?: boolean;
    onWait?: (connection: ProviderConnection, active: number) => void;
    onReady?: () => void;
  } = {},
): Promise<ProviderRoute> {
  const primary = connection(connectionId);
  const immediate = capacity.tryAcquire(connectionId, primary.requestLimit);
  if (immediate) {
    return createRoute(
      create,
      capacity,
      primary,
      model,
      immediate,
      {
        ...(routing.foreground ? { foreground: true } : {}),
        onWait: () => routing.onWait?.(primary, capacity.activeCount(connectionId)),
        ...(routing.onReady ? { onReady: routing.onReady } : {}),
      },
    );
  }

  if (routing.overflowConnectionId && routing.overflowModel && routing.overflowConnectionId !== connectionId) {
    const fallback = connection(routing.overflowConnectionId);
    const release = await capacity.acquire(
      fallback.id,
      fallback.requestLimit,
      signal,
    );
    return createRoute(create, capacity, fallback, routing.overflowModel, release, {
      overflowFromConnectionName: primary.name,
    });
  }

  routing.onWait?.(primary, capacity.activeCount(connectionId));
  const release = await capacity.acquire(connectionId, primary.requestLimit, signal, routing.foreground);
  routing.onReady?.();
  return createRoute(
    create,
    capacity,
    primary,
    model,
    release,
    {
      ...(routing.foreground ? { foreground: true } : {}),
      onWait: () => routing.onWait?.(primary, capacity.activeCount(connectionId)),
      ...(routing.onReady ? { onReady: routing.onReady } : {}),
    },
  );
}

function createRoute(
  create: (connectionId: string, model: string) => ModelProvider,
  capacity: ProviderCapacity,
  connection: ProviderConnection,
  model: string,
  release: () => void,
  options: {
    overflowFromConnectionName?: string;
    foreground?: boolean;
    onWait?: () => void;
    onReady?: () => void;
  } = {},
): ProviderRoute {
  try {
    const route = capacity.reserve(
      create(connection.id, model),
      connection.requestLimit,
      release,
      options.foreground,
      options.onWait,
      options.onReady,
    );
    return {
      ...route,
      connectionName: connection.name,
      ...(options.overflowFromConnectionName
        ? { fallbackFromConnectionName: options.overflowFromConnectionName }
        : {}),
    };
  } catch (error) {
    release();
    throw error;
  }
}

const memoryTrace: Trace = { async write(): Promise<void> {} };

function parseStartRunInput(input: unknown): StartRunInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Run input must be an object");
  const value = input as Record<string, unknown>;
  const task = typeof value.task === "string" ? value.task.trim() : "";
  const model = typeof value.model === "string" ? value.model.trim() : "";
  const providerConnectionId = typeof value.providerConnectionId === "string"
    ? value.providerConnectionId.trim()
    : "";
  const contextLength = Number.isInteger(value.contextLength) && Number(value.contextLength) > 0
    ? Number(value.contextLength)
    : 128_000;
  const attachments = Array.isArray(value.attachments) ? value.attachments.map(parseAttachment) : [];
  const imageInputSupported = value.imageInputSupported !== false;
  const explicitlyActiveTools = Array.isArray(value.explicitlyActiveTools)
    ? [...new Set(value.explicitlyActiveTools.filter((name): name is string => name === "use_skill"))]
    : [];
  const reasoningEffort = isReasoningEffort(value.reasoningEffort)
    ? value.reasoningEffort
    : undefined;
  if (attachments.length > MAX_ATTACHMENTS) throw new Error(`Attach at most ${MAX_ATTACHMENTS} files`);
  if (!task && attachments.length === 0) throw new Error("Enter a task or attach a file before starting a run");
  if (task.length > 30000) throw new Error("Task is too long");
  if (!providerConnectionId) throw new Error("Choose a provider before starting a run");
  if (!model) throw new Error("Choose a model before starting a run");
  const threadId = typeof value.threadId === "string" ? value.threadId : "";
  if (!threadId) throw new Error("Choose a thread before starting a run");
  return {
    threadId,
    task,
    providerConnectionId,
    model,
    contextLength,
    imageInputSupported,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(explicitlyActiveTools.length ? { explicitlyActiveTools } : {}),
  };
}

function hasContextImages(history: Message[], attachments?: AttachmentRef[]): boolean {
  return [
    ...history.flatMap((message) => message.role === "user" ? message.attachments ?? [] : []),
    ...attachments ?? [],
  ]
    .some((attachment) => attachment.kind === "image" && attachment.includeInContext !== false);
}

function contextImageAttachments(messages: Message[]): AttachmentRef[] {
  const attachments = new Map<string, AttachmentRef>();
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const attachment of message.attachments ?? []) {
      if (attachment.kind === "image" && attachment.includeInContext !== false) {
        attachments.set(attachment.id, attachment);
      }
    }
  }
  return [...attachments.values()];
}

function parseAttachment(input: unknown): AttachmentRef {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid attachment");
  const value = input as Record<string, unknown>;
  const kind = value.kind;
  const delivery = value.delivery;
  if (kind !== "image" && kind !== "document" && kind !== "pdf") throw new Error("Invalid attachment kind");
  if (delivery !== "image" && delivery !== "markdown" && delivery !== "pdf") {
    throw new Error("Invalid attachment delivery");
  }
  if (typeof value.name !== "string" || typeof value.mediaType !== "string") {
    throw new Error("Invalid attachment metadata");
  }
  if (
    !Number.isInteger(value.size) || Number(value.size) < 0 ||
    !Number.isInteger(value.estimatedTokens) || Number(value.estimatedTokens) < 0
  ) {
    throw new Error("Invalid attachment size");
  }
  return {
    id: id(value.id, "Attachment"),
    name: value.name,
    mediaType: value.mediaType,
    size: Number(value.size),
    kind,
    delivery,
    estimatedTokens: Number(value.estimatedTokens),
  };
}

function steeringMessage(value: unknown): string {
  const message = typeof value === "string" ? value.trim() : "";
  if (!message) throw new Error("Enter a message before steering the run");
  if (message.length > 30000) throw new Error("Message is too long");
  return message;
}

function approvalDecision(value: unknown): CommandApprovalDecision {
  if (value === "deny" || value === "once" || value === "thread") return value;
  throw new Error("Invalid approval decision");
}

function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} ID must be text`);
  return value;
}
