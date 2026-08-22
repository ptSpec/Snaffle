# Execution

This domain owns workspace file access, command execution, cancellation, and backend-specific isolation.

## Start here

- `workspace.ts` is the only tool-facing workspace boundary for reads, writes, search, and commands.
- `native/sandbox.ts` implements restricted macOS Seatbelt and Linux Bubblewrap execution plus explicit unsafe execution.
- `microsandbox/workspace.ts` contains the removable embedded Microsandbox experiment. It imports the SDK, probes its bundled runtime, and runs commands in the VM without exposing runtime details to tools or the renderer.
- `containers/README.md` records the separate future private-copy boundary.

## Invariants

Every backend should preserve the same workspace-relative file and command behavior so tools do not need backend-specific logic.

- File operations accept relative paths and absolute paths only when their canonical target remains inside the workspace; symlink escapes are rejected.
- Model-controlled commands are restricted by default on macOS and Linux and receive no provider credentials. Microsandbox is an advanced experimental alternative there and the selected restricted engine on Windows. Missing restricted execution blocks a run; host execution is explicit.
- Users may grant specific additional folders to restricted shell commands as read-only or read/write for one thread, workspace, or all workspaces. Native execution can request a grant after an OS denial and retry. Microsandbox applies explicit grants when the next VM starts and does not infer host access from missing guest paths. Global grants and the `network: "allow" | "deny"` setting live in `~/.snaffle/sandbox-access.json`; restricted tools cannot modify that personal configuration. File tools remain workspace-only and workspace Git metadata remains protected.
- Restricted desktop commands share one private `$TMPDIR` per thread. Native execution receives its protected host path; Microsandbox sees it only as `/tmp/snaffle`. It survives follow-up responses and app restarts, is removed with the thread, and is cleaned after five days of inactivity.
- Restricted commands may use the network by default. A global setting can keep sandboxed shell commands offline without changing their filesystem boundary.
- Cancellation terminates active child work where the platform supports it and prevents pending work from starting.
- `run_command` defaults to two minutes and accepts an explicit timeout up to five minutes.
- Restricted native execution is not a VM and must not be described as providing quotas it does not enforce.
- Restricted native execution remains unavailable on Windows. The shared sandbox popover selects Microsandbox there and still offers explicit unsafe host execution.
- The workspace supplies the model-facing command environment. Host platform and shell metadata must not contradict a VM or future remote execution target.

## Microsandbox beta

The beta deliberately keeps the integration narrow:

- The existing `Workspace` behavior still owns file reads, writes, and search.
- Shell commands run in a short-lived `node:24.19.0-bookworm` microVM with a 2 GiB memory limit. The selected workspace is mounted at `/workspace`, thread temporary storage at `/tmp/snaffle`, and Git metadata is over-mounted read-only.
- Explicit additional folders are mounted read-only or read/write. macOS and Linux retain their canonical host path inside the guest; Windows receives a Linux path recorded in the model environment.
- Network policy follows the existing sandbox network setting. No host environment or provider credentials are passed into the VM.
- A run waits while its execution environment is prepared. Startup failures remain visible and never fall back to host execution; unexpectedly killed guest commands mention the memory limit as a possible cause.
- The project mount is writable so current live-edit behavior remains comparable during runtime evaluation. A private captured copy and reviewed patch application are required before this engine can become the final default.
- Removing the experiment means deleting its folder, dependency, one run-construction branch, and the temporary engine selector. Do not spread Microsandbox SDK types or conditionals into tools or the agent loop.
