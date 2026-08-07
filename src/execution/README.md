# Execution

`workspace.ts` is the tool-facing workspace boundary. `native/` contains host sandbox implementations. `containers/` is the future container backend.

Every backend should preserve the same workspace-relative file and command behavior so tools do not need backend-specific logic.
