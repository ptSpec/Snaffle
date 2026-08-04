import { initialMessages } from "./context.js";
import type { ModelProvider, ModelStreamEvent } from "./providers/provider.js";
import type { Message, RunEvent } from "./protocol.js";
import { healToolCall } from "./tool-input.js";
import { toolErrorContent, type Tool } from "./tools/tool.js";
import type { Trace } from "./trace.js";
import type { Workspace } from "./workspace.js";

export type RunAgentOptions = {
  task: string;
  provider: ModelProvider;
  tools: Tool[];
  workspace: Workspace;
  trace: Trace;
  signal: AbortSignal;
  history?: Message[];
  maxSteps?: number;
  onEvent?: (event: RunEvent) => void | Promise<void>;
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
  const messages = options.history?.length
    ? [...options.history, { role: "user" as const, content: options.task }]
    : initialMessages(options.task, options.workspace.environment);
  const toolSpecs = options.tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
  const toolsByName = new Map(options.tools.map((tool) => [tool.name, tool]));

  await emit(options, {
    type: "run.started",
    task: options.task,
    model: options.provider.model,
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
      const response = {
        ...rawResponse,
        toolCalls: rawResponse.toolCalls.map((call) => {
          const tool = toolsByName.get(call.name);
          return tool ? healToolCall(call, tool.inputSchema) : call;
        }),
      };
      await emit(options, {
        type: "model.completed",
        step,
        sequence: messages.length,
        model: options.provider.model,
        durationMs,
        response,
      });
      messages.push({
        role: "assistant",
        content: response.text,
        ...(response.reasoning ? { reasoning: response.reasoning } : {}),
        ...(response.toolCalls.length ? { toolCalls: response.toolCalls } : {}),
        model: options.provider.model,
        ...(response.usage ? { usage: response.usage } : {}),
        durationMs,
      });

      if (response.toolCalls.length === 0) {
        if (appendSteering(messages, options.takeSteering?.())) continue;
        if (!response.text.trim()) throw new Error("Model returned an empty final response");
        await emit(options, { type: "run.completed", text: response.text, steps: step });
        return { text: response.text, steps: step, messages };
      }

      for (const [index, call] of response.toolCalls.entries()) {
        await emit(options, { type: "tool.started", step, index, call });
        const tool = toolsByName.get(call.name);
        let content: string;
        let exitCode: number | null | undefined;
        let isError = false;

        try {
          if (!tool) throw new Error(`Unknown tool: ${call.name}`);
          const result = await tool.execute(options.workspace, call.input);
          content = result.content;
          exitCode = result.exitCode;
        } catch (error) {
          isError = true;
          content = tool ? toolErrorContent(tool, error) : `Error: ${errorMessage(error)}`;
        }

        content = content.slice(0, 12000);
        messages.push({
          role: "tool",
          toolCallId: call.id,
          content,
          ...(isError ? { isError: true } : {}),
          ...(exitCode === undefined ? {} : { exitCode }),
          ...(call.inputRepair ? { inputRepair: call.inputRepair } : {}),
        });
        await emit(options, {
          type: "tool.completed",
          step,
          index,
          sequence: messages.length - 1,
          call,
          content,
          isError,
          ...(exitCode === undefined ? {} : { exitCode }),
        });
      }

      appendSteering(messages, options.takeSteering?.());
    }

    throw new Error(`Agent exceeded the ${maxSteps}-step limit`);
  } catch (error) {
    await emit(options, { type: "run.failed", message: errorMessage(error) });
    throw error;
  }
}

function appendSteering(messages: Message[], steering: string[] | undefined): boolean {
  if (!steering?.length) return false;
  for (const content of steering) messages.push({ role: "user", content });
  return true;
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
