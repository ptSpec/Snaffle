import type { AttachmentRef, ResolvedAttachment } from "../attachments/types.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import {
  DEFAULT_MODEL_CONTEXT_LENGTH,
  type ProviderModel,
  type ProviderStatus,
} from "./provider.js";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export type OpenRouterModel = ProviderModel;

export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(options: {
    model: string;
    apiKey: string;
    streamIdleTimeoutMs?: number;
    maxRetries?: number;
    temperature?: number;
    seed?: number;
    resolveAttachment?: (attachment: AttachmentRef) => Promise<ResolvedAttachment>;
  }) {
    super({
      baseUrl: OPENROUTER_BASE_URL,
      model: options.model,
      providerId: "openrouter",
      connectionId: "openrouter",
      apiKey: options.apiKey,
      ...(options.streamIdleTimeoutMs === undefined
        ? {}
        : { streamIdleTimeoutMs: options.streamIdleTimeoutMs }),
      ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      ...(options.seed === undefined ? {} : { seed: options.seed }),
      ...(options.resolveAttachment === undefined
        ? {}
        : { resolveAttachment: options.resolveAttachment }),
    });
  }
}

export async function getOpenRouterStatus(apiKey: string, signal?: AbortSignal): Promise<ProviderStatus> {
  const response = await fetch(`${OPENROUTER_BASE_URL}/key`, {
    headers: { authorization: `Bearer ${apiKey}` },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`OpenRouter key request failed (${response.status})`);
  const body = await response.json() as { data?: Record<string, unknown> };
  const data = body.data ?? {};
  const remaining = numberValue(data.limit_remaining);
  const usage = numberValue(data.usage);
  const details = [
    ...(remaining === undefined ? [] : [{ label: "Remaining", value: `$${remaining.toFixed(2)}` }]),
    ...(usage === undefined ? [] : [{ label: "Usage", value: `$${usage.toFixed(2)}` }]),
  ];
  return { message: "Connected", ...(details.length ? { details } : {}) };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export async function listOpenRouterModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<OpenRouterModel[]> {
  const response = await fetch(`${OPENROUTER_BASE_URL}/models/user`, {
    headers: { authorization: `Bearer ${apiKey}` },
    ...(signal === undefined ? {} : { signal }),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 1000);
    throw new Error(`OpenRouter model request failed (${response.status}): ${body}`);
  }

  const body = (await response.json()) as { data?: OpenRouterModelResponse[] };
  if (!Array.isArray(body.data)) throw new Error("OpenRouter returned an invalid model list");

  return body.data.filter(supportsTools).map((model) => ({
    id: model.id,
    name: model.name,
    contextLength: model.context_length ?? DEFAULT_MODEL_CONTEXT_LENGTH,
    promptPrice: model.pricing?.prompt ?? null,
    completionPrice: model.pricing?.completion ?? null,
    inputModalities: model.architecture?.input_modalities ?? ["text"],
  }));
}

function supportsTools(model: OpenRouterModelResponse): boolean {
  return model.supported_parameters?.includes("tools") ?? false;
}

type OpenRouterModelResponse = {
  id: string;
  name: string;
  context_length?: number | null;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  supported_parameters?: string[];
  architecture?: {
    input_modalities?: string[];
  };
};
