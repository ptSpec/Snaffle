import {
  AnthropicMessagesProvider,
  testAnthropicModel,
} from "./anthropic-messages.js";
import {
  OpenAICompatibleProvider,
  listOpenAICompatibleModels,
  testOpenAICompatibleModel,
} from "./openai-compatible.js";
import {
  isReasoningEffort,
  type ModelProvider,
  type ProviderAllowanceItem,
  type ProviderModel,
  type ProviderRuntimeOptions,
  type ProviderStatus,
  type ReasoningEffort,
  type ResolvedProviderConnection,
} from "./provider.js";

const LUNA_MODEL = "gpt-5.6-luna";
const MODELS_DEV_URL = "https://models.dev/api.json";
let capabilityRequest: Promise<Map<string, ReasoningEffort[]>> | undefined;

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
    reasoningFormat: "standard" as const,
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
  const available = models.filter((model) => bareModelId(model.id) !== LUNA_MODEL);
  if (new URL(connection.baseUrl).hostname !== "opencode.ai") return available;
  let reasoning = new Map<string, ReasoningEffort[]>();
  try {
    reasoning = await openCodeGoReasoning();
  } catch {
    // Model discovery remains useful when the optional capability catalog is unavailable.
  }
  return available.map((model) => {
    const efforts = reasoning.get(bareModelId(model.id));
    return efforts?.length && !usesMessagesApi(model.id)
      ? { ...model, reasoning: { efforts } }
      : model;
  });
}

async function openCodeGoReasoning(): Promise<Map<string, ReasoningEffort[]>> {
  capabilityRequest ??= fetch(MODELS_DEV_URL, {
    signal: AbortSignal.timeout(5_000),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Models.dev request failed (${response.status})`);
    const body = await response.json() as Record<string, unknown>;
    const provider = record(body["opencode-go"]);
    const models = record(provider?.models);
    const result = new Map<string, ReasoningEffort[]>();
    for (const [id, rawModel] of Object.entries(models ?? {})) {
      const model = record(rawModel);
      const options = Array.isArray(model?.reasoning_options)
        ? model.reasoning_options as unknown[]
        : [];
      const efforts = options.flatMap((option) => {
        const value = record(option);
        return value?.type === "effort" && Array.isArray(value.values)
          ? value.values.filter(isReasoningEffort)
          : [];
      });
      if (efforts.length) result.set(id, [...new Set(efforts)]);
    }
    return result;
  });
  return capabilityRequest;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
