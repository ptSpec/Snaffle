import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi, DesktopRunEvent, StartRunInput } from "./api.js";

const api: DesktopApi = {
  platform: process.platform,
  getState: () => ipcRenderer.invoke("desktop:get-state"),
  chooseWorkspace: () => ipcRenderer.invoke("desktop:choose-workspace"),
  selectWorkspace: (workspaceId: string) =>
    ipcRenderer.invoke("desktop:select-workspace", workspaceId),
  createThread: (workspaceId: string) =>
    ipcRenderer.invoke("desktop:create-thread", workspaceId),
  selectThread: (threadId: string) => ipcRenderer.invoke("desktop:select-thread", threadId),
  setThreadDraft: (threadId: string, draft: string) =>
    ipcRenderer.invoke("desktop:set-thread-draft", threadId, draft),
  setThreadBookmarked: (threadId: string, bookmarked: boolean) =>
    ipcRenderer.invoke("desktop:set-thread-bookmarked", threadId, bookmarked),
  deleteThreads: (threadIds: string[]) =>
    ipcRenderer.invoke("desktop:delete-threads", threadIds),
  removeWorkspace: (workspaceId: string) =>
    ipcRenderer.invoke("desktop:remove-workspace", workspaceId),
  listOpenRouterModels: () => ipcRenderer.invoke("desktop:list-openrouter-models"),
  startRun: (input: StartRunInput) => ipcRenderer.invoke("desktop:start-run", input),
  stopRun: (threadId: string) => ipcRenderer.invoke("desktop:stop-run", threadId),
  setTheme: (themeId: string) => ipcRenderer.invoke("desktop:set-theme", themeId),
  setMaxSteps: (maxSteps: number) => ipcRenderer.invoke("desktop:set-max-steps", maxSteps),
  openExternal: (url: string) => ipcRenderer.invoke("desktop:open-external", url),
  onRunEvent(listener: (event: DesktopRunEvent) => void): () => void {
    const receiveEvent = (_event: Electron.IpcRendererEvent, event: DesktopRunEvent) => listener(event);
    ipcRenderer.on("desktop:run-event", receiveEvent);
    return () => ipcRenderer.removeListener("desktop:run-event", receiveEvent);
  },
};

contextBridge.exposeInMainWorld("desktop", api);
