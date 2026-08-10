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
import { activeCapabilities, type ActiveCapabilities } from "../../capabilities/active.js";
import { compactionThreshold, type CompactionMode } from "../../context/budget.js";
import { compactionBoundary, type ContextCompactor } from "../../context/compaction.js";
import { initialMessages } from "../../context/prompt.js";
import { projectContext } from "../../context/projection.js";
import { estimateContextCharacters, estimateContextTokens } from "../../context/budget.js";
import { probeNativeSandbox } from "../../execution/native/sandbox.js";
import { LocalWorkspace, type CommandApprovalRequest } from "../../execution/workspace.js";
import type { ModelProvider } from "../../providers/provider.js";
import type { CommandApprovalDecision, Message, RunEvent } from "../../protocol.js";
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
  capabilities: () => ActiveCapabilities;
  provider: (
    connectionId: string,
    model: string,
    resolveAttachment: (attachment: AttachmentRef) => ReturnType<AttachmentStore["resolve"]>,
  ) => ModelProvider;
  connectionLimit(connectionId: string): number;
  settings: () => {
    maxSteps: number;
    providerTimeoutMinutes: number;
    providerRetries: number;
    compactionMode: CompactionMode;
    compactionThreshold: number;
    subagent: SubagentProfile;
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
    await options.store.setThreadModel(input.threadId, input.providerConnectionId, input.model);
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
    const baseCapabilities = options.capabilities();
    const subagent = threadSubagent(settings.subagent, selectedThread.subagentMode);
    const capabilities = subagent
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
                  provider: (signal) => subagentRoute(
                    subagent,
                    providerCapacity,
                    signal,
                    options.connectionLimit,
                    (connectionId, model) => options.provider(
                      connectionId,
                      model,
                      (attachment) => options.attachments.resolve(attachment),
                    ),
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
    const toolSpecs = capabilities.tools.map(({ tool }) => ({
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
    let nextSequence: number;

    try {
      const lastSequence = await options.store.lastSequence(threadId);
      if (lastSequence < 0) {
        const initial = initialMessages(input.task, workspace.environment, input.attachments);
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

    const mainProvider = providerCapacity.limit(options.provider(
      input.providerConnectionId,
      input.model,
      (attachment) => options.attachments.resolve(attachment),
    ), options.connectionLimit(input.providerConnectionId));
    void runAgent({
      task: input.task,
      provider: mainProvider,
      capabilities,
      workspace,
      trace: memoryTrace,
      signal: controller.signal,
      history: conversation,
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      maxSteps: settings.maxSteps,
      sequenceStart: nextSequence,
      onMessage: (message, sequence) => options.store.appendMessage(threadId, sequence, message),
      takeSteering: () => run.steering.splice(0),
      onEvent: (event) => {
        if (event.type === "run.completed" || event.type === "run.failed") run.acceptingSteering = false;
        options.sendEvent(threadId, event);
      },
    }).then(async () => {
      options.sendEvent(threadId, { type: "run.persisted" });
      options.compactor.schedule(compactionInput);
    }).catch(() => undefined).finally(() => {
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

async function subagentRoute(
  profile: SubagentProfile,
  capacity: ProviderCapacity,
  signal: AbortSignal,
  connectionLimit: (connectionId: string) => number,
  create: (connectionId: string, model: string) => ModelProvider,
): Promise<SubagentProviderRoute> {
  const immediate = capacity.tryAcquire(profile.providerConnectionId, connectionLimit(profile.providerConnectionId));
  if (immediate) return createRoute(create, profile.providerConnectionId, profile.model, immediate);

  if (profile.overflowProviderConnectionId && profile.overflowModel) {
    const release = await capacity.acquire(
      profile.overflowProviderConnectionId,
      connectionLimit(profile.overflowProviderConnectionId),
      signal,
    );
    return createRoute(create, profile.overflowProviderConnectionId, profile.overflowModel, release);
  }

  const release = await capacity.acquire(
    profile.providerConnectionId,
    connectionLimit(profile.providerConnectionId),
    signal,
  );
  return createRoute(create, profile.providerConnectionId, profile.model, release);
}

function createRoute(
  create: (connectionId: string, model: string) => ModelProvider,
  connectionId: string,
  model: string,
  release: () => void,
): SubagentProviderRoute {
  try {
    return { provider: create(connectionId, model), release };
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
    ...(attachments.length ? { attachments } : {}),
  };
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
