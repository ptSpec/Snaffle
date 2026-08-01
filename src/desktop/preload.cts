import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi, StartRunInput } from "./api.js";
import type { RunEvent } from "../protocol.js";

const api: DesktopApi = {
  getState: () => ipcRenderer.invoke("desktop:get-state"),
  chooseWorkspace: () => ipcRenderer.invoke("desktop:choose-workspace"),
  listOpenRouterModels: () => ipcRenderer.invoke("desktop:list-openrouter-models"),
  startRun: (input: StartRunInput) => ipcRenderer.invoke("desktop:start-run", input),
  stopRun: () => ipcRenderer.invoke("desktop:stop-run"),
  onRunEvent(listener: (event: RunEvent) => void): () => void {
    const receiveEvent = (_event: Electron.IpcRendererEvent, event: RunEvent) => listener(event);
    ipcRenderer.on("desktop:run-event", receiveEvent);
    return () => ipcRenderer.removeListener("desktop:run-event", receiveEvent);
  },
};

contextBridge.exposeInMainWorld("desktop", api);
