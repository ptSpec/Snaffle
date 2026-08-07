# Desktop

`main.ts` composes the Electron process. `window.ts` creates windows, `settings.ts` persists preferences, `store.ts` persists app data, and `ipc/` groups renderer-facing operations by responsibility.

The renderer is isolated: Node access stays in the main process and crosses the typed preload API only.

## Planned theme palette

`Snaffle White` should start from these colors when it is implemented:

```css
--app-background: #fffee1;
--sidebar-background: color-mix(in srgb, #fffbcf 92%, transparent);
```

This is a design note only; the theme is not yet enabled.
