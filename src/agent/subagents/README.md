# Subagents

This folder contains the small boundary for delegated agent work.

- `profile.ts` validates the user-selected provider, model, and turn limit.
- `activity.ts` holds stable child-run nodes and their live/persisted inspector payloads.
- `tool.ts` exposes the single optional `delegate_task` tool to the parent model.
- `runner.ts` runs up to four read-only tasks concurrently or one coding task with no recursion.

The child returns one compact, predictable handoff: status, findings, changes, verification, and follow-up.
Read agents receive only read and search. The single writer receives the five core coding tools and shares the parent workspace, sandbox, and approval flow.

Provider credentials and runtime details stay outside the model-facing tool schema.

## Pinned follow-up

- Add explicit Explore, Review, Test, and Implement profiles without exposing more tools to the parent model.
- Let read-only profiles run narrowly classified non-mutating commands, such as tests and `git diff`, without granting general write-capable shell access.
