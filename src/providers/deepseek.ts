import { listOpenAICompatibleModels } from "./openai-compatible.js";
import type {
  ProviderModel,
  ProviderModelReasoning,
  ProviderStatus,
} from "./provider.js";

const DEEPSEEK_REASONING: Record<string, ProviderModelReasoning> = {
  "deepseek-v4-flash": { efforts: ["none", "low", "high", "max"] },
  "deepseek-v4-pro": { efforts: ["none", "high", "max"] },
};

export async function listDeepSeekModels(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
  defaultContextLength?: number,
): Promise<ProviderModel[]> {
  const models = await listOpenAICompatibleModels(
    baseUrl,
    apiKey,
    signal,
    defaultContextLength,
  );
  return models.map((model) => {
    const reasoning = DEEPSEEK_REASONING[model.id];
    return reasoning ? { ...model, reasoning } : model;
  });
}

export async function getDeepSeekStatus(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ProviderStatus> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/user/balance`, {
    headers: { authorization: `Bearer ${apiKey}` },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`DeepSeek balance request failed (${response.status})`);

  const body = await response.json() as DeepSeekBalanceResponse;
  const details = (body.balance_infos ?? []).map((balance) => ({
    label: `${balance.currency} balance`,
    value: balance.total_balance,
  }));
  return {
    message: body.is_available === false ? "Connected · insufficient balance" : "Connected",
    ...(details.length ? { details } : {}),
  };
}

type DeepSeekBalanceResponse = {
  is_available?: boolean;
  balance_infos?: Array<{
    currency: string;
    total_balance: string;
  }>;
};
