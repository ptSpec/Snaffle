import type { ReactNode } from "react";
import deepSeekLogo from "../../assets/deepseek-logo.svg?url";
import lmStudioLogo from "../../assets/lm-studio-logo.svg?url";
import openCodeGoLogo from "../../assets/opencode-go-logo.png?url";

export type ProviderVisual = {
  id: string;
  name: string;
  mark: ReactNode;
  logo: boolean;
};

const knownProviders: Array<{
  id: string;
  name: string;
  hosts?: string[];
  localPort?: string;
  short?: string;
}> = [
  { id: "openrouter", name: "OpenRouter", hosts: ["openrouter.ai"] },
  { id: "openai", name: "OpenAI", hosts: ["api.openai.com"], short: "OA" },
  { id: "anthropic", name: "Anthropic", hosts: ["api.anthropic.com"], short: "A" },
  { id: "google", name: "Google AI", hosts: ["generativelanguage.googleapis.com"], short: "G" },
  { id: "groq", name: "Groq", hosts: ["api.groq.com"], short: "GQ" },
  { id: "mistral", name: "Mistral", hosts: ["api.mistral.ai"], short: "M" },
  { id: "together", name: "Together AI", hosts: ["api.together.xyz"], short: "TO" },
  { id: "fireworks", name: "Fireworks AI", hosts: ["api.fireworks.ai"], short: "FW" },
  { id: "deepinfra", name: "DeepInfra", hosts: ["api.deepinfra.com"], short: "DI" },
  { id: "deepseek", name: "DeepSeek", hosts: ["api.deepseek.com"] },
  { id: "opencode-go", name: "OpenCode Go", hosts: ["opencode.ai"], short: "GO" },
  { id: "ollama", name: "Ollama", localPort: "11434", short: "OL" },
  { id: "lm-studio", name: "LM Studio", localPort: "1234", short: "LM" },
  { id: "llama-cpp", name: "llama.cpp", hosts: ["llama.app"], localPort: "8080" },
  { id: "omlx", name: "oMLX", localPort: "8000" },
  { id: "mlx-lm", name: "MLX-LM", localPort: "8080" },
  { id: "unsloth-studio", name: "Unsloth Studio", localPort: "8888" },
];

export function providerVisual(baseUrl: string, providerId?: string): ProviderVisual {
  const url = safeUrl(baseUrl);
  const provider = knownProviders.find((candidate) => candidate.id === providerId)
    ?? knownProviders.find((candidate) =>
    candidate.hosts?.some((host) => url?.hostname === host || url?.hostname.endsWith(`.${host}`))
    || (isLocal(url?.hostname) && candidate.localPort === url?.port));

  if (!provider) return { id: "custom", name: "Custom provider", mark: <RouteMark />, logo: false };
  return {
    id: provider.id,
    name: provider.name,
    logo: ["openrouter", "deepseek", "opencode-go", "lm-studio", "llama-cpp", "omlx", "mlx-lm", "unsloth-studio"].includes(provider.id),
    mark: provider.id === "openrouter"
      ? <OpenRouterMark />
      : provider.id === "deepseek"
        ? <img src={deepSeekLogo} alt="" className="deepseek-mark" />
      : provider.id === "opencode-go"
        ? <img src={openCodeGoLogo} alt="" className="opencode-go-mark" />
      : provider.id === "lm-studio"
        ? <img src={lmStudioLogo} alt="" className="lm-studio-mark" />
      : provider.id === "llama-cpp"
        ? <LlamaCppMark />
      : provider.id === "omlx"
        ? <OmlxMark />
      : provider.id === "mlx-lm"
        ? <MlxMark />
      : provider.id === "unsloth-studio"
        ? <UnslothMark />
        : <span className="provider-monogram" aria-hidden="true">{provider.short}</span>,
  };
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLocal(hostname?: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function RouteMark(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7h10.5l3-3m-3 3 3 3M21 17H10.5l-3 3m3-3-3-3" />
    </svg>
  );
}

function OpenRouterMark(): JSX.Element {
  return (
    <svg viewBox="0 0 512 512" aria-hidden="true" className="openrouter-mark">
      <rect width="512" height="512" rx="104" className="openrouter-mark-background" />
      <path d="M198 120h163c50 0 83 34 83 83 0 45-30 76-82 80l82 83c10 10 3 26-11 26H198c-74 0-134-60-134-136s60-136 134-136Zm0 55c-45 0-80 36-80 81s35 82 80 82c46 0 83-36 83-82s-37-81-83-81Z" />
    </svg>
  );
}

function LlamaCppMark(): JSX.Element {
  return (
    <svg viewBox="0 0 600 600" aria-hidden="true" className="llama-cpp-mark">
      <path d="M600 392 504.249 558l-.112-.071C487.252 584.069 458.193 600 426.864 600H120l120-208h360Z" />
      <path d="M240 392H0L199.602 46.025C216.032 17.546 246.411 0 279.29 0h186.864L240 392Z" />
    </svg>
  );
}

function OmlxMark(): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="local-provider-mark omlx-mark">
      <rect width="32" height="32" rx="8" />
      <path d="M8 22c1.4-8.5 4.9-13 10.4-13 2.8 0 4.7 1.1 6.1 2.7M13 22c1-4.9 2.8-7.4 5.4-7.4 1.4 0 2.4.5 3.2 1.4" />
      <circle cx="20.7" cy="10.2" r="1.2" />
    </svg>
  );
}

function MlxMark(): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="local-provider-mark mlx-mark">
      <rect width="32" height="32" rx="8" />
      <path d="M5 22V10l5 8 5-8v12M18 10v12h5M24 10l5 12M29 10l-5 12" />
    </svg>
  );
}

function UnslothMark(): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="local-provider-mark unsloth-mark">
      <rect width="32" height="32" rx="8" />
      <circle cx="16" cy="16" r="10" />
      <path d="M10.5 14.5c1.6-2 3.4-2 5.5 0 2.1-2 3.9-2 5.5 0M12 19c2.7 2.1 5.3 2.1 8 0" />
      <circle cx="12.7" cy="15.2" r="1" />
      <circle cx="19.3" cy="15.2" r="1" />
    </svg>
  );
}
