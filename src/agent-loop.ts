import { initialMessages } from "./context.js";
import type { ModelProvider } from "./providers/provider.js";
import type { Message, RunEvent } from "./protocol.js";
import type { Tool } from "./tools/tool.js";
import type { Trace } from "./trace.js";
import type { Workspace } from "./workspace.js";

export type RunAgentOptions = {
  task: string;
  provider: ModelProvider;
  tools: Tool[];
  workspace: Workspace;
  trace: Trace;
  signal: AbortSignal;
  maxSteps?: number;
  onEvent?: (event: RunEvent) => void | Promise<void>;
};

export type AgentResult = {
  text: string;
  steps: number;
  messages: Message[];
};

export async function runAgent(options: RunAgentOptions): Promise<AgentResult> {
  const maxSteps = options.maxSteps ?? 20;
  const messages = initialMessages(options.task);
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
      const response = await options.provider.complete(messages, toolSpecs, options.signal);
      await emit(options, { type: "model.completed", step, response });
      messages.push({
        role: "assistant",
        content: response.text,
        ...(response.toolCalls.length ? { toolCalls: response.toolCalls } : {}),
      });

      if (response.toolCalls.length === 0) {
        if (!response.text.trim()) throw new Error("Model returned an empty final response");
        await emit(options, { type: "run.completed", text: response.text, steps: step });
        return { text: response.text, steps: step, messages };
      }

      for (const call of response.toolCalls) {
        await emit(options, { type: "tool.started", call });
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
          content = `Error: ${errorMessage(error)}`;
        }

        content = content.slice(0, 12000);
        messages.push({ role: "tool", toolCallId: call.id, content });
        await emit(options, {
          type: "tool.completed",
          call,
          content,
          isError,
          ...(exitCode === undefined ? {} : { exitCode }),
        });
      }
    }

    throw new Error(`Agent exceeded the ${maxSteps}-step limit`);
  } catch (error) {
    await emit(options, { type: "run.failed", message: errorMessage(error) });
    throw error;
  }
}

async function emit(options: RunAgentOptions, event: RunEvent): Promise<void> {
  await options.trace.write(event);
  await options.onEvent?.(event);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
