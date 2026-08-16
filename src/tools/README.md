# Tools

`built-ins.ts` assembles the default tool set. Each tool stays in one focused file; shared input repair and output shaping live in `input.ts` and `output.ts`.

Keep the default set small. Optional web tools live under `web/`; future external capabilities enter through MCP or extensions rather than enlarging the core set.

The stable core is the five file and command tools. Custom model surfaces also include Plan and whichever optional brokers the user selects. Keeping optional brokers to two is guidance for smaller models rather than an enforced limit; Expanded is an explicit user choice.
