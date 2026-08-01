import type { Message, ModelResponse, ToolSpec } from "../protocol.js";

export interface ModelProvider {
  readonly model: string;
  complete(
    messages: Message[],
    tools: ToolSpec[],
    signal: AbortSignal,
    onText?: (text: string) => void | Promise<void>,
  ): Promise<ModelResponse>;
}
