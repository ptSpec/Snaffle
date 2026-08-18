# Subagents

This folder contains the small boundary for delegated agent work.

## Start here

- `profile.ts` validates whether delegated work follows the main conversation or uses a fixed model, plus its turn limit and optional overflow route.
- `activity.ts` holds stable child-run nodes and their live/persisted inspector payloads.
- `tool.ts` exposes the single optional `delegate_task` tool to the parent model.
- `check-tool.ts` exposes a narrow child-only command tool for Git inspection and verification.
- `capacity.ts` limits concurrent model generations without adding scheduling details to the model-facing schema.
- `runner.ts` runs up to four Explore, Review, or Test tasks concurrently, or one Implement task, with no recursion.

## Invariants

The child returns one compact, predictable handoff: status, findings, changes, verification, and follow-up.
Explore receives read and search. Review and Test add narrowly accepted inspection or verification commands. Implement receives the five core coding tools and shares the parent workspace, sandbox, and approval flow. Only one Implement agent may run in a workspace at once.

Provider credentials, capacity, and overflow routing stay outside the model-facing tool schema. Main model requests and delegated work share the configured connection slots. Overflow is optional, applies only to delegated work, and remains visible in subagent activity.
Following the main conversation is the default; a fixed subagent model is an explicit user choice.
