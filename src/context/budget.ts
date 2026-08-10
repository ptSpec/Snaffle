import type { Message, ToolSpec } from "../protocol.js";

export type CompactionMode = "automatic" | "custom";

export const DEFAULT_COMPACTION_THRESHOLD = 65;
export const COMPACTION_HEAD_START = 7;

export function compactionThreshold(contextLength: number, mode: CompactionMode, custom: number): number {
  if (mode === "custom") return custom;
  if (contextLength > 400_000) return 55;
  if (contextLength > 128_000) return 65;
  return 80;
}

export function compactionPreparationThreshold(
  contextLength: number,
  mode: CompactionMode,
  custom: number,
): number {
  return Math.max(1, compactionThreshold(contextLength, mode, custom) - COMPACTION_HEAD_START);
}

export function estimateContextCharacters(messages: Message[], tools: ToolSpec[] = []): number {
  return messages.reduce((total, message) => total + estimateMessageCharacters(message), 0) +
    JSON.stringify(tools).length;
}

export function estimateContextTokens(characters: number): number {
  return Math.ceil(characters / 4);
}

function estimateMessageCharacters(message: Message): number {
  let characters = message.content.length + message.role.length;
  if (message.role === "assistant") {
    characters += message.reasoning?.length ?? 0;
    characters += message.toolCalls ? JSON.stringify(message.toolCalls).length : 0;
    characters += message.providerState ? JSON.stringify(message.providerState).length : 0;
  }
  if (message.role === "tool") characters += message.toolCallId.length;
  if (message.role === "user") {
    characters += (message.attachments ?? []).reduce(
      (total, attachment) => total + (attachment.includeInContext === false ? 0 : attachment.estimatedTokens * 4),
      0,
    );
  }
  return characters;
}
