import {
  OpenAICompatibleProvider,
  listOpenAICompatibleModels,
  testOpenAICompatibleModel,
} from "./openai-compatible.js";
import {
  AnthropicMessagesProvider,
  listAnthropicModels,
  testAnthropicModel,
} from "./anthropic-messages.js";
import { getDeepSeekStatus } from "./deepseek.js";
import {
  createOpenCodeGoProvider,
  listOpenCodeGoModels,
  testOpenCodeGoModel,
} from "./opencode-go.js";
import {
  getOpenRouterStatus,
  listOpenRouterModels,
} from "./openrouter.js";
import { providerProfile } from "./profiles.js";
import type {
  ModelProvider,
  ProviderCatalog,
  ProviderConnection,
  ProviderDefinition,
  ProviderRuntimeOptions,
  ProviderStatus,
  ResolvedProviderConnection,
} from "./provider.js";

export const OPENROUTER_CONNECTION_ID = "openrouter";

const definitions: ProviderDefinition[] = [
  {
    ...providerProfile("openrouter"),
    create: (connection, modelId, options) => createOpenAICompatible(
      { ...connection, baseUrl: providerProfile("openrouter").defaultBaseUrl },
      modelId,
      options,
    ),
    listModels: (connection, signal) => listOpenRouterModels(requiredKey(connection), signal),
    getStatus: (connection, signal) => getOpenRouterStatus(requiredKey(connection), signal),
  },
  {
    ...providerProfile("deepseek"),
    create: createOpenAICompatible,
    listModels: (connection, signal) => listOpenAICompatibleModels(
      connection.baseUrl,
      requiredKey(connection),
      signal,
      providerProfile("deepseek").defaultContextLength,
    ),
    getStatus: (connection, signal) => getDeepSeekStatus(
      connection.baseUrl,
      requiredKey(connection),
      signal,
    ),
  },
  {
    ...providerProfile("opencode-go"),
    create: createOpenCodeGoProvider,
    listModels: listOpenCodeGoModels,
    testModel: testOpenCodeGoModel,
  },
  openAICompatibleDefinition("llama-cpp"),
  openAICompatibleDefinition("ollama"),
  openAICompatibleDefinition("lm-studio"),
  openAICompatibleDefinition("openai-compatible"),
  anthropicCompatibleDefinition(),
];

export function providerDefinitions(): ProviderDefinition[] {
  return definitions;
}

export function providerDefinition(id: string): ProviderDefinition {
  const definition = definitions.find((item) => item.id === id);
  if (!definition) throw new Error(`Unknown provider: ${id}`);
  return definition;
}

export function createProvider(
  connection: ResolvedProviderConnection,
  modelId: string,
  options: ProviderRuntimeOptions,
): ModelProvider {
  return providerDefinition(connection.providerId).create(connection, modelId, options);
}

export async function providerCatalog(connection: ResolvedProviderConnection): Promise<ProviderCatalog> {
  const publicConnection = withoutSecret(connection);
  try {
    const discovered = await providerDefinition(connection.providerId).listModels?.(connection) ?? [];
    return {
      connection: publicConnection,
      models: mergeModels(discovered, connection.manualModels),
      discoveredModelCount: discovered.length,
    };
  } catch (error) {
    if (connection.manualModels.length) {
      return {
        connection: publicConnection,
        models: connection.manualModels,
        discoveredModelCount: 0,
        error: errorMessage(error),
      };
    }
    throw error;
  }
}

export async function providerStatus(connection: ResolvedProviderConnection): Promise<ProviderStatus> {
  const definition = providerDefinition(connection.providerId);
  const status = definition.getStatus;
  if (status) return status(connection);
  try {
    await definition.listModels?.(connection);
    return { message: "Connected" };
  } catch (discoveryError) {
    const model = connection.manualModels[0];
    if (!model || !definition.testModel) throw discoveryError;
    await definition.testModel(connection, model.id);
    return {
      message: "Connected",
      details: [
        { label: "Model", value: model.name },
        { label: "Discovery", value: "Unavailable" },
      ],
    };
  }
}

export function withoutSecret(connection: ResolvedProviderConnection): ProviderConnection {
  const { apiKey: _apiKey, ...publicConnection } = connection;
  return publicConnection;
}

function createOpenAICompatible(
  connection: ResolvedProviderConnection,
  modelId: string,
  options: ProviderRuntimeOptions,
): ModelProvider {
  const sendParallelToolCalls = providerDefinition(connection.providerId).sendParallelToolCalls;
  return new OpenAICompatibleProvider({
    baseUrl: connection.baseUrl,
    model: modelId,
    providerId: connection.providerId,
    connectionId: connection.id,
    ...(sendParallelToolCalls === undefined ? {} : { sendParallelToolCalls }),
    ...(connection.apiKey ? { apiKey: connection.apiKey } : {}),
    ...options,
  });
}

function openAICompatibleDefinition(id: string): ProviderDefinition {
  const profile = providerProfile(id);
  return {
    ...profile,
    create: createOpenAICompatible,
    listModels: (connection, signal) => listOpenAICompatibleModels(
      connection.baseUrl,
      connection.apiKey,
      signal,
      profile.defaultContextLength,
    ),
    testModel: (connection, modelId, signal) => testOpenAICompatibleModel(
      connection.baseUrl,
      modelId,
      connection.apiKey,
      signal,
    ),
  };
}

function anthropicCompatibleDefinition(): ProviderDefinition {
  const profile = providerProfile("anthropic-compatible");
  return {
    ...profile,
    create: (connection, modelId, options) => new AnthropicMessagesProvider({
      baseUrl: connection.baseUrl,
      model: modelId,
      providerId: connection.providerId,
      connectionId: connection.id,
      ...(connection.apiKey ? { apiKey: connection.apiKey } : {}),
      ...options,
    }),
    listModels: (connection, signal) => listAnthropicModels(
      connection.baseUrl,
      connection.apiKey,
      signal,
      profile.defaultContextLength,
    ),
    testModel: (connection, modelId, signal) => testAnthropicModel(
      connection.baseUrl,
      modelId,
      connection.apiKey,
      signal,
    ),
  };
}

function mergeModels(discovered: ProviderConnection["manualModels"], manual: ProviderConnection["manualModels"]) {
  const models = new Map(discovered.map((model) => [model.id, model]));
  for (const model of manual) models.set(model.id, model);
  return [...models.values()];
}

function requiredKey(connection: ResolvedProviderConnection): string {
  if (!connection.apiKey) throw new Error(`${connection.name} requires an API key`);
  return connection.apiKey;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
