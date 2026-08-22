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
    defaultRequestLimit: 8,
    providesAllowance: true,
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
    defaultRequestLimit: 8,
    defaultContextLength: 1_000_000,
    sendParallelToolCalls: false,
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    defaultBaseUrl: "https://opencode.ai/zen/go/v1",
    apiKey: "required",
    description: "Connect an OpenCode Go subscription and discover its curated model catalog.",
    baseUrlHint: "OpenCode Go uses its official subscription endpoint.",
    fixedBaseUrl: true,
    defaultRequestLimit: 8,
    providesAllowance: true,
  },
  {
    id: "llama-cpp",
    name: "llama.cpp",
    defaultBaseUrl: "http://localhost:8080/v1",
    apiKey: "optional",
    description: "Connect to a llama.cpp server and discover its loaded model.",
    baseUrlHint: "Use the address printed by llama-server. Current releases default to port 8080 and plan to move to 9931.",
  },
  {
    id: "ollama",
    name: "Ollama",
    defaultBaseUrl: "http://localhost:11434/v1",
    apiKey: "none",
    description: "Connect to Ollama through its OpenAI-compatible API.",
    baseUrlHint: "The default Ollama server uses port 11434 and the /v1 API.",
  },
  {
    id: "lm-studio",
    name: "LM Studio",
    defaultBaseUrl: "http://localhost:1234/v1",
    apiKey: "none",
    description: "Connect to the LM Studio local server and discover its models.",
    baseUrlHint: "The default LM Studio server uses port 1234 and the /v1 API.",
  },
  {
    id: "omlx",
    name: "oMLX",
    defaultBaseUrl: "http://localhost:8000/v1",
    apiKey: "optional",
    description: "Connect to oMLX and discover its local model catalog.",
    baseUrlHint: "The default oMLX server uses port 8000 and the /v1 API.",
    defaultRequestLimit: 8,
  },
  {
    id: "mlx-lm",
    name: "MLX-LM",
    defaultBaseUrl: "http://localhost:8080/v1",
    apiKey: "none",
    description: "Connect to Apple's MLX-LM server and discover downloaded models.",
    baseUrlHint: "The default MLX-LM server uses port 8080 and the /v1 API.",
  },
  {
    id: "unsloth-studio",
    name: "Unsloth Studio",
    defaultBaseUrl: "http://localhost:8888/v1",
    apiKey: "optional",
    description: "Connect to Unsloth Studio and discover its local model catalog.",
    baseUrlHint: "The documented Unsloth Studio launch uses port 8888 and the /v1 API.",
  },
  {
    id: "openai-compatible",
    name: "OpenAI-compatible",
    defaultBaseUrl: "http://localhost:8080/v1",
    apiKey: "optional",
    description: "Connect a local or hosted OpenAI-compatible endpoint.",
    baseUrlHint: "Include the API version, such as /v1.",
  },
  {
    id: "anthropic-compatible",
    name: "Anthropic-compatible",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    apiKey: "optional",
    description: "Connect an endpoint that implements the Anthropic Messages API.",
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
