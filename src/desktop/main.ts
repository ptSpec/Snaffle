import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { OpenDialogOptions } from "electron";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { DEFAULT_MAX_STEPS, runAgent } from "../agent-loop.js";
import { initialMessages } from "../context.js";
import { commitGitChanges, initializeGitRepository, saveGitFile } from "../git/actions.js";
import { safeWorkspacePath } from "../git/process.js";
import { gitChanges, gitDiffPreview, gitFileContents } from "../git/repository.js";
import { PRODUCT } from "../identity.js";
import { OpenRouterProvider, listOpenRouterModels } from "../providers/openrouter.js";
import {
  DEFAULT_PROVIDER_RETRIES,
  DEFAULT_PROVIDER_TIMEOUT_MS,
} from "../providers/openai-compatible.js";
import type { CommandApprovalDecision, Message, RunEvent } from "../protocol.js";
import { probeNativeSandbox } from "../sandbox.js";
import type { Trace } from "../trace.js";
import { defaultTools } from "../tools/default-tools.js";
import { LocalWorkspace, type CommandApprovalRequest } from "../workspace.js";
import type { DesktopState, SaveMessageInput, StartRunInput } from "./api.js";
import { openStore, type DesktopStore } from "./store.js";
import { DEFAULT_THEME, themeById, type Theme } from "./themes/index.js";

const desktopDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererPath = path.join(desktopDirectory, "../../renderer/index.html");
const preloadPath = path.join(desktopDirectory, "preload.cjs");

let mainWindow: BrowserWindow | undefined;
let store: DesktopStore;
const activeRuns = new Map<
  string,
  {
    controller: AbortController;
    threadId: string;
    workspaceId: string;
    steering: string[];
    acceptingSteering: boolean;
  }
>();
const unsafeThreads = new Set<string>();
const pendingApprovals = new Map<
  string,
  { threadId: string; resolve: (decision: CommandApprovalDecision) => void }
>();
let activeTheme: Theme = DEFAULT_THEME;
let editorFontSize = 13;
let editorCommand = "";
let editorArguments = "";
let maxSteps = DEFAULT_MAX_STEPS;
let providerTimeoutMinutes = DEFAULT_PROVIDER_TIMEOUT_MS / 60_000;
let providerRetries = DEFAULT_PROVIDER_RETRIES;
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
  editorFontSize = validEditorFontSize(settings.editorFontSize) ?? editorFontSize;
  editorCommand = typeof settings.editorCommand === "string" ? settings.editorCommand : "";
  editorArguments = typeof settings.editorArguments === "string" ? settings.editorArguments : "";
  maxSteps = validMaxSteps(settings.maxSteps) ?? DEFAULT_MAX_STEPS;
  providerTimeoutMinutes = validProviderTimeout(settings.providerTimeoutMinutes) ?? providerTimeoutMinutes;
  providerRetries = validProviderRetries(settings.providerRetries) ?? DEFAULT_PROVIDER_RETRIES;
  store = await openStore(path.join(app.getPath("userData"), `${PRODUCT.slug}.db`));
  if (process.platform === "darwin" && !app.isPackaged) app.dock?.setIcon(applicationIcon());
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
    ...(process.platform === "darwin" ? {} : { icon: applicationIcon() }),
    backgroundColor: activeTheme.colors.background,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    ...(process.platform === "darwin"
      ? {
          trafficLightPosition: { x: 12, y: 14 },
        }
      : {
          titleBarOverlay: {
            color: activeTheme.colors.background,
            symbolColor: activeTheme.colors.text,
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
      return desktopState(false);
    },
  );

  ipcMain.handle("desktop:delete-threads", async (_event, value: unknown): Promise<DesktopState> => {
    const threadIds = parseIds(value);
    if (threadIds.some((threadId) => activeRuns.has(threadId))) {
      throw new Error("The running thread cannot be deleted");
    }
    threadIds.forEach((threadId) => unsafeThreads.delete(threadId));
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
    if (activeRuns.has(input.threadId)) throw new Error("This thread is already running");
    const unsafe = unsafeThreads.has(input.threadId);
    if (!unsafe) {
      const sandbox = await probeNativeSandbox();
      if (!sandbox.available) throw new Error(sandbox.detail);
    }

    const apiKey = openRouterApiKey();
    const controller = new AbortController();
    const threadId = input.threadId;
    const workspace = new LocalWorkspace(
      selectedWorkspace.path,
      unsafe ? "unsafe" : "restricted",
      (request) => requestCommandApproval(threadId, request),
    );
    const run = {
      controller,
      threadId,
      workspaceId: selectedWorkspace.id,
      steering: [] as string[],
      acceptingSteering: true,
    };
    activeRuns.set(threadId, run);
    let conversation: Message[];
    try {
      conversation = await store.messages(threadId);
      await store.saveMessages(
        threadId,
        conversation.length
          ? [...conversation, { role: "user", content: input.task }]
          : initialMessages(input.task, workspace.environment),
      );
    } catch (error) {
      activeRuns.delete(threadId);
      throw error;
    }

    void runAgent({
      task: input.task,
      provider: new OpenRouterProvider({
        model: input.model,
        apiKey,
        streamIdleTimeoutMs: providerTimeoutMinutes * 60_000,
        maxRetries: providerRetries,
      }),
      tools: defaultTools(),
      workspace,
      trace: memoryTrace,
      signal: controller.signal,
      history: conversation,
      maxSteps,
      takeSteering: () => run.steering.splice(0),
      onEvent: (event) => {
        if (event.type === "run.completed" || event.type === "run.failed") {
          run.acceptingSteering = false;
        }
        sendRunEvent(threadId, event);
      },
    })
      .then(async (result) => {
        await store.saveMessages(threadId, result.messages);
        sendRunEvent(threadId, { type: "run.persisted" });
      })
      .catch(() => undefined)
      .finally(() => {
        if (activeRuns.get(threadId) === run) activeRuns.delete(threadId);
      });
  });

  ipcMain.handle("desktop:steer-run", (_event, rawThreadId: unknown, rawMessage: unknown): boolean => {
    const run = activeRuns.get(parseId(rawThreadId, "Thread"));
    const message = parseSteeringMessage(rawMessage);
    if (!run?.acceptingSteering) return false;
    run.steering.push(message);
    return true;
  });

  ipcMain.handle("desktop:stop-run", (_event, value: unknown): boolean => {
    const run = activeRuns.get(parseId(value, "Thread"));
    if (!run) return false;
    run.controller.abort();
    resolveThreadApprovals(run.threadId, "deny");
    return true;
  });

  ipcMain.handle(
    "desktop:set-thread-unsafe",
    async (_event, rawThreadId: unknown, unsafe: unknown): Promise<DesktopState> => {
      const threadId = parseId(rawThreadId, "Thread");
      if (typeof unsafe !== "boolean") throw new Error("Unsafe state must be a boolean");
      if (activeRuns.has(threadId)) throw new Error("Execution mode cannot change during a run");
      if (unsafe) unsafeThreads.add(threadId);
      else unsafeThreads.delete(threadId);
      return desktopState(false);
    },
  );

  ipcMain.handle(
    "desktop:resolve-command-approval",
    async (_event, rawId: unknown, rawDecision: unknown): Promise<DesktopState> => {
      const id = parseId(rawId, "Approval");
      const decision = parseApprovalDecision(rawDecision);
      const pending = pendingApprovals.get(id);
      if (!pending) throw new Error("This approval request is no longer active");
      pendingApprovals.delete(id);
      if (decision === "thread") unsafeThreads.add(pending.threadId);
      await emitPermissionEvent(pending.threadId, { type: "permission.resolved", id, decision });
      pending.resolve(decision);
      return desktopState(false);
    },
  );

  ipcMain.handle("desktop:set-theme", (_event, themeId: unknown): void => {
    if (typeof themeId !== "string") throw new Error("Theme id must be a string");
    const theme = themeById(themeId);
    if (!theme) throw new Error(`Unknown theme: ${themeId}`);

    activeTheme = theme;
    saveSettings({ themeId: theme.id });
    mainWindow?.setBackgroundColor(theme.colors.background);
    if (process.platform !== "darwin") {
      mainWindow?.setTitleBarOverlay({
        color: theme.colors.background,
        symbolColor: theme.colors.text,
        height: 40,
      });
    }
  });

  ipcMain.handle("desktop:set-editor-font-size", (_event, value: unknown): void => {
    const next = validEditorFontSize(value);
    if (next === undefined) throw new Error("Editor font size must be an integer from 10 to 24");
    editorFontSize = next;
    saveSettings({ editorFontSize });
  });

  ipcMain.handle("desktop:set-editor-launcher", (_event, command: unknown, argumentsTemplate: unknown): void => {
    if (typeof command !== "string" || typeof argumentsTemplate !== "string") {
      throw new Error("Editor command and arguments must be text");
    }
    editorCommand = command.trim();
    editorArguments = argumentsTemplate.trim();
    saveSettings({ editorCommand, editorArguments });
  });

  ipcMain.handle("desktop:choose-editor-application", async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Choose editor application",
      properties: ["openFile"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("desktop:set-max-steps", (_event, value: unknown): void => {
    const next = validMaxSteps(value);
    if (next === undefined) throw new Error("Maximum turns must be an integer from 1 to 200");
    maxSteps = next;
    saveSettings({ maxSteps });
  });

  ipcMain.handle("desktop:set-provider-timeout", (_event, value: unknown): void => {
    const next = validProviderTimeout(value);
    if (next === undefined) throw new Error("Provider timeout must be 1 to 30 minutes");
    providerTimeoutMinutes = next;
    saveSettings({ providerTimeoutMinutes });
  });

  ipcMain.handle("desktop:set-provider-retries", (_event, value: unknown): void => {
    const next = validProviderRetries(value);
    if (next === undefined) throw new Error("Provider retries must be an integer from 0 to 10");
    providerRetries = next;
    saveSettings({ providerRetries });
  });

  ipcMain.handle("desktop:save-message", async (_event, value: unknown) => {
    return store.savedMessages.save(parseSaveMessageInput(value));
  });

  ipcMain.handle("desktop:delete-saved-message", async (_event, value: unknown) => {
    return store.savedMessages.delete(parseId(value, "Saved message"));
  });

  ipcMain.handle("desktop:list-saved-messages", () => store.savedMessages.list());

  ipcMain.handle("desktop:open-saved-message", async (_event, value: unknown) => {
    const source = await store.savedMessages.source(parseId(value, "Saved message"));
    if (!source) return null;
    await store.selectThread(source.threadId);
    return { state: await desktopState(), entryId: source.entryId };
  });

  ipcMain.handle("desktop:get-git-changes", async (_event, value: unknown) => {
    return gitChanges(await workspacePath(value));
  });

  ipcMain.handle("desktop:get-git-file", async (_event, workspaceId: unknown, filePath: unknown) => {
    return gitFileContents(await workspacePath(workspaceId), parseFilePath(filePath));
  });

  ipcMain.handle("desktop:get-git-diff-preview", async (_event, workspaceId: unknown, filePath: unknown) => {
    return gitDiffPreview(await workspacePath(workspaceId), parseFilePath(filePath));
  });

  ipcMain.handle("desktop:save-git-file", async (
    _event,
    workspaceId: unknown,
    filePath: unknown,
    content: unknown,
    lineEnding: unknown,
  ) => {
    if (typeof content !== "string") throw new Error("File content must be a string");
    if (lineEnding !== "lf" && lineEnding !== "crlf") throw new Error("Invalid line ending");
    await saveGitFile(await workspacePath(workspaceId), parseFilePath(filePath), content, lineEnding);
  });

  ipcMain.handle("desktop:commit-git-changes", async (
    _event,
    workspaceId: unknown,
    rawMessage: unknown,
    rawPaths: unknown,
  ) => {
    const workspace = await workspacePath(workspaceId);
    const message = typeof rawMessage === "string" ? rawMessage.trim() : "";
    if (!message) throw new Error("Enter a commit message");
    if (message.length > 6000) throw new Error("Commit message is too long");
    const paths = parseFilePaths(rawPaths);
    for (const filePath of paths) safeWorkspacePath(workspace, filePath);
    await commitGitChanges(workspace, message, paths);
    return gitChanges(workspace);
  });

  ipcMain.handle("desktop:open-workspace-file", async (_event, workspaceId: unknown, filePath: unknown) => {
    const target = safeWorkspacePath(await workspacePath(workspaceId), parseFilePath(filePath));
    if (editorCommand) {
      await launchEditor(target);
      return;
    }
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
  });

  ipcMain.handle("desktop:reveal-workspace-file", async (_event, workspaceId: unknown, filePath: unknown) => {
    shell.showItemInFolder(safeWorkspacePath(await workspacePath(workspaceId), parseFilePath(filePath)));
  });

  ipcMain.handle("desktop:initialize-git-repository", async (_event, workspaceId: unknown) => {
    const workspace = await workspacePath(workspaceId);
    await initializeGitRepository(workspace);
    return gitChanges(workspace);
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

async function workspacePath(value: unknown): Promise<string> {
  const id = parseId(value, "Workspace");
  const workspace = (await store.state()).workspaces.find((item) => item.id === id);
  if (!workspace) throw new Error("The selected workspace no longer exists");
  return workspace.path;
}

function parseFilePath(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("File path must be text");
  return value;
}

function parseFilePaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item)) {
    throw new Error("Select at least one file to commit");
  }
  return value;
}

async function desktopState(includeConversation = true): Promise<DesktopState> {
  const state = await store.state();
  const sandbox = await probeNativeSandbox();
  const workspace =
    state.workspaces.find((item) => item.id === state.activeWorkspaceId) ?? null;
  return {
    workspace,
    workspaces: state.workspaces,
    activeThreadId: state.activeThreadId,
    conversation: includeConversation ? await store.entries(state.activeThreadId) : [],
    savedMessages: await store.savedMessages.summaries(),
    openRouterAvailable: Boolean(process.env.OPENROUTER_API_KEY),
    runningThreadIds: [...activeRuns.keys()],
    unsafeThreadIds: [...unsafeThreads],
    defaultModel: app.isPackaged ? null : DEVELOPMENT_MODEL,
    restrictedHostAvailable: sandbox.available,
    restrictedHostDetail: sandbox.detail,
    themeId: activeTheme.id,
    editorFontSize,
    editorCommand,
    editorArguments,
    maxSteps,
    providerTimeoutMinutes,
    providerRetries,
  };
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

type SavedSettings = {
  themeId?: unknown;
  editorFontSize?: unknown;
  editorCommand?: unknown;
  editorArguments?: unknown;
  maxSteps?: unknown;
  providerTimeoutMinutes?: unknown;
  providerRetries?: unknown;
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

function saveSettings(update: {
  themeId?: string;
  editorFontSize?: number;
  editorCommand?: string;
  editorArguments?: string;
  maxSteps?: number;
  providerTimeoutMinutes?: number;
  providerRetries?: number;
}): void {
  const file = settingsPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...loadSettings(), ...update }, null, 2)}\n`);
}

function validEditorFontSize(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 10 && Number(value) <= 24
    ? Number(value)
    : undefined;
}

async function launchEditor(target: string): Promise<void> {
  const folder = path.dirname(target);
  const parsed = editorArguments.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((argument) =>
    argument.startsWith('"') && argument.endsWith('"') ? argument.slice(1, -1) : argument
  ) ?? [];
  const hasTarget = parsed.some((argument) => argument.includes("{path}") || argument.includes("{folder}"));
  const args = parsed.map((argument) => argument
    .replaceAll("{path}", target)
    .replaceAll("{folder}", folder));
  if (!hasTarget) args.push(target);

  const macApplication = process.platform === "darwin" && /\.app\/?$/i.test(editorCommand);
  const command = macApplication ? "open" : editorCommand;
  const launchArgs = macApplication
    ? editorArguments
      ? ["-a", editorCommand, "--args", ...args]
      : ["-a", editorCommand, target]
    : args;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, launchArgs, { detached: true, stdio: "ignore" });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
    child.once("error", reject);
  });
}

function validMaxSteps(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 200
    ? Number(value)
    : undefined;
}

function validProviderTimeout(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 30
    ? Number(value)
    : undefined;
}

function validProviderRetries(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 10
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
  const threadId = typeof value.threadId === "string" ? value.threadId : "";
  if (!threadId) throw new Error("Choose a thread before starting a run");
  return { threadId, task, model };
}

function parseSteeringMessage(value: unknown): string {
  const message = typeof value === "string" ? value.trim() : "";
  if (!message) throw new Error("Enter a message before steering the run");
  if (message.length > 30000) throw new Error("Message is too long");
  return message;
}

function parseApprovalDecision(value: unknown): CommandApprovalDecision {
  if (value === "deny" || value === "once" || value === "thread") return value;
  throw new Error("Invalid approval decision");
}

function parseSaveMessageInput(input: unknown): SaveMessageInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Saved message input must be an object");
  }
  const value = input as Record<string, unknown>;
  if (!Number.isInteger(value.sequence) || Number(value.sequence) < 0) {
    throw new Error("Invalid message sequence");
  }
  if (typeof value.text !== "string" || !value.text.trim()) throw new Error("Message is empty");
  return {
    threadId: parseId(value.threadId, "Thread"),
    sequence: Number(value.sequence),
    text: value.text,
    ...(typeof value.model === "string" ? { model: value.model } : {}),
  };
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
  mainWindow.webContents.send("desktop:run-event", { threadId, event: compactRunEvent(event) });
}

function compactRunEvent(event: RunEvent): RunEvent {
  if (event.type === "model.completed" && event.response.toolCalls.length) {
    return {
      ...event,
      response: {
        ...event.response,
        toolCalls: event.response.toolCalls.map((call) => ({ ...call, input: null })),
      },
    };
  }
  if (event.type === "tool.completed") {
    return { ...event, call: { ...event.call, input: null } };
  }
  return event;
}

async function requestCommandApproval(
  threadId: string,
  request: CommandApprovalRequest,
): Promise<CommandApprovalDecision> {
  const id = randomUUID();
  const event: RunEvent = {
    type: "permission.requested",
    id,
    command: request.command,
    cwd: request.cwd,
    reason: request.reason.slice(0, 2000),
  };
  const decision = new Promise<CommandApprovalDecision>((resolve) => {
    pendingApprovals.set(id, { threadId, resolve });
  });
  await emitPermissionEvent(threadId, event);
  return decision;
}

async function emitPermissionEvent(threadId: string, event: RunEvent): Promise<void> {
  await memoryTrace.write(event);
  sendRunEvent(threadId, event);
}

function resolveThreadApprovals(threadId: string, decision: CommandApprovalDecision): void {
  for (const [id, pending] of pendingApprovals) {
    if (pending.threadId !== threadId) continue;
    pendingApprovals.delete(id);
    void emitPermissionEvent(threadId, { type: "permission.resolved", id, decision });
    pending.resolve(decision);
  }
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
  for (const run of activeRuns.values()) resolveThreadApprovals(run.threadId, "deny");
  store?.close();
});

function reportStartupError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  app.quit();
}
