import type { AttachmentRef, ResolvedAttachment } from "../attachments/types.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import { DEFAULT_MODEL_CONTEXT_LENGTH } from "./provider.js";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export type OpenRouterModel = {
  id: string;
  name: string;
  contextLength: number;
  promptPrice: string | null;
  completionPrice: string | null;
  inputModalities: string[];
};

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
