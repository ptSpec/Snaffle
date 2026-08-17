# Tools

`built-ins.ts` assembles the default tool set. Each tool stays in one focused file; shared input repair and output shaping live in `input.ts` and `output.ts`.

Keep the default set small. Optional web tools live under `web/`; future external capabilities enter through MCP or extensions rather than enlarging the core set.

The stable core is the five file and command tools. Custom model surfaces also include Plan and whichever optional brokers the user selects. Keeping optional brokers to two is guidance for smaller models rather than an enforced limit; Expanded is an explicit user choice.

## Start here

- `tool.ts` defines the common cancellable tool contract.
- `built-ins.ts` assembles the active built-in set.
- `read.ts`, `search.ts`, `edit.ts`, `write.ts`, and `run.ts` implement the stable five coding tools.
- `plan.ts` implements the optional structured plan and continuation notice.
- `input.ts` performs only safe, unambiguous argument healing; `output.ts` bounds model-facing results.
- `web/README.md` routes optional web behavior.

## Invariants

- Schemas stay shallow and defaults live in the harness.
- Tool output is bounded in model context while complete inspectable records remain available to the user.
- Failed edits require a reread; `write_file` is not a hidden fallback for malformed targeted edits.
- New high-level capabilities should enter through a lazy broker or explicit surface rather than casually expanding the five-tool core.
