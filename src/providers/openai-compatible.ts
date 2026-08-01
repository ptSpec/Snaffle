import type { Message, ModelResponse, ToolCall, ToolSpec } from "../protocol.js";
import type { ModelProvider } from "./provider.js";

export type OpenAICompatibleOptions = {
  baseUrl: string;
  model: string;
  apiKey?: string;
};

export class OpenAICompatibleProvider implements ModelProvider {
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(options: OpenAICompatibleOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.model = options.model;
    this.apiKey = options.apiKey;
  }

  async complete(
    messages: Message[],
    tools: ToolSpec[],
    signal: AbortSignal,
  ): Promise<ModelResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(toOpenAIMessage),
        tools: tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
      }),
      signal,
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 1000);
      throw new Error(`Provider request failed (${response.status}): ${body}`);
    }

    return parseResponse(await response.json());
  }
}

function toOpenAIMessage(message: Message): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }

  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.input) },
      })),
    };
  }

  return { role: message.role, content: message.content };
}

function parseResponse(input: unknown): ModelResponse {
  if (!input || typeof input !== "object") throw new Error("Invalid provider response");
  const body = input as OpenAIResponse;
  const choice = body.choices?.[0];
  const message = choice?.message;
  if (!message) throw new Error("Provider response contained no message");

  const toolCalls = (message.tool_calls ?? []).map(parseToolCall);
  const usage = body.usage
    ? {
        ...(body.usage.prompt_tokens === undefined
          ? {}
          : { inputTokens: body.usage.prompt_tokens }),
        ...(body.usage.completion_tokens === undefined
          ? {}
          : { outputTokens: body.usage.completion_tokens }),
        ...(body.usage.total_tokens === undefined ? {} : { totalTokens: body.usage.total_tokens }),
      }
    : undefined;

  return {
    text: typeof message.content === "string" ? message.content : "",
    toolCalls,
    ...(choice.finish_reason === undefined ? {} : { finishReason: choice.finish_reason }),
    ...(usage === undefined ? {} : { usage }),
  };
}

function parseToolCall(input: OpenAIToolCall): ToolCall {
  let parsedInput: unknown = input.function.arguments;

  try {
    parsedInput = JSON.parse(input.function.arguments);
  } catch {
    // The tool validator will return one clear input error to the model.
  }

  return { id: input.id, name: input.function.name, input: parsedInput };
}

type OpenAIResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type OpenAIToolCall = {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
};
