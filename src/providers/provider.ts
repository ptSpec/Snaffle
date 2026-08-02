import type { Message, ModelResponse, ToolSpec } from "../protocol.js";

export type ModelStreamEvent =
  | { type: "text.delta"; text: string }
  | { type: "reasoning.delta"; text: string }
  | { type: "tool.delta"; index: number; name: string }
  | { type: "retry"; attempt: number; maxRetries: number; message: string };

export interface ModelProvider {
  readonly model: string;
  complete(
    messages: Message[],
    tools: ToolSpec[],
    signal: AbortSignal,
    onEvent?: (event: ModelStreamEvent) => void | Promise<void>,
  ): Promise<ModelResponse>;
}
