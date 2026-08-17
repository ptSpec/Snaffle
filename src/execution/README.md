# Execution

This domain owns workspace file access, command execution, cancellation, and backend-specific isolation.

## Start here

- `workspace.ts` is the only tool-facing workspace boundary for reads, writes, search, and commands.
- `native/sandbox.ts` implements restricted macOS Seatbelt and Linux Bubblewrap execution plus explicit unsafe execution.
- `containers/README.md` records the future container boundary.

## Invariants

Every backend should preserve the same workspace-relative file and command behavior so tools do not need backend-specific logic.

- File operations accept relative paths and absolute paths only when their canonical target remains inside the workspace; symlink escapes are rejected.
- Model-controlled commands are restricted by default and receive no provider credentials.
- Network access requires an explicit command request and harness-owned approval.
- Cancellation terminates active child work where the platform supports it and prevents pending work from starting.
- `run_command` defaults to two minutes and accepts an explicit timeout up to five minutes.
- Restricted native execution is not a VM and must not be described as providing quotas it does not enforce.
