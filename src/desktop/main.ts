import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type { OpenDialogOptions } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { runAgent } from "../agent-loop.js";
import { PRODUCT } from "../identity.js";
import { OpenRouterProvider, listOpenRouterModels } from "../providers/openrouter.js";
import type { Message, RunEvent } from "../protocol.js";
import type { Trace } from "../trace.js";
import { defaultTools } from "../tools/default-tools.js";
import { LocalWorkspace } from "../workspace.js";
import type { DesktopState, DesktopWorkspace, StartRunInput } from "./api.js";

const desktopDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererPath = path.join(desktopDirectory, "../../renderer/index.html");
const preloadPath = path.join(desktopDirectory, "preload.cjs");

let mainWindow: BrowserWindow | undefined;
let workspace: DesktopWorkspace | null = null;
let activeRun: { controller: AbortController } | undefined;
let conversation: Message[] = [];
const DEVELOPMENT_MODEL = "openai/gpt-5.6-luna";

const memoryTrace: Trace = {
  async write(): Promise<void> {
    // Persistence is intentionally outside this first desktop slice.
  },
};

function start(): void {
  loadDevelopmentEnvironment();
  if (!app.isPackaged) {
    workspace = {
      path: process.cwd(),
      name: path.basename(process.cwd()) || process.cwd(),
    };
  }
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: PRODUCT.name,
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#181818",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    ...(process.platform === "darwin"
      ? {
          trafficLightPosition: { x: 12, y: 14 },
        }
      : {
          titleBarOverlay: {
            color: "#181818",
            symbolColor: "#e8e8e8",
            height: 40,
          },
        }),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void mainWindow.loadFile(rendererPath);
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

function registerIpc(): void {
  ipcMain.handle("desktop:get-state", (): DesktopState => ({
    workspace,
    openRouterAvailable: Boolean(process.env.OPENROUTER_API_KEY),
    runActive: activeRun !== undefined,
    defaultModel: app.isPackaged ? null : DEVELOPMENT_MODEL,
    unsafeHostDefault: !app.isPackaged,
  }));

  ipcMain.handle("desktop:choose-workspace", async (event): Promise<DesktopWorkspace | null> => {
    if (activeRun) throw new Error("Stop the active run before choosing another workspace");

    const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    const options: OpenDialogOptions = {
      title: "Choose a workspace",
      properties: ["openDirectory"],
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);

    const selectedPath = result.filePaths[0];
    if (result.canceled || !selectedPath) return null;

    if (workspace?.path !== selectedPath) conversation = [];
    workspace = {
      path: selectedPath,
      name: path.basename(selectedPath) || selectedPath,
    };
    return workspace;
  });

  ipcMain.handle("desktop:list-openrouter-models", async () => {
    return listOpenRouterModels(openRouterApiKey());
  });

  ipcMain.handle("desktop:start-run", async (_event, rawInput: unknown): Promise<void> => {
    const input = parseStartRunInput(rawInput);
    if (!workspace) throw new Error("Choose a workspace before starting a run");
    if (!input.unsafeHostExecution) {
      throw new Error("Unsafe host execution must be explicitly enabled before starting a run");
    }
    if (activeRun) throw new Error("A run is already active");

    const apiKey = openRouterApiKey();
    const controller = new AbortController();
    const run = { controller };
    const selectedWorkspace = workspace;
    activeRun = run;

    void runAgent({
      task: input.task,
      provider: new OpenRouterProvider({ model: input.model, apiKey }),
      tools: defaultTools(),
      workspace: new LocalWorkspace(selectedWorkspace.path, true),
      trace: memoryTrace,
      signal: controller.signal,
      history: conversation,
      onEvent: sendRunEvent,
    })
      .then((result) => {
        conversation = result.messages;
      })
      .catch(() => undefined)
      .finally(() => {
        if (activeRun === run) activeRun = undefined;
      });
  });

  ipcMain.handle("desktop:stop-run", (): boolean => {
    if (!activeRun) return false;
    activeRun.controller.abort();
    return true;
  });

  ipcMain.handle("desktop:reset-conversation", (): void => {
    if (activeRun) throw new Error("Stop the active run before starting a new thread");
    conversation = [];
  });
}

function parseStartRunInput(input: unknown): StartRunInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Run input must be an object");
  }

  const value = input as Record<string, unknown>;
  const task = typeof value.task === "string" ? value.task.trim() : "";
  const model = typeof value.model === "string" ? value.model.trim() : "";

  if (!task) throw new Error("Enter a task before starting a run");
  if (task.length > 30000) throw new Error("Task is too long");
  if (!model) throw new Error("Choose an OpenRouter model before starting a run");
  if (typeof value.unsafeHostExecution !== "boolean") {
    throw new Error("Unsafe host execution consent is required");
  }

  return { task, model, unsafeHostExecution: value.unsafeHostExecution };
}

function openRouterApiKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Set OPENROUTER_API_KEY in the development environment");
  return apiKey;
}

function sendRunEvent(event: RunEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:run-event", event);
}

function loadDevelopmentEnvironment(): void {
  const environmentPath = path.join(process.cwd(), ".env");
  if (!app.isPackaged && existsSync(environmentPath)) loadEnvFile(environmentPath);
}

app.whenReady().then(start).catch(reportStartupError);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  activeRun?.controller.abort();
});

function reportStartupError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  app.quit();
}
