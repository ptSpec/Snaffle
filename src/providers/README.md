# Providers

Providers translate Snaffle messages and tool definitions to remote or local model APIs.

The design has three small pieces:

- A **connection** is user data: name, base URL, secret, enabled state, and optional manual models.
- A **profile** is renderer-safe metadata for Settings and defaults. Profiles live in `profiles.ts`.
- A **definition** attaches inference, catalog, and status behavior. Definitions live in `registry.ts`.

Most hosted and local servers need no new provider code. llama.cpp, Ollama, and LM Studio are named presets over the same OpenAI-compatible runtime. Other servers can use an OpenAI-compatible or Anthropic-compatible connection in Settings, then use model discovery or enter manual models if `/models` is unavailable. Each wire protocol lives in its own adapter.

Before v1, add named profiles for oMLX, MLX, and Unsloth Studio. Reuse an existing wire adapter where possible, discover models when the server documents a catalog endpoint, and keep manual model entry as the fallback. Evaluate provider-specific status, model-loading, usage, and hardware information in that later provider branch; add only the capabilities that materially improve the desktop experience.

Add a definition only when a provider has a useful native capability, such as OpenRouter's catalog and key status or DeepSeek's catalog and account balance. If a future provider uses another inference protocol, implement its adapter here and register its small definition in `registry.ts`.

Keep provider retry, stream parsing, catalog discovery, and usage normalization here. Keep agent behavior, tools, UI, and analytics provider-neutral. Secrets remain in the Electron main process and must not cross into the renderer.

## Capacity scheduling

The first scheduler slice is deliberately scoped to the configured subagent connection. Main conversation requests and subagents share its in-memory generation limit. Delegated work may use an explicitly configured overflow provider while those slots are full; main conversations preserve their selected model and queue. Compaction and other background requests do not yet join this scheduler. Remote overflow remains opt-in because it can move workspace content outside the local privacy boundary.
