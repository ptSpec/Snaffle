# Git

This folder owns Git process execution, repository inspection, file diffs, saves, commits, and their shared types.

It must not import Electron or renderer code. Desktop IPC exposes these operations to the UI.

## Start here

- `process.ts` runs bounded Git commands.
- `repository.ts` reads repository state and structured changes.
- `walkthrough.ts` builds balanced per-file working-tree and merge-base branch evidence for isolated Inspector walkthroughs.
- `actions.ts` performs saves and selective local commits.
- `types.ts` defines the provider-neutral data consumed by desktop IPC and UI.

## Invariants

- Capture the repository baseline and distinguish pre-existing user changes from agent changes.
- Prefer reviewed patch application and stop on drift or conflicts instead of attempting destructive recovery.
- Do not alter the user's staging area unless the requested action requires it.
- Branch creation, pushes, pulls, rebases, and hosting workflows remain explicit user-authorized operations.
