# Tools

`built-ins.ts` assembles the default tool set. Each tool stays in one focused file; shared input repair and output shaping live in `input.ts` and `output.ts`.

Keep the default set small. Optional web tools live under `web/`; future external capabilities enter through MCP or extensions rather than enlarging the core set.
