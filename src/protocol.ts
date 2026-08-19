import type { AttachmentRef } from "./attachments/types.js";
import type { SubagentActivity, SubagentActivityUpdate } from "./agent/subagents/activity.js";

export type JsonSchema = Record<string, unknown>;

export type SourceReference = {
  title: string;
  url: string;
};

export type ToolCall = {
  id: string;
  name: string;
  input: unknown;
  inputRepair?: string;
};

export type ToolPresentation = {
  title: string;
  subtitle?: string;
};

export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string; attachments?: AttachmentRef[]; internal?: boolean }
  | {
      role: "assistant";
      content: string;
      reasoning?: string;
      toolCalls?: ToolCall[];
      model?: string;
      providerId?: string;
      providerConnectionId?: string;
      usage?: Usage;
      durationMs?: number;
      sources?: SourceReference[];
      finishReason?: string;
      toolNames?: string[];
      providerState?: ProviderState;
    }
  | {
      role: "tool";
      toolCallId: string;
      content: string;
      isError?: boolean;
      inputError?: boolean;
      exitCode?: number | null;
      inputRepair?: string;
      details?: SubagentActivity;
      durationMs?: number;
      presentation?: ToolPresentation;
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
  cachedInputTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
};

export type ProviderState = Record<string, unknown>;

export type CommandApprovalDecision = "deny" | "once" | "thread" | "sandbox";

export type ModelResponse = {
  text: string;
  reasoning?: string;
  toolCalls: ToolCall[];
  finishReason?: string;
  usage?: Usage;
  sources?: SourceReference[];
  providerState?: ProviderState;
};

export type RunEvent =
  | {
      type: "run.started";
      task: string;
      model: string;
      providerId: string;
      providerConnectionId: string;
      instructions?: string[];
    }
  | { type: "context.compaction.started"; afterSequence: number }
  | {
      type: "context.compaction.completed";
      id: string;
      afterSequence: number;
      sourceCharacters: number;
      summaryCharacters: number;
      summary: string;
      model: string;
    }
  | { type: "context.compaction.failed"; message: string }
  | { type: "provider.waiting"; connectionName: string; active: number; limit: number }
  | { type: "provider.ready" }
  | {
      type: "image.understanding.completed";
      imageName: string;
      kind: "description" | "inspection";
      cached: boolean;
      model: string;
      providerId: string;
      providerConnectionId: string;
      usage?: Usage;
      durationMs?: number;
      question?: string;
    }
  | {
      type: "context.applied";
      id: string;
      injectedCharacters: number;
      estimatedTokens: number;
    }
  | { type: "model.started"; step: number }
  | { type: "model.delta"; step: number; text: string }
  | { type: "model.reasoning.delta"; step: number; text: string }
  | { type: "model.tool.delta"; step: number; index: number; name: string; argumentChars: number }
  | { type: "model.retry"; step: number; attempt: number; maxRetries: number; message: string; delayMs: number }
  | { type: "permission.requested"; id: string; command: string; cwd: string; reason: string; suggestedPaths?: string[] }
  | { type: "permission.resolved"; id: string; decision: CommandApprovalDecision }
  | { type: "model.completed"; step: number; sequence: number; model: string; providerId: string; providerConnectionId: string; durationMs: number; response: ModelResponse }
  | { type: "tool.started"; step: number; index: number; call: ToolCall }
  | { type: "tool.updated"; callId: string; update: SubagentActivityUpdate }
  | {
      type: "tool.completed";
      step: number;
      index: number;
      sequence: number;
      call: ToolCall;
      content: string;
      isError: boolean;
      exitCode?: number | null;
      details?: SubagentActivity;
      durationMs?: number;
      presentation?: ToolPresentation;
    }
  | { type: "run.completed"; text: string; steps: number }
  | { type: "run.persisted"; entries: Array<{ sequence: number; entryId: string }> }
  | { type: "thread.title.generated"; title: string }
  | { type: "run.failed"; message: string };
