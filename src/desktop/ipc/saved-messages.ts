import { ipcMain } from "electron";
import type { DesktopState, SaveMessageInput } from "../api.js";
import type { DesktopStore } from "../store.js";

export function registerSavedMessageIpc(store: DesktopStore, state: () => Promise<DesktopState>): void {
  ipcMain.handle("desktop:save-message", async (_event, value: unknown) => {
    return store.savedMessages.save(saveInput(value));
  });
  ipcMain.handle("desktop:delete-saved-message", async (_event, value: unknown) => {
    return store.savedMessages.delete(id(value));
  });
  ipcMain.handle("desktop:list-saved-messages", () => store.savedMessages.list());
  ipcMain.handle("desktop:open-saved-message", async (_event, value: unknown) => {
    const source = await store.savedMessages.source(id(value));
    if (!source) return null;
    await store.selectThread(source.threadId);
    return { state: await state(), entryId: source.entryId };
  });
}

function saveInput(value: unknown): SaveMessageInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid saved message");
  const input = value as Record<string, unknown>;
  if (typeof input.threadId !== "string" || !Number.isInteger(input.sequence) || typeof input.text !== "string") {
    throw new Error("Invalid saved message");
  }
  return {
    threadId: input.threadId,
    sequence: Number(input.sequence),
    text: input.text,
    ...(typeof input.model === "string" ? { model: input.model } : {}),
  };
}

function id(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Saved message ID must be text");
  return value;
}
