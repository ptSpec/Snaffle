# Providers

Providers translate Snaffle messages and tool definitions to remote or local model APIs.

## Start here

- `provider.ts` defines the normalized provider contract and events.
- `registry.ts` owns provider definitions and named behavior.
- `profiles.ts` exposes renderer-safe provider and model metadata.
- `openai-compatible.ts` and `anthropic-messages.ts` implement the shared wire adapters.
- Named files such as `openrouter.ts` and `deepseek.ts` contain only genuinely provider-specific behavior.

## Ownership and invariants

The design has three small pieces:

- A **connection** is user data: name, base URL, secret, enabled state, and optional manual models.
- A **profile** is renderer-safe metadata for Settings and defaults. Profiles live in `profiles.ts`.
- A **definition** attaches inference, catalog, and status behavior. Definitions live in `registry.ts`.

Most hosted and local servers need no new provider code. llama.cpp, Ollama, LM Studio, oMLX, MLX-LM, and Unsloth Studio are named presets over the same OpenAI-compatible runtime. Other servers can use an OpenAI-compatible or Anthropic-compatible connection in Settings, then use model discovery or enter manual models if `/models` is unavailable. Each wire protocol lives in its own adapter.

Add a definition only when a provider has a useful native capability, such as OpenRouter's catalog and allowance or DeepSeek's catalog and account balance. Normalize trustworthy provider allowance data through `ProviderStatus`; the UI must not infer quotas from ordinary request usage. If a future provider uses another inference protocol, implement its adapter here and register its small definition in `registry.ts`.

Models may advertise normalized reasoning efforts through `ProviderModel.reasoning`. The composer shows only efforts the selected model is known to support; Default omits the setting entirely. Provider adapters translate a selected effort to their wire format. OpenCode Go keeps its live catalog authoritative and optionally enriches compatible models from Models.dev, degrading to no reasoning selector when that metadata is unavailable.

Keep provider retry, stream parsing, catalog discovery, and usage normalization here. Keep agent behavior, tools, UI, and analytics provider-neutral. Secrets remain in the Electron main process and must not cross into the renderer.

## Capacity scheduling

Main conversation requests and subagents share each connection's in-memory generation limit. Delegated work may use an explicitly configured overflow model while its selected connection is full. Main conversations preserve their selected model, receive the next available slot ahead of background work, and report when they are waiting. Compaction and other background requests do not yet join this scheduler.
