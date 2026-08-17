# Context

This folder owns the model-facing projection of stored conversation history, context budgets, reports, summaries, and compaction checkpoints.

## Start here

- `projection.ts` selects the conversation events included in a request.
- `prompt.ts` builds the stable instruction and request messages.
- `budget.ts` measures available context.
- `compaction.ts` and `summary.ts` create bounded continuations.
- `report.ts` exposes what was included, omitted, or summarized.
- `store.ts` persists compaction and recovery state.

## Invariants

- The database remains the complete record. Context code decides what a request receives without rewriting that record.
- Full logs, repositories, artifacts, and installed capability catalogs never enter context automatically.
- Compaction is visible and attributable; deterministic omission is preferable to hidden memory behavior.
- An unfinished structured plan is persisted separately from prose summaries and added as one compact recovery block when needed.
- Dynamic context state belongs near the request suffix so stable prompt and tool prefixes remain cacheable.
- Attachments enter only through explicit message references and are bounded before provider submission.
