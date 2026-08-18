# Capability surfaces

This domain decides which already-configured high-level tools are exposed to a particular model or run. It does not install capabilities or execute them.

## Start here

- `surface.ts` derives the persisted per-model Custom or Expanded surface.
- `active.ts` resolves temporary thread and run activation.

## Invariants

- Custom contains the five coding tools, Plan, and only the optional brokers selected for that model.
- Expanded is an explicit user choice that exposes all configured high-level tools.
- Two optional capabilities is guidance for smaller models, not a hard limit.
- Installing or configuring skills, MCP servers, or other extensions never activates them automatically.
- The active surface stays visible near the composer without requiring schema changes elsewhere in the harness.
