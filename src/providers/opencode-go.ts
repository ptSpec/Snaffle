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
  ProviderAllowanceItem,
  ProviderModel,
  ProviderRuntimeOptions,
  ProviderStatus,
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

export async function getOpenCodeGoStatus(
  connection: ResolvedProviderConnection,
  signal?: AbortSignal,
): Promise<ProviderStatus> {
  const response = await fetch(`${connection.baseUrl.replace(/\/$/, "")}/usage`, {
    headers: connection.apiKey ? { authorization: `Bearer ${connection.apiKey}` } : {},
    ...(signal ? { signal } : {}),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error(`OpenCode Go usage request failed (${response.status})`);
  }
  if (!response.ok) return { message: "Connected" };

  const body = await response.json() as { usage?: Record<string, unknown> };
  const items = [
    allowanceItem("5-hour", body.usage?.rolling),
    allowanceItem("Weekly", body.usage?.weekly),
    allowanceItem("Monthly", body.usage?.monthly),
  ].filter((item): item is ProviderAllowanceItem => item !== null);
  return {
    message: "Connected",
    ...(items.length ? { allowance: { items } } : {}),
  };
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

function allowanceItem(label: string, raw: unknown): ProviderAllowanceItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.percent !== "number" || !Number.isFinite(value.percent)) return null;
  return {
    label,
    usedPercent: Math.min(100, Math.max(0, value.percent)),
    ...(typeof value.resetsAt === "string" ? { resetsAt: value.resetsAt } : {}),
  };
}
