import type { ProviderStatus } from "./provider.js";

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
