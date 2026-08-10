import {
  AnthropicMessagesProvider,
  testAnthropicModel,
} from "./anthropic-messages.js";
import {
  OpenAICompatibleProvider,
  listOpenAICompatibleModels,
  testOpenAICompatibleModel,
} from "./openai-compatible.js";
import type {
  ModelProvider,
  ProviderModel,
  ProviderRuntimeOptions,
  ResolvedProviderConnection,
} from "./provider.js";

const LUNA_MODEL = "gpt-5.6-luna";

export function createOpenCodeGoProvider(
  connection: ResolvedProviderConnection,
  modelId: string,
  options: ProviderRuntimeOptions,
): ModelProvider {
  rejectLuna(modelId);
  const shared = {
    baseUrl: connection.baseUrl,
    model: modelId,
    providerId: connection.providerId,
    connectionId: connection.id,
    ...(connection.apiKey ? { apiKey: connection.apiKey } : {}),
    ...options,
  };
  return usesMessagesApi(modelId)
    ? new AnthropicMessagesProvider(shared)
    : new OpenAICompatibleProvider(shared);
}

export async function listOpenCodeGoModels(
  connection: ResolvedProviderConnection,
  signal?: AbortSignal,
): Promise<ProviderModel[]> {
  const models = await listOpenAICompatibleModels(
    connection.baseUrl,
    connection.apiKey,
    signal,
  );
  return models.filter((model) => bareModelId(model.id) !== LUNA_MODEL);
}

export function testOpenCodeGoModel(
  connection: ResolvedProviderConnection,
  modelId: string,
  signal?: AbortSignal,
): Promise<void> {
  rejectLuna(modelId);
  return usesMessagesApi(modelId)
    ? testAnthropicModel(connection.baseUrl, modelId, connection.apiKey, signal)
    : testOpenAICompatibleModel(connection.baseUrl, modelId, connection.apiKey, signal);
}

function usesMessagesApi(modelId: string): boolean {
  const id = bareModelId(modelId);
  return id.startsWith("minimax-") || id.startsWith("qwen3.");
}

function bareModelId(modelId: string): string {
  return modelId.split("/").at(-1) ?? modelId;
}

function rejectLuna(modelId: string): void {
  if (bareModelId(modelId) === LUNA_MODEL) {
    throw new Error("GPT-5.6 Luna requires the Responses API and is not available through OpenCode Go yet");
  }
}
