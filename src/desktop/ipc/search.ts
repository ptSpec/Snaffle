import { ipcMain } from "electron";
import type { DesktopSearchResult } from "../api.js";
import type { DesktopStore } from "../store.js";

export function registerSearchIpc(store: DesktopStore): void {
  ipcMain.handle("desktop:search-conversations", (_event, value: unknown): Promise<DesktopSearchResult[]> => {
    if (typeof value !== "string") throw new Error("Search query must be text");
    return store.searchConversations(value);
  });
}
