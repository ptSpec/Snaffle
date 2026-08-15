import { ipcMain } from "electron";
import type { DesktopStore } from "../store.js";

export function registerAsideIpc(store: DesktopStore): void {
  ipcMain.handle("desktop:keep-aside", async (_event, threadValue: unknown, entryValue: unknown) => {
    return store.asides.keep(id(threadValue, "Thread"), id(entryValue, "Message"));
  });
  ipcMain.handle("desktop:remove-aside", async (_event, threadValue: unknown, entryValue: unknown) => {
    return store.asides.remove(id(threadValue, "Thread"), id(entryValue, "Message"));
  });
}

function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} ID must be text`);
  return value;
}
