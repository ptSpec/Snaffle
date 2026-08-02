import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { OpenDialogOptions } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { DEFAULT_MAX_STEPS, runAgent } from "../agent-loop.js";
import { initialMessages } from "../context.js";
import { PRODUCT } from "../identity.js";
import { OpenRouterProvider, listOpenRouterModels } from "../providers/openrouter.js";
import type { Message, RunEvent } from "../protocol.js";
import type { Trace } from "../trace.js";
import { defaultTools } from "../tools/default-tools.js";
import { LocalWorkspace } from "../workspace.js";
import type { DesktopState, StartRunInput } from "./api.js";
import { openStore, type DesktopStore } from "./store.js";
import { DEFAULT_THEME, themeById, type Theme } from "./themes/index.js";

const desktopDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererPath = path.join(desktopDirectory, "../../renderer/index.html");
const preloadPath = path.join(desktopDirectory, "preload.cjs");

let mainWindow: BrowserWindow | undefined;
let store: DesktopStore;
const activeRuns = new Map<
  string,
  { controller: AbortController; threadId: string; workspaceId: string }
>();
let activeTheme: Theme = DEFAULT_THEME;
let maxSteps = DEFAULT_MAX_STEPS;
const DEVELOPMENT_MODEL = "openai/gpt-5.6-luna";

const memoryTrace: Trace = {
  async write(): Promise<void> {
    // Dedicated run traces arrive with persisted run records.
  },
};

async function start(): Promise<void> {
  loadDevelopmentEnvironment();
  const settings = loadSettings();
  activeTheme =
    typeof settings.themeId === "string"
      ? themeById(settings.themeId) ?? DEFAULT_THEME
      : DEFAULT_THEME;
  maxSteps = validMaxSteps(settings.maxSteps) ?? DEFAULT_MAX_STEPS;
  store = await openStore(path.join(app.getPath("userData"), `${PRODUCT.slug}.db`));
  if (process.platform === "darwin") app.dock?.setIcon(applicationIcon());
  if (!app.isPackaged && (await store.state()).workspaces.length === 0) {
    await store.addWorkspace(process.cwd(), path.basename(process.cwd()) || process.cwd());
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
    icon: applicationIcon(),
    backgroundColor: activeTheme.colors["app-background"],
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    ...(process.platform === "darwin"
      ? {
          trafficLightPosition: { x: 12, y: 14 },
        }
      : {
          titleBarOverlay: {
            color: activeTheme.colors["app-background"],
            symbolColor: activeTheme.colors["text-primary"],
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
  void mainWindow.loadFile(rendererPath, { query: { theme: activeTheme.id } });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

function applicationIcon(): string {
  const root = app.isPackaged ? process.resourcesPath : process.cwd();
  return path.join(root, "assets", "logo.png");
}

function registerIpc(): void {
  ipcMain.handle("desktop:get-state", (): Promise<DesktopState> => desktopState());

  ipcMain.handle("desktop:choose-workspace", async (event): Promise<DesktopState | null> => {
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

    await store.addWorkspace(selectedPath, path.basename(selectedPath) || selectedPath);
    return desktopState();
  });

  ipcMain.handle("desktop:select-workspace", async (_event, value: unknown): Promise<DesktopState> => {
    await store.selectWorkspace(parseId(value, "Workspace"));
    return desktopState();
  });

  ipcMain.handle("desktop:create-thread", async (_event, value: unknown): Promise<DesktopState> => {
    await store.createThread(parseId(value, "Workspace"));
    return desktopState();
  });

  ipcMain.handle("desktop:select-thread", async (_event, value: unknown): Promise<DesktopState> => {
    await store.selectThread(parseId(value, "Thread"));
    return desktopState();
  });

  ipcMain.handle(
    "desktop:set-thread-draft",
    async (_event, threadId: unknown, draft: unknown): Promise<void> => {
      if (typeof draft !== "string") throw new Error("Draft must be text");
      await store.setDraft(parseId(threadId, "Thread"), draft);
    },
  );

  ipcMain.handle(
    "desktop:set-thread-bookmarked",
    async (_event, threadId: unknown, bookmarked: unknown): Promise<DesktopState> => {
      if (typeof bookmarked !== "boolean") throw new Error("Bookmark value must be a boolean");
      await store.setBookmarked(parseId(threadId, "Thread"), bookmarked);
      return desktopState();
    },
  );

  ipcMain.handle("desktop:delete-threads", async (_event, value: unknown): Promise<DesktopState> => {
    const threadIds = parseIds(value);
    if (threadIds.some((threadId) => activeRuns.has(threadId))) {
      throw new Error("The running thread cannot be deleted");
    }
    await store.deleteThreads(threadIds);
    return desktopState();
  });

  ipcMain.handle("desktop:remove-workspace", async (_event, value: unknown): Promise<DesktopState> => {
    const workspaceId = parseId(value, "Workspace");
    if ([...activeRuns.values()].some((run) => run.workspaceId === workspaceId)) {
      throw new Error("A workspace with a running thread cannot be removed");
    }
    await store.removeWorkspace(workspaceId);
    return desktopState();
  });

  ipcMain.handle("desktop:list-openrouter-models", async () => {
    return listOpenRouterModels(openRouterApiKey());
  });

  ipcMain.handle("desktop:start-run", async (_event, rawInput: unknown): Promise<void> => {
    const input = parseStartRunInput(rawInput);
    const state = await store.state();
    const selectedWorkspace = state.workspaces.find(
      (workspace) => workspace.threads.some((thread) => thread.id === input.threadId),
    );
    if (!selectedWorkspace) throw new Error("The selected thread no longer exists");
    if (!input.unsafeHostExecution) {
      throw new Error("Unsafe host execution must be explicitly enabled before starting a run");
    }
    if (activeRuns.has(input.threadId)) throw new Error("This thread is already running");

    const apiKey = openRouterApiKey();
    const controller = new AbortController();
    const threadId = input.threadId;
    const run = { controller, threadId, workspaceId: selectedWorkspace.id };
    activeRuns.set(threadId, run);
    let conversation: Message[];
    try {
      conversation = await store.messages(threadId);
      await store.saveMessages(
        threadId,
        conversation.length
          ? [...conversation, { role: "user", content: input.task }]
          : initialMessages(input.task),
      );
    } catch (error) {
      activeRuns.delete(threadId);
      throw error;
    }

    void runAgent({
      task: input.task,
      provider: new OpenRouterProvider({ model: input.model, apiKey }),
      tools: defaultTools(),
      workspace: new LocalWorkspace(selectedWorkspace.path, true),
      trace: memoryTrace,
      signal: controller.signal,
      history: conversation,
      maxSteps,
      onEvent: (event) => sendRunEvent(threadId, event),
    })
      .then((result) => store.saveMessages(threadId, result.messages))
      .catch(() => undefined)
      .finally(() => {
        if (activeRuns.get(threadId) === run) activeRuns.delete(threadId);
      });
  });

  ipcMain.handle("desktop:stop-run", (_event, value: unknown): boolean => {
    const run = activeRuns.get(parseId(value, "Thread"));
    if (!run) return false;
    run.controller.abort();
    return true;
  });

  ipcMain.handle("desktop:set-theme", (_event, themeId: unknown): void => {
    if (typeof themeId !== "string") throw new Error("Theme id must be a string");
    const theme = themeById(themeId);
    if (!theme) throw new Error(`Unknown theme: ${themeId}`);

    activeTheme = theme;
    saveSettings({ themeId: theme.id });
    mainWindow?.setBackgroundColor(theme.colors["app-background"]);
    if (process.platform !== "darwin") {
      mainWindow?.setTitleBarOverlay({
        color: theme.colors["app-background"],
        symbolColor: theme.colors["text-primary"],
        height: 40,
      });
    }
  });

  ipcMain.handle("desktop:set-max-steps", (_event, value: unknown): void => {
    const next = validMaxSteps(value);
    if (next === undefined) throw new Error("Maximum turns must be an integer from 1 to 200");
    maxSteps = next;
    saveSettings({ maxSteps });
  });

  ipcMain.handle("desktop:open-external", async (_event, rawUrl: unknown): Promise<void> => {
    if (typeof rawUrl !== "string") throw new Error("External URL must be a string");
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Only HTTP and HTTPS links can be opened");
    }
    await shell.openExternal(url.href);
  });
}

async function desktopState(): Promise<DesktopState> {
  const state = await store.state();
  const workspace =
    state.workspaces.find((item) => item.id === state.activeWorkspaceId) ?? null;
  return {
    workspace,
    workspaces: state.workspaces,
    activeThreadId: state.activeThreadId,
    conversation: await store.messages(state.activeThreadId),
    openRouterAvailable: Boolean(process.env.OPENROUTER_API_KEY),
    runningThreadIds: [...activeRuns.keys()],
    defaultModel: app.isPackaged ? null : DEVELOPMENT_MODEL,
    unsafeHostDefault: !app.isPackaged,
    themeId: activeTheme.id,
    maxSteps,
  };
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

type SavedSettings = {
  themeId?: unknown;
  maxSteps?: unknown;
};

function loadSettings(): SavedSettings {
  try {
    const file = settingsPath();
    if (!existsSync(file)) return {};
    const settings = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return settings && typeof settings === "object" && !Array.isArray(settings)
      ? settings as SavedSettings
      : {};
  } catch {
    return {};
  }
}

function saveSettings(update: { themeId?: string; maxSteps?: number }): void {
  const file = settingsPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...loadSettings(), ...update }, null, 2)}\n`);
}

function validMaxSteps(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 200
    ? Number(value)
    : undefined;
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

  const threadId = typeof value.threadId === "string" ? value.threadId : "";
  if (!threadId) throw new Error("Choose a thread before starting a run");
  return { threadId, task, model, unsafeHostExecution: value.unsafeHostExecution };
}

function parseId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} id must be a string`);
  return value;
}

function parseIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) {
    throw new Error("Thread ids must be an array of strings");
  }
  return value;
}

function openRouterApiKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Set OPENROUTER_API_KEY in the development environment");
  return apiKey;
}

function sendRunEvent(threadId: string, event: RunEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:run-event", { threadId, event });
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
  for (const run of activeRuns.values()) run.controller.abort();
  store?.close();
});

function reportStartupError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  app.quit();
}
