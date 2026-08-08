import { BrowserWindow, dialog, ipcMain } from "electron";
import type { OpenDialogOptions } from "electron";
import path from "node:path";
import type { DesktopState } from "../api.js";
import type { DesktopStore } from "../store.js";

export function registerWorkspaceIpc(options: {
  store: DesktopStore;
  state: (includeConversation?: boolean) => Promise<DesktopState>;
  mainWindow: () => BrowserWindow | undefined;
  runningThread: (threadId: string) => boolean;
  runningWorkspace: (workspaceId: string) => boolean;
  threadsDeleted: (threadIds: string[]) => void;
  defaultModel: () => string;
}): void {
  const { store, state } = options;

  ipcMain.handle("desktop:choose-workspace", async (event): Promise<DesktopState | null> => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? options.mainWindow();
    const dialogOptions: OpenDialogOptions = { title: "Choose a workspace", properties: ["openDirectory"] };
    const result = owner
      ? await dialog.showOpenDialog(owner, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    const selectedPath = result.filePaths[0];
    if (result.canceled || !selectedPath) return null;
    await store.addWorkspace(selectedPath, path.basename(selectedPath) || selectedPath, options.defaultModel());
    return state();
  });

  ipcMain.handle("desktop:select-workspace", async (_event, value: unknown): Promise<DesktopState> => {
    await store.selectWorkspace(id(value, "Workspace"), options.defaultModel());
    return state();
  });
  ipcMain.handle("desktop:create-thread", async (_event, value: unknown): Promise<DesktopState> => {
    await store.createThread(id(value, "Workspace"), options.defaultModel());
    return state();
  });
  ipcMain.handle("desktop:fork-thread", async (
    _event,
    threadValue: unknown,
    sequenceValue: unknown,
  ): Promise<DesktopState> => {
    const threadId = id(threadValue, "Thread");
    if (options.runningThread(threadId)) throw new Error("Wait for the current run to finish before forking");
    if (!Number.isInteger(sequenceValue) || Number(sequenceValue) < 0) {
      throw new Error("Fork point must be a message sequence");
    }
    await store.forkThread(threadId, Number(sequenceValue), undefined, options.defaultModel());
    return state();
  });
  ipcMain.handle("desktop:select-thread", async (_event, value: unknown): Promise<DesktopState> => {
    await store.selectThread(id(value, "Thread"));
    return state();
  });
  ipcMain.handle("desktop:set-thread-draft", async (_event, threadId: unknown, draft: unknown): Promise<void> => {
    if (typeof draft !== "string") throw new Error("Draft must be text");
    await store.setDraft(id(threadId, "Thread"), draft);
  });
  ipcMain.handle("desktop:set-thread-bookmarked", async (
    _event,
    threadId: unknown,
    bookmarked: unknown,
  ): Promise<DesktopState> => {
    if (typeof bookmarked !== "boolean") throw new Error("Bookmark value must be a boolean");
    await store.setBookmarked(id(threadId, "Thread"), bookmarked);
    return state(false);
  });
  ipcMain.handle("desktop:delete-threads", async (_event, value: unknown): Promise<DesktopState> => {
    const threadIds = ids(value);
    if (threadIds.some(options.runningThread)) throw new Error("The running thread cannot be deleted");
    options.threadsDeleted(threadIds);
    await store.deleteThreads(threadIds);
    return state();
  });
  ipcMain.handle("desktop:remove-workspace", async (_event, value: unknown): Promise<DesktopState> => {
    const workspaceId = id(value, "Workspace");
    if (options.runningWorkspace(workspaceId)) {
      throw new Error("A workspace with a running thread cannot be removed");
    }
    await store.removeWorkspace(workspaceId);
    return state();
  });
}

function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} ID must be text`);
  return value;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) {
    throw new Error("Thread IDs must be text");
  }
  return value;
}
