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
- On macOS and Linux, users may grant specific additional folders to restricted shell commands as read-only or read/write for one thread, workspace, or all workspaces. A blocked command can add a folder and retry inside the sandbox. Global grants live in `~/.snaffle/sandbox-access.json`; restricted tools cannot modify that personal configuration. File tools remain workspace-only and workspace Git metadata remains protected.
- Restricted commands share one private temporary directory for the run. It is exposed through `$TMPDIR` and removed when the run finishes.
- Network access requires an explicit command request and harness-owned approval.
- Cancellation terminates active child work where the platform supports it and prevents pending work from starting.
- `run_command` defaults to two minutes and accepts an explicit timeout up to five minutes.
- Restricted native execution is not a VM and must not be described as providing quotas it does not enforce.
- Restricted native execution remains unavailable on Windows; never silently fall back to unrestricted execution.
