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
    onText?: (text: string) => void | Promise<void>,
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
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 1000);
      throw new Error(`Provider request failed (${response.status}): ${body}`);
    }

    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      return parseResponse(await response.json());
    }
    if (!response.body) throw new Error("Provider returned an empty stream");
    return parseStream(response.body, onText);
  }
}

async function parseStream(
  body: ReadableStream<Uint8Array>,
  onText?: (text: string) => void | Promise<void>,
): Promise<ModelResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  let buffer = "";
  let text = "";
  let finishReason: string | undefined;
  let usage: UsageResponse | undefined;
  let finished = false;

  while (!finished) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });

    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trimEnd();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line.startsWith("data:")) continue;

      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        finished = true;
        break;
      }

      const event = JSON.parse(data) as OpenAIStreamChunk;
      const choice = event.choices?.[0];
      const delta = choice?.delta;
      if (typeof choice?.finish_reason === "string") finishReason = choice.finish_reason;
      if (event.usage) usage = event.usage;

      if (typeof delta?.content === "string" && delta.content) {
        text += delta.content;
        await onText?.(delta.content);
      }

      for (const call of delta?.tool_calls ?? []) {
        const current = calls.get(call.index) ?? { id: "", name: "", arguments: "" };
        if (call.id) current.id = call.id;
        if (call.function?.name) current.name += call.function.name;
        if (call.function?.arguments) current.arguments += call.function.arguments;
        calls.set(call.index, current);
      }
    }
  }

  const toolCalls = [...calls.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, call]) =>
      parseToolCall({
        id: call.id || `call-${index}`,
        function: { name: call.name, arguments: call.arguments },
      }),
    );

  return {
    text,
    toolCalls,
    ...(finishReason === undefined ? {} : { finishReason }),
    ...(usage === undefined ? {} : { usage: parseUsage(usage) }),
  };
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
  const usage = body.usage ? parseUsage(body.usage) : undefined;

  return {
    text: typeof message.content === "string" ? message.content : "",
    toolCalls,
    ...(choice.finish_reason === undefined ? {} : { finishReason: choice.finish_reason }),
    ...(usage === undefined ? {} : { usage }),
  };
}

function parseUsage(usage: UsageResponse): NonNullable<ModelResponse["usage"]> {
  return {
    ...(usage.prompt_tokens === undefined ? {} : { inputTokens: usage.prompt_tokens }),
    ...(usage.completion_tokens === undefined ? {} : { outputTokens: usage.completion_tokens }),
    ...(usage.total_tokens === undefined ? {} : { totalTokens: usage.total_tokens }),
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
  usage?: UsageResponse;
};

type OpenAIStreamChunk = {
  choices?: Array<{
    finish_reason?: string | null;
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: UsageResponse;
};

type UsageResponse = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type OpenAIToolCall = {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
};
