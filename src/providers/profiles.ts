import type { ProviderModelVariant, ProviderProfile } from "./provider.js";

const OPENROUTER_MODEL_VARIANTS: ProviderModelVariant[] = [
  {
    id: "",
    label: "Default",
    description: "Use OpenRouter's default provider routing.",
  },
  {
    id: "nitro",
    label: "Fast",
    description: "Prioritize providers with higher throughput.",
  },
  {
    id: "floor",
    label: "Lowest cost",
    description: "Prioritize the lowest-priced provider.",
  },
  {
    id: "exacto",
    label: "Tool reliability",
    description: "Prioritize providers with stronger tool-calling reliability.",
  },
];

export const PROVIDER_PROFILES: ProviderProfile[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    apiKey: "required",
    description: "OpenRouter adds its model catalog and key usage status.",
    baseUrlHint: "OpenRouter uses its official API endpoint.",
    fixedBaseUrl: true,
    modelVariants: OPENROUTER_MODEL_VARIANTS,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com",
    apiKey: "required",
    description: "DeepSeek adds its official model catalog and account balance.",
    baseUrlHint: "DeepSeek uses its official API endpoint.",
    fixedBaseUrl: true,
    defaultContextLength: 1_000_000,
    sendParallelToolCalls: false,
  },
  {
    id: "openai-compatible",
    name: "OpenAI-compatible",
    defaultBaseUrl: "http://localhost:8080/v1",
    apiKey: "optional",
    description: "Connect a local or hosted OpenAI-compatible endpoint.",
    baseUrlHint: "Include the API version, such as /v1.",
  },
];

export function providerProfile(id: string): ProviderProfile {
  const profile = PROVIDER_PROFILES.find((item) => item.id === id);
  if (!profile) throw new Error(`Unknown provider: ${id}`);
  return profile;
}

export function splitModelVariant(
  modelId: string,
  variants: ProviderModelVariant[] = [],
): { baseModelId: string; variantId: string; routable: boolean } {
  const separator = modelId.lastIndexOf(":");
  if (separator < modelId.lastIndexOf("/")) {
    return { baseModelId: modelId, variantId: "", routable: true };
  }

  const suffix = modelId.slice(separator + 1);
  if (variants.some((variant) => variant.id === suffix && suffix)) {
    return { baseModelId: modelId.slice(0, separator), variantId: suffix, routable: true };
  }
  return { baseModelId: modelId, variantId: "", routable: separator < 0 };
}

export function applyModelVariant(
  modelId: string,
  variantId: string,
  variants: ProviderModelVariant[] = [],
): string {
  const selection = splitModelVariant(modelId, variants);
  if (!selection.routable || !variants.some((variant) => variant.id === variantId)) return modelId;
  return variantId ? `${selection.baseModelId}:${variantId}` : selection.baseModelId;
}
