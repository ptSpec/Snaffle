# Providers

Providers translate Snaffle messages and tool definitions to remote or local model APIs. `openai-compatible.ts` contains the shared wire protocol; `openrouter.ts` adds OpenRouter behavior.

Provider retry and stream parsing stay here. Agent behavior and tool execution do not.
