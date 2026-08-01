export type JsonSchema = Record<string, unknown>;

export type ToolCall = {
  id: string;
  name: string;
  input: unknown;
};

export type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

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

export type ModelResponse = {
  text: string;
  toolCalls: ToolCall[];
  finishReason?: string;
  usage?: Usage;
};

export type RunEvent =
  | { type: "run.started"; task: string; model: string }
  | { type: "model.completed"; step: number; response: ModelResponse }
  | { type: "tool.started"; call: ToolCall }
  | {
      type: "tool.completed";
      call: ToolCall;
      content: string;
      isError: boolean;
      exitCode?: number | null;
    }
  | { type: "run.completed"; text: string; steps: number }
  | { type: "run.failed"; message: string };
