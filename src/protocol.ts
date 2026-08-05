import type { AttachmentRef } from "./attachments/types.js";

export type JsonSchema = Record<string, unknown>;

export type ToolCall = {
  id: string;
  name: string;
  input: unknown;
  inputRepair?: string;
};

export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string; attachments?: AttachmentRef[] }
  | {
      role: "assistant";
      content: string;
      reasoning?: string;
      toolCalls?: ToolCall[];
      model?: string;
      usage?: Usage;
      durationMs?: number;
    }
  | {
      role: "tool";
      toolCallId: string;
      content: string;
      isError?: boolean;
      exitCode?: number | null;
      inputRepair?: string;
    };

export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

export type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type CommandApprovalDecision = "deny" | "once" | "thread";

export type ModelResponse = {
  text: string;
  reasoning?: string;
  toolCalls: ToolCall[];
  finishReason?: string;
  usage?: Usage;
};

export type RunEvent =
  | { type: "run.started"; task: string; model: string }
  | { type: "model.started"; step: number }
  | { type: "model.delta"; step: number; text: string }
  | { type: "model.reasoning.delta"; step: number; text: string }
  | { type: "model.tool.delta"; step: number; index: number; name: string; argumentChars: number }
  | { type: "model.retry"; step: number; attempt: number; maxRetries: number; message: string }
  | { type: "permission.requested"; id: string; command: string; cwd: string; reason: string }
  | { type: "permission.resolved"; id: string; decision: CommandApprovalDecision }
  | { type: "model.completed"; step: number; sequence: number; model: string; durationMs: number; response: ModelResponse }
  | { type: "tool.started"; step: number; index: number; call: ToolCall }
  | {
      type: "tool.completed";
      step: number;
      index: number;
      sequence: number;
      call: ToolCall;
      content: string;
      isError: boolean;
      exitCode?: number | null;
    }
  | { type: "run.completed"; text: string; steps: number }
  | { type: "run.persisted" }
  | { type: "run.failed"; message: string };
