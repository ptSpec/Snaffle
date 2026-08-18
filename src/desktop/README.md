# Desktop

This domain owns the trusted Electron host, local application state, typed renderer IPC, and the desktop UI.

## Start here

- `main.ts` composes services and application lifecycle; keep it as wiring rather than a home for domain logic.
- `window.ts` owns native windows and development-versus-packaged browser behavior.
- `settings.ts` persists preferences; `provider-connections.ts` and `mcp-secrets.ts` keep credentials host-side.
- `store.ts` persists workspaces, threads, runs, and timeline data in local libSQL.
- `ipc/` groups renderer-facing operations by responsibility.
- `api.ts` and `preload.cts` define the narrow renderer boundary.
- `renderer/README.md` routes visual changes.

## Invariants

The renderer is isolated: Node access stays in the main process and crosses the typed preload API only.

- Provider credentials, unrestricted filesystem access, process control, and runtime sockets never enter the renderer.
- Development builds may expose DevTools and local conveniences; packaged builds must not inherit unsafe development defaults.
- Large artifacts stay in application storage with metadata in the database.
- UI-only richness should derive from persisted events rather than require more model tools.
- Keep feature-specific persistence and IPC together; do not make `main.ts` or `App.tsx` a second implementation of the domain.
