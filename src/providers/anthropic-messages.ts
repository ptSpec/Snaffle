import type { AttachmentRef, ResolvedAttachment } from "../attachments/types.js";
import { PROJECT } from "../identity.js";
import type { Message, ModelResponse, ProviderState, ToolCall, ToolSpec, Usage } from "../protocol.js";
import { canRetryStatus, retryAfterMilliseconds, retryBackoffMs, waitForRetry } from "../retry.js";
import { healToolInput } from "../tools/input.js";
import {
  DEFAULT_MODEL_CONTEXT_LENGTH,
  type ModelProvider,
  type ModelStreamEvent,
  type ProviderModel,
} from "./provider.js";
import { DEFAULT_PROVIDER_RETRIES, DEFAULT_PROVIDER_TIMEOUT_MS } from "./openai-compatible.js";

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
const MAX_STREAM_BUFFER_CHARS = 8 * 1024 * 1024;
const MAX_STREAM_FIELD_CHARS = 4 * 1024 * 1024;

export type AnthropicMessagesOptions = {
  baseUrl: string;
  model: string;
  providerId?: string;
  connectionId?: string;
  apiKey?: string;
  streamIdleTimeoutMs?: number;
  maxRetries?: number;
  resolveAttachment?: (attachment: AttachmentRef) => Promise<ResolvedAttachment>;
};

export class AnthropicMessagesProvider implements ModelProvider {
  readonly model: string;
  readonly providerId: string;
  readonly connectionId: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly streamIdleTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly resolveAttachment: AnthropicMessagesOptions["resolveAttachment"];

  constructor(options: AnthropicMessagesOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.model = options.model;
    this.providerId = options.providerId ?? "anthropic-compatible";
    this.connectionId = options.connectionId ?? this.providerId;
    this.apiKey = options.apiKey;
    this.streamIdleTimeoutMs = options.streamIdleTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_PROVIDER_RETRIES;
    this.resolveAttachment = options.resolveAttachment;
  }

  async complete(
    messages: Message[],
    tools: ToolSpec[],
    signal: AbortSignal,
    onEvent?: (event: ModelStreamEvent) => void | Promise<void>,
  ): Promise<ModelResponse> {
    let requestMessages = messages;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let status: number | undefined;
      let retryAfterMs = 0;
      let emptyResponse = false;
      try {
        const request = await toAnthropicRequest(requestMessages, this.resolveAttachment);
        const response = await fetch(`${this.baseUrl}/messages`, {
          method: "POST",
          headers: anthropicHeaders(this.apiKey),
          body: JSON.stringify({
            model: this.model,
            max_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
            stream: true,
            ...(request.system ? { system: request.system } : {}),
            messages: request.messages,
            ...(tools.length ? { tools: tools.map(toAnthropicTool) } : {}),
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
          ? await parseAnthropicStream(requiredBody(response), this.streamIdleTimeoutMs, onEvent)
          : parseAnthropicResponse(await response.json());
        if (result.text.trim() || result.toolCalls.length) return result;
        emptyResponse = true;
        throw new Error("Model returned neither a final answer nor a tool call.");
      } catch (error) {
        if (signal.aborted || !canRetryStatus(status)) throw error;
        if (attempt === this.maxRetries) {
          if (emptyResponse) {
            throw new Error(`Model returned an empty final response after ${this.maxRetries + 1} attempts`);
          }
          const message = errorMessage(error);
          throw new Error(`${message} after ${this.maxRetries + 1} attempts`);
        }
        const nextAttempt = attempt + 1;
        const message = errorMessage(error);
        const delayMs = retryBackoffMs(nextAttempt, retryAfterMs);
        await onEvent?.({
          type: "retry",
          attempt: nextAttempt,
          maxRetries: this.maxRetries,
          message,
          delayMs,
        });
        requestMessages = addRetryReminder(messages, message);
        await waitForRetry(delayMs, signal);
      }
    }

    throw new Error("Provider retry loop ended unexpectedly");
  }
}

export async function listAnthropicModels(
  baseUrl: string,
  apiKey?: string,
  signal?: AbortSignal,
  defaultContextLength = DEFAULT_MODEL_CONTEXT_LENGTH,
): Promise<ProviderModel[]> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
    headers: anthropicHeaders(apiKey, false),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`Model request failed (${response.status})`);
  const body = await response.json() as {
    data?: Array<{ id?: unknown; name?: unknown; display_name?: unknown; context_length?: unknown }>;
  };
  if (!Array.isArray(body.data)) throw new Error("The endpoint returned an invalid model list");
  return body.data.flatMap((model) => typeof model.id === "string" ? [{
    id: model.id,
    name: typeof model.display_name === "string"
      ? model.display_name
      : typeof model.name === "string" ? model.name : model.id,
    contextLength: typeof model.context_length === "number"
      ? model.context_length
      : defaultContextLength,
    inputModalities: ["text"],
  }] : []);
}

export async function testAnthropicModel(
  baseUrl: string,
  model: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/messages`, {
    method: "POST",
    headers: anthropicHeaders(apiKey),
    body: JSON.stringify({
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "Reply with OK." }],
    }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 1000);
    throw new Error(`Model test failed (${response.status}): ${body}`);
  }
}

function anthropicHeaders(apiKey?: string, json = true): Record<string, string> {
  return {
    ...(json ? { "content-type": "application/json" } : {}),
    "anthropic-version": ANTHROPIC_VERSION,
    ...(apiKey ? { "x-api-key": apiKey } : {}),
  };
}

function toAnthropicTool(tool: ToolSpec): Record<string, unknown> {
  return { name: tool.name, description: tool.description, input_schema: tool.inputSchema };
}

async function toAnthropicRequest(
  input: Message[],
  resolveAttachment?: AnthropicMessagesOptions["resolveAttachment"],
): Promise<{ system: string; messages: AnthropicRequestMessage[] }> {
  const system = input
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const converted = await Promise.all(input.flatMap((message) =>
    message.role === "system" ? [] : [toAnthropicMessage(message, resolveAttachment)],
  ));
  const messages: AnthropicRequestMessage[] = [];
  for (const message of converted) {
    const previous = messages.at(-1);
    if (previous?.role === message.role) previous.content.push(...message.content);
    else messages.push(message);
  }
  return { system, messages };
}

async function toAnthropicMessage(
  message: Exclude<Message, { role: "system" }>,
  resolveAttachment?: AnthropicMessagesOptions["resolveAttachment"],
): Promise<AnthropicRequestMessage> {
  if (message.role === "tool") {
    const content = message.inputRepair
      ? `${message.content}\n\n[${PROJECT.name} corrected your previous tool input: ${message.inputRepair}. Next time, send the corrected form directly.]`
      : message.content;
    return {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content,
        ...(message.isError ? { is_error: true } : {}),
      }],
    };
  }

  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: [
        ...anthropicThinkingBlocks(message.providerState),
        ...(message.content ? [{ type: "text", text: message.content } as const] : []),
        ...(message.toolCalls ?? []).map((call) => ({
          type: "tool_use" as const,
          id: call.id,
          name: call.name,
          input: call.input,
        })),
      ],
    };
  }

  const content: AnthropicContentBlock[] = message.content
    ? [{ type: "text", text: message.content }]
    : [];
  for (const attachment of message.attachments ?? []) {
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
        type: "image",
        source: { type: "base64", media_type: resolved.mediaType, data: resolved.data },
      });
    } else {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: resolved.data },
      });
    }
  }
  return { role: "user", content };
}

function parseAnthropicResponse(input: unknown): ModelResponse {
  if (!input || typeof input !== "object") throw new Error("Invalid provider response");
  const body = input as AnthropicResponse;
  if (!Array.isArray(body.content)) throw new Error("Provider response contained no content");
  return responseFromBlocks(body.content, body.stop_reason, body.usage);
}

async function parseAnthropicStream(
  body: ReadableStream<Uint8Array>,
  idleTimeoutMs: number,
  onEvent?: (event: ModelStreamEvent) => void | Promise<void>,
): Promise<ModelResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const blocks = new Map<number, StreamingBlock>();
  let buffer = "";
  let finishReason: string | undefined;
  let usage: AnthropicUsage | undefined;
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
      if (!data) continue;
      if (data === "[DONE]") {
        finished = true;
        break;
      }

      const event = JSON.parse(data) as AnthropicStreamEvent;
      if (event.type === "error") throw new Error(`Provider stream failed: ${event.error?.message ?? "Unknown provider error"}`);
      if (event.type === "message_start") usage = mergeUsage(usage, event.message?.usage);
      if (event.type === "message_delta") {
        finishReason = event.delta?.stop_reason ?? finishReason;
        usage = mergeUsage(usage, event.usage);
      }
      if (event.type === "message_stop") finished = true;

      if (event.type === "content_block_start" && event.index !== undefined && event.content_block) {
        const block = streamingBlock(event.content_block);
        blocks.set(event.index, block);
        const initial = streamVisibleText(block);
        if (initial) await emitBlockDelta(block, initial, event.index, onEvent);
      }
      if (event.type === "content_block_delta" && event.index !== undefined && event.delta) {
        const block = blocks.get(event.index);
        if (!block) continue;
        const delta = applyBlockDelta(block, event.delta);
        if (delta) await emitBlockDelta(block, delta, event.index, onEvent);
      }
    }
  }

  return responseFromBlocks(
    [...blocks.entries()].sort(([left], [right]) => left - right).map(([, block]) => completedBlock(block)),
    finishReason,
    usage,
  );
}

function streamingBlock(block: AnthropicResponseBlock): StreamingBlock {
  if (block.type === "text") return { type: "text", text: block.text ?? "" };
  if (block.type === "thinking") {
    return { type: "thinking", thinking: block.thinking ?? "", signature: block.signature ?? "" };
  }
  if (block.type === "redacted_thinking") return { type: "redacted_thinking", data: block.data ?? "" };
  return {
    type: "tool_use",
    id: block.id ?? "",
    name: block.name ?? "",
    initialInput: block.input,
    inputJson: "",
  };
}

function applyBlockDelta(block: StreamingBlock, delta: AnthropicDelta): string {
  if (block.type === "text" && delta.type === "text_delta") {
    block.text = appendStreamText(block.text, delta.text ?? "", "response text");
    return delta.text ?? "";
  }
  if (block.type === "thinking" && delta.type === "thinking_delta") {
    block.thinking = appendStreamText(block.thinking, delta.thinking ?? "", "reasoning");
    return delta.thinking ?? "";
  }
  if (block.type === "thinking" && delta.type === "signature_delta") {
    block.signature = appendStreamText(block.signature, delta.signature ?? "", "reasoning signature");
  }
  if (block.type === "tool_use" && delta.type === "input_json_delta") {
    block.inputJson = appendStreamText(block.inputJson, delta.partial_json ?? "", "tool arguments");
    return delta.partial_json ?? "";
  }
  return "";
}

async function emitBlockDelta(
  block: StreamingBlock,
  delta: string,
  index: number,
  onEvent?: (event: ModelStreamEvent) => void | Promise<void>,
): Promise<void> {
  if (block.type === "text") await onEvent?.({ type: "text.delta", text: delta });
  else if (block.type === "thinking") await onEvent?.({ type: "reasoning.delta", text: delta });
  else if (block.type === "tool_use" && block.name) {
    await onEvent?.({ type: "tool.delta", index, name: block.name, argumentChars: block.inputJson.length });
  }
}

function streamVisibleText(block: StreamingBlock): string {
  if (block.type === "text") return block.text;
  if (block.type === "thinking") return block.thinking;
  return "";
}

function completedBlock(block: StreamingBlock): AnthropicResponseBlock {
  if (block.type !== "tool_use") return block;
  return {
    type: "tool_use",
    id: block.id,
    name: block.name,
    input: block.inputJson
      ? parseToolInput(block.inputJson)
      : block.initialInput ?? {},
  };
}

function responseFromBlocks(
  blocks: AnthropicResponseBlock[],
  finishReason?: string | null,
  rawUsage?: AnthropicUsage,
): ModelResponse {
  const text = blocks.flatMap((block) => block.type === "text" ? [block.text ?? ""] : []).join("");
  const thinking = blocks.filter(isThinkingBlock);
  const reasoning = thinking.flatMap((block) => block.type === "thinking" ? [block.thinking ?? ""] : []).join("");
  const toolCalls = blocks.flatMap((block): ToolCall[] => block.type === "tool_use" ? [{
    id: block.id ?? "",
    name: block.name ?? "",
    ...toolInput(block.input),
  }] : []);
  const usage = rawUsage ? parseUsage(rawUsage) : undefined;
  return {
    text,
    ...(reasoning ? { reasoning } : {}),
    toolCalls,
    ...(finishReason ? { finishReason } : {}),
    ...(usage ? { usage } : {}),
    ...(thinking.length ? { providerState: anthropicProviderState(thinking) } : {}),
  };
}

function toolInput(input: unknown): Pick<ToolCall, "input" | "inputRepair"> {
  if (typeof input !== "string") return { input: input ?? {} };
  const parsed = healToolInput(input);
  return { input: parsed.input, ...(parsed.repair ? { inputRepair: parsed.repair } : {}) };
}

function parseToolInput(input: unknown): unknown {
  if (typeof input !== "string") return input;
  return healToolInput(input).input;
}

function anthropicProviderState(blocks: AnthropicThinkingBlock[]): ProviderState {
  return { anthropic: { thinking: blocks } };
}

function anthropicThinkingBlocks(state: ProviderState | undefined): AnthropicThinkingBlock[] {
  if (!state?.anthropic || typeof state.anthropic !== "object") return [];
  const thinking = (state.anthropic as { thinking?: unknown }).thinking;
  if (!Array.isArray(thinking)) return [];
  return thinking.filter(isThinkingBlock);
}

function isThinkingBlock(block: unknown): block is AnthropicThinkingBlock {
  if (!block || typeof block !== "object") return false;
  const value = block as { type?: unknown; thinking?: unknown; signature?: unknown; data?: unknown };
  return value.type === "thinking"
    ? typeof value.thinking === "string" && typeof value.signature === "string"
    : value.type === "redacted_thinking" && typeof value.data === "string";
}

function parseUsage(usage: AnthropicUsage): Usage {
  const uncached = usage.input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const inputTokens = uncached + cacheRead + cacheWrite;
  const outputTokens = usage.output_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    ...(cacheRead ? { cachedInputTokens: cacheRead } : {}),
  };
}

function mergeUsage(current: AnthropicUsage | undefined, next: AnthropicUsage | undefined): AnthropicUsage | undefined {
  if (!next) return current;
  const inputTokens = next.input_tokens ?? current?.input_tokens;
  const outputTokens = next.output_tokens ?? current?.output_tokens;
  const cacheReadTokens = next.cache_read_input_tokens ?? current?.cache_read_input_tokens;
  const cacheWriteTokens = next.cache_creation_input_tokens ?? current?.cache_creation_input_tokens;
  return {
    ...(inputTokens === undefined ? {} : { input_tokens: inputTokens }),
    ...(outputTokens === undefined ? {} : { output_tokens: outputTokens }),
    ...(cacheReadTokens === undefined ? {} : { cache_read_input_tokens: cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cache_creation_input_tokens: cacheWriteTokens }),
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
      (chunk) => { clearTimeout(timeout); resolve(chunk); },
      (error: unknown) => { clearTimeout(timeout); reject(error); },
    );
  });
}

function appendStreamText(current: string, delta: string, label: string): string {
  if (current.length + delta.length > MAX_STREAM_FIELD_CHARS) {
    throw new Error(`Provider stream exceeded the ${MAX_STREAM_FIELD_CHARS}-character ${label} limit`);
  }
  return current + delta;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type AnthropicRequestMessage = { role: "user" | "assistant"; content: AnthropicContentBlock[] };

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
  | AnthropicThinkingBlock;

type AnthropicThinkingBlock =
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string };

type AnthropicResponseBlock = {
  type: "text" | "thinking" | "redacted_thinking" | "tool_use";
  text?: string;
  thinking?: string;
  signature?: string;
  data?: string;
  id?: string;
  name?: string;
  input?: unknown;
};

type StreamingBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "tool_use"; id: string; name: string; initialInput: unknown; inputJson: string };

type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

type AnthropicResponse = {
  content?: AnthropicResponseBlock[];
  stop_reason?: string | null;
  usage?: AnthropicUsage;
};

type AnthropicDelta = {
  type?: "text_delta" | "thinking_delta" | "signature_delta" | "input_json_delta";
  text?: string;
  thinking?: string;
  signature?: string;
  partial_json?: string;
  stop_reason?: string;
};

type AnthropicStreamEvent = {
  type?: string;
  index?: number;
  content_block?: AnthropicResponseBlock;
  delta?: AnthropicDelta;
  usage?: AnthropicUsage;
  message?: { usage?: AnthropicUsage };
  error?: { message?: string };
};
