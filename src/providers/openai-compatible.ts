import type { AttachmentRef, ResolvedAttachment } from "../attachments/types.js";
import { PROJECT } from "../identity.js";
import type { Message, ModelResponse, ToolCall, ToolSpec } from "../protocol.js";
import { canRetryStatus, retryAfterMilliseconds, retryBackoffMs, waitForRetry } from "../retry.js";
import { healToolInput } from "../tools/input.js";
import {
  DEFAULT_MODEL_CONTEXT_LENGTH,
  type ModelProvider,
  type ModelStreamEvent,
  type ProviderModel,
  type ReasoningEffort,
} from "./provider.js";

const MAX_STREAM_BUFFER_CHARS = 8 * 1024 * 1024;
const MAX_STREAM_FIELD_CHARS = 4 * 1024 * 1024;
export const DEFAULT_PROVIDER_TIMEOUT_MS = 3 * 60 * 1000;
export const DEFAULT_PROVIDER_RETRIES = 4;

export type ReasoningRequestFormat = "standard" | "openrouter" | "deepseek";

export type OpenAICompatibleOptions = {
  baseUrl: string;
  model: string;
  providerId?: string;
  connectionId?: string;
  apiKey?: string;
  streamIdleTimeoutMs?: number;
  maxRetries?: number;
  temperature?: number;
  seed?: number;
  sendParallelToolCalls?: boolean;
  reasoningEffort?: ReasoningEffort;
  reasoningFormat?: ReasoningRequestFormat;
  resolveAttachment?: (attachment: AttachmentRef) => Promise<ResolvedAttachment>;
};

export class OpenAICompatibleProvider implements ModelProvider {
  readonly model: string;
  readonly providerId: string;
  readonly connectionId: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly streamIdleTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly temperature: number | undefined;
  private readonly seed: number | undefined;
  private readonly sendParallelToolCalls: boolean;
  private readonly reasoningEffort: ReasoningEffort | undefined;
  private readonly reasoningFormat: ReasoningRequestFormat;
  private readonly resolveAttachment: OpenAICompatibleOptions["resolveAttachment"];

  constructor(options: OpenAICompatibleOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.model = options.model;
    this.providerId = options.providerId ?? "openai-compatible";
    this.connectionId = options.connectionId ?? this.providerId;
    this.apiKey = options.apiKey;
    this.streamIdleTimeoutMs = options.streamIdleTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_PROVIDER_RETRIES;
    this.temperature = options.temperature;
    this.seed = options.seed;
    this.sendParallelToolCalls = options.sendParallelToolCalls ?? true;
    this.reasoningEffort = options.reasoningEffort;
    this.reasoningFormat = options.reasoningFormat ?? "standard";
    this.resolveAttachment = options.resolveAttachment;
  }

  async complete(
    messages: Message[],
    tools: ToolSpec[],
    signal: AbortSignal,
    onEvent?: (event: ModelStreamEvent) => void | Promise<void>,
  ): Promise<ModelResponse> {
    const maxRetries = this.maxRetries;
    let requestMessages = messages;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let status: number | undefined;
      let emptyResponse = false;
      let retryAfterMs = 0;

      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: this.model,
            messages: await Promise.all(
              requestMessages.map((message) => toOpenAIMessage(message, this.resolveAttachment)),
            ),
            tools: tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              },
            })),
            ...(this.sendParallelToolCalls ? { parallel_tool_calls: false } : {}),
            stream: true,
            stream_options: { include_usage: true },
            ...(this.temperature === undefined ? {} : { temperature: this.temperature }),
            ...(this.seed === undefined ? {} : { seed: this.seed }),
            ...reasoningRequest(this.reasoningEffort, this.reasoningFormat),
          }),
          signal,
        });
        status = response.status;
        retryAfterMs = retryAfterMilliseconds(response.headers.get("retry-after"));

        if (!response.ok) {
          const body = (await response.text()).slice(0, 1000);
          throw new Error(`Provider request failed (${response.status}): ${body}`);
        }

        const result = response.headers.get("content-type")?.includes("text/event-stream")
          ? await parseStream(requiredBody(response), this.streamIdleTimeoutMs, onEvent)
          : parseResponse(await response.json());

        if (result.text.trim() || result.toolCalls.length) return result;
        emptyResponse = true;
        throw new Error("Model returned neither a final answer nor a tool call.");
      } catch (error) {
        if (signal.aborted || !canRetryStatus(status)) throw error;
        if (attempt === maxRetries) {
          if (emptyResponse) {
            throw new Error(`Model returned an empty final response after ${maxRetries + 1} attempts`);
          }
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`${message} after ${maxRetries + 1} attempts`);
        }

        const nextAttempt = attempt + 1;
        const message = error instanceof Error ? error.message : String(error);
        const delayMs = retryBackoffMs(nextAttempt, retryAfterMs);
        await onEvent?.({ type: "retry", attempt: nextAttempt, maxRetries, message, delayMs });
        requestMessages = addRetryReminder(messages, message);
        await waitForRetry(delayMs, signal);
      }
    }

    throw new Error("Provider retry loop ended unexpectedly");
  }
}

function reasoningRequest(
  effort: ReasoningEffort | undefined,
  format: ReasoningRequestFormat,
): Record<string, unknown> {
  if (!effort) return {};
  if (format === "openrouter") return { reasoning: { effort } };
  if (format === "deepseek") {
    return effort === "none"
      ? { thinking: { type: "disabled" } }
      : { thinking: { type: "enabled" }, reasoning_effort: effort };
  }
  return { reasoning_effort: effort };
}

export async function listOpenAICompatibleModels(
  baseUrl: string,
  apiKey?: string,
  signal?: AbortSignal,
  defaultContextLength = DEFAULT_MODEL_CONTEXT_LENGTH,
): Promise<ProviderModel[]> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await responseError("Model request", response);
  const body = await response.json() as { data?: Array<{ id?: unknown; name?: unknown; context_length?: unknown }> };
  if (!Array.isArray(body.data)) throw new Error("The endpoint returned an invalid model list");
  return body.data.flatMap((model) => typeof model.id === "string" ? [{
    id: model.id,
    name: typeof model.name === "string" ? model.name : model.id,
    contextLength: typeof model.context_length === "number"
      ? model.context_length
      : defaultContextLength,
    inputModalities: ["text"],
  }] : []);
}

export async function testOpenAICompatibleModel(
  baseUrl: string,
  model: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with OK." }],
      max_tokens: 1,
      stream: false,
    }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await responseError("Model test", response);
}

async function responseError(operation: string, response: Response): Promise<Error> {
  const body = (await response.text()).slice(0, 1000);
  let detail = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown }; message?: unknown };
    if (typeof parsed.error?.message === "string") detail = parsed.error.message;
    else if (typeof parsed.message === "string") detail = parsed.message;
  } catch {
    // Keep non-JSON provider errors as received.
  }
  return new Error(`${operation} failed (${response.status})${detail ? `: ${detail}` : ""}`);
}

function requiredBody(response: Response): ReadableStream<Uint8Array> {
  if (!response.body) throw new Error("Provider returned an empty stream");
  return response.body;
}

function addRetryReminder(messages: Message[], failure: string): Message[] {
  const notice =
    `${PROJECT.name} retry notice, not a new user request: The last model generation was rejected before ${PROJECT.name} received it. ` +
    `The original task is unchanged and completed tool calls remain completed; do not repeat them. ` +
    `Provider error: ${failure.slice(0, 2000)} Generate only the next response again. ` +
    `If using a tool, call exactly one and send its arguments as one JSON object matching its schema. ` +
    `Do not mention this retry notice.`;
  const systemIndex = messages.findIndex((message) => message.role === "system");
  if (systemIndex === -1) return [{ role: "system", content: notice }, ...messages];
  return messages.map((message, index) =>
    index === systemIndex && message.role === "system"
      ? { ...message, content: `${message.content}\n\n${notice}` }
      : message,
  );
}

async function parseStream(
  body: ReadableStream<Uint8Array>,
  idleTimeoutMs: number,
  onEvent?: (event: ModelStreamEvent) => void | Promise<void>,
): Promise<ModelResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  let buffer = "";
  let text = "";
  let reasoning = "";
  let finishReason: string | undefined;
  let usage: UsageResponse | undefined;
  let finished = false;

  while (!finished) {
    const chunk = await readStreamChunk(reader, idleTimeoutMs);
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    if (buffer.length > MAX_STREAM_BUFFER_CHARS) {
      throw new Error("Provider stream contained an oversized event");
    }

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
      if (event.error) {
        const code = event.error.code === undefined ? "" : ` (${event.error.code})`;
        const diagnostics = streamDiagnostics(event.error.metadata, calls);
        throw new Error(
          `Provider stream failed${code}: ${event.error.message ?? "Unknown provider error"}` +
            (diagnostics ? `\nProvider diagnostics: ${diagnostics}` : ""),
        );
      }
      const choice = event.choices?.[0];
      const delta = choice?.delta;
      if (typeof choice?.finish_reason === "string") finishReason = choice.finish_reason;
      if (event.usage) usage = event.usage;

      if (typeof delta?.content === "string" && delta.content) {
        text = appendStreamText(text, delta.content, "response text");
        await onEvent?.({ type: "text.delta", text: delta.content });
      }

      const reasoningDelta = reasoningText(delta ?? {});
      if (reasoningDelta) {
        reasoning = appendStreamText(reasoning, reasoningDelta, "reasoning");
        await onEvent?.({ type: "reasoning.delta", text: reasoningDelta });
      }

      for (const call of delta?.tool_calls ?? []) {
        const current = calls.get(call.index) ?? { id: "", name: "", arguments: "" };
        const previousName = current.name;
        const previousArgumentChars = current.arguments.length;
        if (call.id) current.id = call.id;
        if (call.function?.name) {
          current.name = appendStreamText(current.name, call.function.name, "tool name");
        }
        if (call.function?.arguments) {
          current.arguments = appendStreamText(
            current.arguments,
            call.function.arguments,
            "tool arguments",
          );
        }
        calls.set(call.index, current);
        const crossedProgressMark =
          Math.floor(previousArgumentChars / 1024) !== Math.floor(current.arguments.length / 1024);
        if (current.name && (current.name !== previousName || crossedProgressMark)) {
          await onEvent?.({
            type: "tool.delta",
            index: call.index,
            name: current.name,
            argumentChars: current.arguments.length,
          });
        }
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
    ...(reasoning ? { reasoning } : {}),
    toolCalls,
    ...(!finished && finishReason === undefined
      ? { finishReason: "incomplete" }
      : finishReason === undefined
        ? {}
        : { finishReason }),
    ...(usage === undefined ? {} : { usage: parseUsage(usage) }),
  };
}

function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      void reader.cancel().catch(() => undefined);
      reject(new Error(`Provider stream sent no data for ${Math.round(timeoutMs / 1000)} seconds`));
    }, timeoutMs);
    reader.read().then(
      (chunk) => {
        clearTimeout(timeout);
        resolve(chunk);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function appendStreamText(current: string, delta: string, label: string): string {
  if (current.length + delta.length > MAX_STREAM_FIELD_CHARS) {
    throw new Error(`Provider stream exceeded the ${MAX_STREAM_FIELD_CHARS}-character ${label} limit`);
  }
  return current + delta;
}

async function toOpenAIMessage(
  message: Message,
  resolveAttachment?: (attachment: AttachmentRef) => Promise<ResolvedAttachment>,
): Promise<Record<string, unknown>> {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.inputRepair
        ? `${message.content}\n\n[${PROJECT.name} corrected your previous tool input: ${message.inputRepair}. Next time, send the corrected form directly.]`
        : message.content,
    };
  }

  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      ...(message.reasoning ? { reasoning: message.reasoning } : {}),
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.input) },
      })),
    };
  }

  if (message.role !== "user" || !message.attachments?.length) {
    return { role: message.role, content: message.content };
  }

  const content: Record<string, unknown>[] = [{ type: "text", text: message.content }];
  for (const attachment of message.attachments) {
    if (attachment.includeInContext === false) {
      content.push({
        type: "text",
        text: `<attachment name=${JSON.stringify(attachment.name)} available="false" />`,
      });
      continue;
    }
    if (!resolveAttachment) throw new Error("This provider cannot load attachments");
    const resolved = await resolveAttachment(attachment);
    if (resolved.type === "markdown") {
      content.push({
        type: "text",
        text: `<attachment name=${JSON.stringify(attachment.name)}>\n${resolved.text}\n</attachment>`,
      });
    } else if (resolved.type === "image") {
      content.push({
        type: "image_url",
        image_url: { url: `data:${resolved.mediaType};base64,${resolved.data}` },
      });
    } else {
      content.push({
        type: "file",
        file: {
          filename: attachment.name,
          file_data: `data:application/pdf;base64,${resolved.data}`,
        },
      });
    }
  }
  return { role: "user", content };
}

function parseResponse(input: unknown): ModelResponse {
  if (!input || typeof input !== "object") throw new Error("Invalid provider response");
  const body = input as OpenAIResponse;
  const choice = body.choices?.[0];
  const message = choice?.message;
  if (!message) throw new Error("Provider response contained no message");

  const toolCalls = (message.tool_calls ?? []).map(parseToolCall);
  const usage = body.usage ? parseUsage(body.usage) : undefined;
  const reasoning = reasoningText(message);

  return {
    text: typeof message.content === "string" ? message.content : "",
    ...(reasoning ? { reasoning } : {}),
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
    ...(usage.prompt_tokens_details?.cached_tokens === undefined && usage.prompt_cache_hit_tokens === undefined
      ? {}
      : { cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens }),
    ...(usage.completion_tokens_details?.reasoning_tokens === undefined
      ? {}
      : { reasoningTokens: usage.completion_tokens_details.reasoning_tokens }),
    ...(usage.cost === undefined ? {} : { costUsd: usage.cost }),
  };
}

function parseToolCall(input: OpenAIToolCall): ToolCall {
  const parsed = healToolInput(input.function.arguments);
  return {
    id: input.id,
    name: input.function.name,
    input: parsed.input,
    ...(parsed.repair ? { inputRepair: parsed.repair } : {}),
  };
}

type OpenAIResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
      reasoning_details?: ReasoningDetail[];
      tool_calls?: OpenAIToolCall[];
    };
  }>;
  usage?: UsageResponse;
};

type OpenAIStreamChunk = {
  error?: { code?: string | number; message?: string; metadata?: unknown };
  choices?: Array<{
    finish_reason?: string | null;
    delta?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
      reasoning_details?: ReasoningDetail[];
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
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  prompt_cache_hit_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
};

type OpenAIToolCall = {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
};

type ReasoningDetail = {
  text?: string;
  summary?: string;
};

function reasoningText(value: {
  reasoning?: string | null;
  reasoning_content?: string | null;
  reasoning_details?: ReasoningDetail[];
}): string {
  const direct = value.reasoning ?? value.reasoning_content;
  if (direct && direct !== "[REDACTED]") return direct;
  return (value.reasoning_details ?? [])
    .map((detail) => detail.text ?? detail.summary ?? "")
    .filter((text) => text && text !== "[REDACTED]")
    .join("");
}

function streamDiagnostics(
  metadata: unknown,
  calls: Map<number, { id: string; name: string; arguments: string }>,
): string {
  const details: string[] = [];
  if (metadata !== undefined) details.push(boundedJson(metadata));

  const partialCalls = [...calls.values()]
    .filter((call) => call.name || call.arguments)
    .map((call) => ({ name: call.name, arguments: call.arguments }));
  if (partialCalls.length) details.push(`partial tool call: ${boundedJson(partialCalls)}`);
  return details.join("; ");
}

function boundedJson(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return text.length > 1600 ? `${text.slice(0, 1600)}…` : text;
}
