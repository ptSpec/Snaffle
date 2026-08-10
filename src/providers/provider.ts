import type { AttachmentRef, ResolvedAttachment } from "../attachments/types.js";
import type { Message, ModelResponse, ToolSpec } from "../protocol.js";

export const DEFAULT_MODEL_CONTEXT_LENGTH = 128_000;
export const DEFAULT_PROVIDER_REQUEST_LIMIT = 1;

export type ProviderModel = {
  id: string;
  name: string;
  contextLength: number;
  inputModalities: string[];
  promptPrice?: string | null;
  completionPrice?: string | null;
};

export type ProviderConnection = {
  id: string;
  providerId: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  requestLimit: number;
  fallbackProviderConnectionId: string;
  fallbackModel: string;
  hasApiKey: boolean;
  manualModels: ProviderModel[];
};

export type ProviderConnectionInput = Omit<ProviderConnection, "hasApiKey"> & {
  apiKey?: string;
};

export type ResolvedProviderConnection = ProviderConnection & {
  apiKey?: string;
};

export type ProviderStatus = {
  message: string;
  details?: Array<{ label: string; value: string }>;
};

export type ProviderModelVariant = {
  id: string;
  label: string;
  description: string;
};

export type ProviderCatalog = {
  connection: ProviderConnection;
  models: ProviderModel[];
  discoveredModelCount: number;
  error?: string;
};

export type ProviderRuntimeOptions = {
  streamIdleTimeoutMs?: number;
  maxRetries?: number;
  resolveAttachment?: (attachment: AttachmentRef) => Promise<ResolvedAttachment>;
};

export type ProviderProfile = {
  id: string;
  name: string;
  defaultBaseUrl: string;
  apiKey: "required" | "optional" | "none";
  description: string;
  baseUrlHint: string;
  fixedBaseUrl?: boolean;
  defaultRequestLimit?: number;
  defaultContextLength?: number;
  sendParallelToolCalls?: boolean;
  modelVariants?: ProviderModelVariant[];
};

export type ProviderDefinition = ProviderProfile & {
  create(
    connection: ResolvedProviderConnection,
    modelId: string,
    options: ProviderRuntimeOptions,
  ): ModelProvider;
  listModels?(connection: ResolvedProviderConnection, signal?: AbortSignal): Promise<ProviderModel[]>;
  getStatus?(connection: ResolvedProviderConnection, signal?: AbortSignal): Promise<ProviderStatus>;
  testModel?(connection: ResolvedProviderConnection, modelId: string, signal?: AbortSignal): Promise<void>;
};

export type ModelStreamEvent =
  | { type: "text.delta"; text: string }
  | { type: "reasoning.delta"; text: string }
  | { type: "tool.delta"; index: number; name: string; argumentChars: number }
  | { type: "retry"; attempt: number; maxRetries: number; message: string };

export interface ModelProvider {
  readonly model: string;
  readonly providerId: string;
  readonly connectionId: string;
  complete(
    messages: Message[],
    tools: ToolSpec[],
    signal: AbortSignal,
    onEvent?: (event: ModelStreamEvent) => void | Promise<void>,
  ): Promise<ModelResponse>;
}
