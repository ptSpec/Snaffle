import { initialMessages } from "../context/prompt.js";
import type { AttachmentRef } from "../attachments/types.js";
import type { ActiveCapabilities } from "../capabilities/active.js";
import { withoutMalformedToolCalls } from "../context/projection.js";
import type { ModelProvider, ModelStreamEvent } from "../providers/provider.js";
import type { Message, RunEvent, SourceReference } from "../protocol.js";
import { healToolCall } from "../tools/input.js";
import { ToolInputError, toolErrorContent } from "../tools/tool.js";
import { truncateMiddle } from "../tools/output.js";
import type { Trace } from "./trace.js";
import type { Workspace } from "../execution/workspace.js";

export type RunAgentOptions = {
  task: string;
  provider: ModelProvider;
  capabilities: ActiveCapabilities;
  workspace: Workspace;
  trace: Trace;
  signal: AbortSignal;
  history?: Message[];
  attachments?: AttachmentRef[];
  maxSteps?: number;
  onEvent?: (event: RunEvent) => void | Promise<void>;
  onMessage?: (message: Message, sequence: number) => void | Promise<void>;
  sequenceStart?: number;
  takeSteering?: () => string[];
};

export type AgentResult = {
  text: string;
  steps: number;
  messages: Message[];
};

export const DEFAULT_MAX_STEPS = 50;

export async function runAgent(options: RunAgentOptions): Promise<AgentResult> {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const tools = options.capabilities.tools.map(({ tool }) => tool);
  let messages = withoutMalformedToolCalls(options.history?.length
    ? [
        ...options.history,
        {
          role: "user" as const,
          content: options.task,
          ...(options.attachments?.length ? { attachments: options.attachments } : {}),
        },
      ]
    : initialMessages(options.task, options.workspace.environment, options.attachments));
  const toolSpecs = tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const sources = new Map<string, SourceReference>();
  let nextSequence = options.sequenceStart ?? messages.length;

  await emit(options, {
    type: "run.started",
    task: options.task,
    model: options.provider.model,
    providerId: options.provider.providerId,
    providerConnectionId: options.provider.connectionId,
  });

  try {
    for (let step = 1; step <= maxSteps; step += 1) {
      await emit(options, { type: "model.started", step });
      const requestStartedAt = Date.now();
      let generationStartedAt: number | undefined;
      const rawResponse = await options.provider.complete(messages, toolSpecs, options.signal, (event) =>
        {
          if (event.type.endsWith(".delta") && generationStartedAt === undefined) {
            generationStartedAt = Date.now();
          }
          return emitModelEvent(options, step, event);
        },
      );
      const durationMs = Math.max(1, Date.now() - (generationStartedAt ?? requestStartedAt));
      const citedSources = rawResponse.toolCalls.length === 0
        ? [...sources.values()].filter((source) => rawResponse.text.includes(source.url))
        : [];
      const response = {
        ...rawResponse,
        toolCalls: rawResponse.toolCalls.map((call) => {
          const tool = toolsByName.get(call.name);
          return tool ? healToolCall(call, tool.inputSchema) : call;
        }),
        ...(citedSources.length ? { sources: citedSources } : {}),
      };
      if (!citedSources.length) delete response.sources;
      await emit(options, {
        type: "model.completed",
        step,
        sequence: nextSequence,
        model: options.provider.model,
        providerId: options.provider.providerId,
        providerConnectionId: options.provider.connectionId,
        durationMs,
        response,
      });
      const assistantMessage: Message = {
        role: "assistant",
        content: response.text,
        ...(response.reasoning ? { reasoning: response.reasoning } : {}),
        ...(response.toolCalls.length ? { toolCalls: response.toolCalls } : {}),
        model: options.provider.model,
        providerId: options.provider.providerId,
        providerConnectionId: options.provider.connectionId,
        ...(response.usage ? { usage: response.usage } : {}),
        durationMs,
        ...(response.sources?.length ? { sources: response.sources } : {}),
      };
      messages.push(assistantMessage);
      await options.onMessage?.(assistantMessage, nextSequence);
      nextSequence += 1;

      if (response.toolCalls.length === 0) {
        const steeringCount = await appendSteering(messages, options.takeSteering?.(), options, nextSequence);
        if (steeringCount) {
          nextSequence += steeringCount;
          continue;
        }
        if (!response.text.trim()) throw new Error("Model returned an empty final response");
        await emit(options, { type: "run.completed", text: response.text, steps: step });
        return { text: response.text, steps: step, messages };
      }

      let malformedInput = false;
      for (const [index, call] of response.toolCalls.entries()) {
        await emit(options, { type: "tool.started", step, index, call });
        const tool = toolsByName.get(call.name);
        let content: string;
        let exitCode: number | null | undefined;
        let resultSources: SourceReference[] | undefined;
        let isError = false;
        let inputError = false;

        try {
          if (!tool) throw new Error(`Unknown tool: ${call.name}`);
          const result = await tool.execute(options.workspace, call.input);
          content = result.content;
          exitCode = result.exitCode;
          resultSources = result.sources;
          for (const source of resultSources ?? []) sources.set(source.url, source);
        } catch (error) {
          isError = true;
          inputError = error instanceof ToolInputError;
          malformedInput ||= inputError;
          content = tool ? toolErrorContent(tool, error) : `Error: ${errorMessage(error)}`;
        }

        content = truncateMiddle(content);
        const toolMessage: Message = {
          role: "tool",
          toolCallId: call.id,
          content,
          ...(isError ? { isError: true } : {}),
          ...(inputError ? { inputError: true } : {}),
          ...(exitCode === undefined ? {} : { exitCode }),
          ...(call.inputRepair ? { inputRepair: call.inputRepair } : {}),
        };
        messages.push(toolMessage);
        await options.onMessage?.(toolMessage, nextSequence);
        await emit(options, {
          type: "tool.completed",
          step,
          index,
          sequence: nextSequence,
          call,
          content,
          isError,
          ...(exitCode === undefined ? {} : { exitCode }),
        });
        nextSequence += 1;
      }

      if (malformedInput) messages = withoutMalformedToolCalls(messages);

      nextSequence += await appendSteering(messages, options.takeSteering?.(), options, nextSequence);
    }

    throw new Error(`Agent exceeded the ${maxSteps}-step limit`);
  } catch (error) {
    await emit(options, { type: "run.failed", message: errorMessage(error) });
    throw error;
  }
}

async function appendSteering(
  messages: Message[],
  steering: string[] | undefined,
  options: RunAgentOptions,
  sequence: number,
): Promise<number> {
  if (!steering?.length) return 0;
  for (const [index, content] of steering.entries()) {
    const message: Message = { role: "user", content };
    messages.push(message);
    await options.onMessage?.(message, sequence + index);
  }
  return steering.length;
}

function emitModelEvent(
  options: RunAgentOptions,
  step: number,
  event: ModelStreamEvent,
): Promise<void> {
  if (event.type === "text.delta") {
    return emit(options, { type: "model.delta", step, text: event.text });
  }
  if (event.type === "reasoning.delta") {
    return emit(options, { type: "model.reasoning.delta", step, text: event.text });
  }
  if (event.type === "retry") {
    return emit(options, {
      type: "model.retry",
      step,
      attempt: event.attempt,
      maxRetries: event.maxRetries,
      message: event.message,
    });
  }
  return emit(options, {
    type: "model.tool.delta",
    step,
    index: event.index,
    name: event.name,
    argumentChars: event.argumentChars,
  });
}

async function emit(options: RunAgentOptions, event: RunEvent): Promise<void> {
  if (
    event.type !== "model.delta" &&
    event.type !== "model.reasoning.delta" &&
    event.type !== "model.tool.delta"
  ) {
    await options.trace.write(event);
  }
  await options.onEvent?.(event);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
