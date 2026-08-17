# Agent

This domain owns the provider-neutral model → tool → result loop and its observable trace. It does not own provider translation, workspace policy, context selection, or UI state.

## Start here

- `loop.ts` runs model steps, validates requests, invokes tools, enforces active plans, and propagates cancellation.
- `trace.ts` defines and records model, tool, usage, and completion activity.
- `subagents/README.md` routes delegated work.

## Invariants

- Core tool calls remain serialized.
- A successful `update_plan` call becomes a lightweight run contract: ordinary completion is rejected while actionable items remain.
- Cancellation is checked before and after tool calls and reaches long-running operations through the shared signal.
- Provider-specific behavior and UI-derived orchestration stay outside this folder.
- Hidden reflection, automatic decomposition, and recursive delegation are not default loop behavior.

Keep provider translation, workspace enforcement, and UI state outside this folder. The loop should depend on their small interfaces instead.
