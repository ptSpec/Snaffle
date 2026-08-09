# Providers

Providers translate Snaffle messages and tool definitions to remote or local model APIs.

The design has three small pieces:

- A **connection** is user data: name, base URL, secret, enabled state, and optional manual models.
- A **profile** is renderer-safe metadata for Settings and defaults. Profiles live in `profiles.ts`.
- A **definition** attaches inference, catalog, and status behavior. Definitions live in `registry.ts`.

Most hosted and local servers need no new provider code. llama.cpp, Ollama, and LM Studio are named presets over the same OpenAI-compatible runtime. Other servers can use an OpenAI-compatible connection in Settings, then use model discovery or enter manual models if `/models` is unavailable. `openai-compatible.ts` owns that shared wire protocol.

Add a definition only when a provider has a useful native capability, such as OpenRouter's catalog and key status or DeepSeek's catalog and account balance. If a future provider uses another inference protocol, implement its adapter here and register its small definition in `registry.ts`.

Keep provider retry, stream parsing, catalog discovery, and usage normalization here. Keep agent behavior, tools, UI, and analytics provider-neutral. Secrets remain in the Electron main process and must not cross into the renderer.
