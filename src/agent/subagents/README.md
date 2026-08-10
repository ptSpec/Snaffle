# Subagents

This folder contains the small boundary for delegated agent work.

- `profile.ts` validates the user-selected provider, model, turn limit, local capacity, and optional remote overflow route.
- `activity.ts` holds stable child-run nodes and their live/persisted inspector payloads.
- `tool.ts` exposes the single optional `delegate_task` tool to the parent model.
- `check-tool.ts` exposes a narrow child-only command tool for Git inspection and verification.
- `capacity.ts` limits concurrent requests without adding scheduling details to the model-facing schema.
- `runner.ts` runs up to four Explore, Review, or Test tasks concurrently, or one Implement task, with no recursion.

The child returns one compact, predictable handoff: status, findings, changes, verification, and follow-up.
Explore receives read and search. Review and Test add narrowly accepted inspection or verification commands. Implement receives the five core coding tools and shares the parent workspace, sandbox, and approval flow. Only one Implement agent may run in a workspace at once.

Provider credentials, capacity, and overflow routing stay outside the model-facing tool schema. Main model requests and delegated work share the configured local slots. Remote overflow is optional because it can move delegated workspace context outside the local machine.
