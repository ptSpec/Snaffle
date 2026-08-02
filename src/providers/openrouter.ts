import { OpenAICompatibleProvider } from "./openai-compatible.js";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export type OpenRouterModel = {
  id: string;
  name: string;
  contextLength: number | null;
  promptPrice: string | null;
  completionPrice: string | null;
};

export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(options: {
    model: string;
    apiKey: string;
    streamIdleTimeoutMs?: number;
    maxRetries?: number;
  }) {
    super({
      baseUrl: OPENROUTER_BASE_URL,
      model: options.model,
      apiKey: options.apiKey,
      ...(options.streamIdleTimeoutMs === undefined
        ? {}
        : { streamIdleTimeoutMs: options.streamIdleTimeoutMs }),
      ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
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
    contextLength: model.context_length ?? null,
    promptPrice: model.pricing?.prompt ?? null,
    completionPrice: model.pricing?.completion ?? null,
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
};
