# Desktop

`main.ts` composes the Electron process. `window.ts` creates windows, `settings.ts` persists preferences, `store.ts` persists app data, and `ipc/` groups renderer-facing operations by responsibility.

The renderer is isolated: Node access stays in the main process and crosses the typed preload API only.
