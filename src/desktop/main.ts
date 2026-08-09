import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { DEFAULT_MAX_STEPS } from "../agent/loop.js";
import {
  activeSubagent,
  subagentProfile,
  type SubagentProfile,
} from "../agent/subagents/profile.js";
import { delegateTaskTool } from "../agent/subagents/tool.js";
import { AttachmentStore } from "../attachments/store.js";
import { builtInCapabilities } from "../capabilities/active.js";
import {
  DEFAULT_COMPACTION_THRESHOLD,
  type CompactionMode,
} from "../context/budget.js";
import { ContextCompactor } from "../context/compaction.js";
import { buildContextReport, type ContextReport } from "../context/report.js";
import { PROJECT } from "../identity.js";
import {
  OPENROUTER_CONNECTION_ID,
  createProvider,
} from "../providers/registry.js";
import {
  DEFAULT_PROVIDER_RETRIES,
  DEFAULT_PROVIDER_TIMEOUT_MS,
} from "../providers/openai-compatible.js";
import type { RunEvent } from "../protocol.js";
import { probeNativeSandbox } from "../execution/native/sandbox.js";
import { defaultTools } from "../tools/built-ins.js";
import { findKetch } from "../tools/web/ketch.js";
import {
  WEB_SEARCH_BACKENDS,
  type KetchSearchBackend,
  type WebSearchBackend,
} from "../tools/web/types.js";
import type { DesktopState } from "./api.js";
import { openStore, type DesktopStore } from "./store.js";
import { registerAttachmentIpc } from "./ipc/attachments.js";
import { registerGitIpc } from "./ipc/git.js";
import { registerSavedMessageIpc } from "./ipc/saved-messages.js";
import { registerSearchIpc } from "./ipc/search.js";
import { registerWorkspaceIpc } from "./ipc/workspaces.js";
import { registerRunIpc, type RunIpc } from "./ipc/runs.js";
import { registerProviderIpc } from "./ipc/providers.js";
import {
  decodeSecret,
  encodeSecret,
  loadSettings,
  saveSettings as saveSettingsFile,
  type SettingsUpdate,
} from "./settings.js";
import { DEFAULT_THEME, themeById, type Theme } from "./themes/index.js";
import {
  DEFAULT_CODE_BLOCK_FONT_SIZE,
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_FONTS,
  DEFAULT_FONT_SCALE,
  fontById,
  validFontScale,
  type FontId,
} from "./typography.js";
import { applicationIcon, createDesktopWindow } from "./window.js";
import { configureDesktopIdentity, migrateLegacyUserData } from "./identity-migration.js";
import { ProviderConnections } from "./provider-connections.js";

const userDataMigration = configureDesktopIdentity();
const desktopDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererPath = path.join(desktopDirectory, "../../renderer/index.html");
const preloadPath = path.join(desktopDirectory, "preload.cjs");

let mainWindow: BrowserWindow | undefined;
let store: DesktopStore;
let attachments: AttachmentStore;
let runs: RunIpc;
let contextCompactor: ContextCompactor;
let providerConnections: ProviderConnections;
let activeTheme: Theme = DEFAULT_THEME;
let interfaceFont: FontId = DEFAULT_FONTS.interface;
let primaryFont: FontId = DEFAULT_FONTS.primary;
let secondaryFont: FontId = DEFAULT_FONTS.secondary;
let codeFont: FontId = DEFAULT_FONTS.code;
let interfaceFontScale = DEFAULT_FONT_SCALE;
let conversationFontScale = DEFAULT_FONT_SCALE;
let codeBlockFontSize = DEFAULT_CODE_BLOCK_FONT_SIZE;
let editorFontSize = DEFAULT_EDITOR_FONT_SIZE;
let editorCommand = "";
let editorArguments = "";
let maxSteps = DEFAULT_MAX_STEPS;
let providerTimeoutMinutes = DEFAULT_PROVIDER_TIMEOUT_MS / 60_000;
let providerRetries = DEFAULT_PROVIDER_RETRIES;
let subagent: SubagentProfile = subagentProfile(undefined);
let compactionMode: CompactionMode = "automatic";
let customCompactionThreshold = DEFAULT_COMPACTION_THRESHOLD;
let webSearchEnabled = true;
let webSearchBackend: WebSearchBackend = "ddg";
const storedWebSearchApiKeys: Partial<Record<KetchSearchBackend, string>> = {};
const DEVELOPMENT_MODEL = "openai/gpt-5.6-luna";
let selectedModel = DEVELOPMENT_MODEL;
let selectedProviderConnectionId = OPENROUTER_CONNECTION_ID;


async function start(): Promise<void> {
  loadDevelopmentEnvironment();
  migrateLegacyUserData(userDataMigration);
  const settings = loadSettings(settingsPath());
  activeTheme =
    typeof settings.themeId === "string"
      ? themeById(settings.themeId) ?? DEFAULT_THEME
      : DEFAULT_THEME;
  interfaceFont = fontById(settings.interfaceFont)?.id ?? DEFAULT_FONTS.interface;
  primaryFont = fontById(settings.primaryFont)?.id ?? DEFAULT_FONTS.primary;
  secondaryFont = fontById(settings.secondaryFont)?.id ?? DEFAULT_FONTS.secondary;
  codeFont = fontById(settings.codeFont)?.id ?? DEFAULT_FONTS.code;
  interfaceFontScale = validFontScale(settings.interfaceFontScale) ?? DEFAULT_FONT_SCALE;
  conversationFontScale = validFontScale(settings.conversationFontScale) ?? DEFAULT_FONT_SCALE;
  codeBlockFontSize = validCodeFontSize(settings.codeBlockFontSize) ?? codeBlockFontSize;
  editorFontSize = validEditorFontSize(settings.editorFontSize) ?? editorFontSize;
  editorCommand = typeof settings.editorCommand === "string" ? settings.editorCommand : "";
  editorArguments = typeof settings.editorArguments === "string" ? settings.editorArguments : "";
  maxSteps = validMaxSteps(settings.maxSteps) ?? DEFAULT_MAX_STEPS;
  providerTimeoutMinutes = validProviderTimeout(settings.providerTimeoutMinutes) ?? providerTimeoutMinutes;
  providerRetries = validProviderRetries(settings.providerRetries) ?? DEFAULT_PROVIDER_RETRIES;
  subagent = subagentProfile(settings.subagent);
  compactionMode = settings.compactionMode === "custom" ? "custom" : "automatic";
  customCompactionThreshold = validCompactionThreshold(settings.compactionThreshold) ?? DEFAULT_COMPACTION_THRESHOLD;
  selectedModel = typeof settings.selectedModel === "string" ? settings.selectedModel : DEVELOPMENT_MODEL;
  selectedProviderConnectionId = typeof settings.selectedProviderConnectionId === "string"
    ? settings.selectedProviderConnectionId
    : OPENROUTER_CONNECTION_ID;
  providerConnections = new ProviderConnections(
    settings.providerConnections,
    {
      openrouter: process.env.OPENROUTER_API_KEY ?? "",
      deepseek: process.env.DEEPSEEK_API_KEY ?? "",
    },
  );
  try {
    providerConnections.resolve(selectedProviderConnectionId);
  } catch {
    selectedProviderConnectionId = providerConnections.list().find((connection) => connection.enabled)?.id
      ?? OPENROUTER_CONNECTION_ID;
  }
  webSearchEnabled = settings.webSearchEnabled !== false;
  webSearchBackend = validWebSearchBackend(settings.webSearchBackend) ?? "ddg";
  loadWebSearchApiKeys(settings.webSearchApiKeys);
  const oldTavilyKey = decodeSecret(settings.tavilyApiKey);
  if (oldTavilyKey && !storedWebSearchApiKeys.tavily) {
    storedWebSearchApiKeys.tavily = oldTavilyKey;
    saveWebSearchApiKeys();
  }
  store = await openStore(path.join(app.getPath("userData"), `${PROJECT.slug}.db`));
  contextCompactor = new ContextCompactor({
    repository: store.context,
    settings: () => ({ mode: compactionMode, threshold: customCompactionThreshold }),
    provider: (connectionId, model) => createProvider(providerConnections.resolve(connectionId), model, {
      streamIdleTimeoutMs: providerTimeoutMinutes * 60_000,
      maxRetries: providerRetries,
    }),
    onEvent: sendRunEvent,
  });
  attachments = new AttachmentStore(path.join(app.getPath("userData"), "attachments"));
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
  mainWindow = createDesktopWindow(rendererPath, preloadPath, {
    theme: activeTheme,
    interfaceFont,
    primaryFont,
    secondaryFont,
    codeFont,
    interfaceFontScale,
    conversationFontScale,
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

function registerIpc(): void {
  registerAttachmentIpc(store, attachments, () => mainWindow);
  registerGitIpc(store, async (target) => {
    if (editorCommand) return launchEditor(target);
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
  });
  runs = registerRunIpc({
    store,
    attachments,
    compactor: contextCompactor,
    state: desktopState,
    capabilities: currentCapabilities,
    provider: (connectionId, model, resolveAttachment) => createProvider(
      providerConnections.resolve(connectionId),
      model,
      {
        streamIdleTimeoutMs: providerTimeoutMinutes * 60_000,
        maxRetries: providerRetries,
        resolveAttachment,
      },
    ),
    settings: () => ({
      maxSteps,
      providerTimeoutMinutes,
      providerRetries,
      compactionMode,
      compactionThreshold: customCompactionThreshold,
      subagent,
    }),
    sendEvent: sendRunEvent,
  });
  registerProviderIpc({
    connections: providerConnections,
    state: desktopState,
    selected: () => selectedProviderConnectionId,
    select: (id) => {
      selectedProviderConnectionId = id;
    },
    persist: () => saveSettings({
      providerConnections: providerConnections.serialize(),
      selectedProviderConnectionId,
    }),
  });
  registerWorkspaceIpc({
    store,
    state: desktopState,
    mainWindow: () => mainWindow,
    runningThread: runs.isThreadRunning,
    runningWorkspace: runs.isWorkspaceRunning,
    threadsDeleted: runs.forgetThreads,
    defaultModel: () => selectedModel,
  });
  registerSavedMessageIpc(store, desktopState);
  registerSearchIpc(store);
  ipcMain.handle("desktop:get-state", (): Promise<DesktopState> => desktopState());

  ipcMain.handle("desktop:get-context-report", async (
    _event,
    rawThreadId: unknown,
    rawContextLength: unknown,
  ): Promise<ContextReport> => {
    const threadId = parseId(rawThreadId, "Thread");
    const contextLength = parseContextLength(rawContextLength);
    const checkpoint = await store.context.latest(threadId);
    return buildContextReport({
      entries: await store.context.entries(threadId, checkpoint),
      checkpoint,
      tools: currentToolSpecs(),
      contextLength,
      mode: compactionMode,
      threshold: customCompactionThreshold,
      preparing: contextCompactor.isRunning(threadId),
    });
  });

  ipcMain.handle("desktop:compact-context", async (
    _event,
    rawThreadId: unknown,
    rawConnectionId: unknown,
    rawModel: unknown,
    rawContextLength: unknown,
  ): Promise<void> => {
    const threadId = parseId(rawThreadId, "Thread");
    const providerConnectionId = parseId(rawConnectionId, "Provider connection");
    const model = typeof rawModel === "string" ? rawModel.trim() : "";
    if (!model) throw new Error("Choose a model before compacting context");
    await contextCompactor.force({
      threadId,
      providerConnectionId,
      model,
      contextLength: parseContextLength(rawContextLength),
      tools: currentToolSpecs(),
    });
  });

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

  ipcMain.handle("desktop:set-typography", (_event, interfaceValue: unknown, primary: unknown, secondary: unknown, code: unknown): void => {
    const nextInterface = fontById(interfaceValue)?.id;
    const nextPrimary = fontById(primary)?.id;
    const nextSecondary = fontById(secondary)?.id;
    const nextCode = fontById(code)?.id;
    if (!nextInterface || !nextPrimary || !nextSecondary || !nextCode) throw new Error("Unknown font selection");
    interfaceFont = nextInterface;
    primaryFont = nextPrimary;
    secondaryFont = nextSecondary;
    codeFont = nextCode;
    saveSettings({ interfaceFont, primaryFont, secondaryFont, codeFont });
  });

  ipcMain.handle("desktop:set-typography-scale", (_event, role: unknown, value: unknown): void => {
    const scale = validFontScale(value);
    if ((role !== "interface" && role !== "conversation") || scale === undefined) {
      throw new Error("Font scale must be from 85% to 125%");
    }
    if (role === "interface") interfaceFontScale = scale;
    else conversationFontScale = scale;
    saveSettings(role === "interface" ? { interfaceFontScale: scale } : { conversationFontScale: scale });
  });

  ipcMain.handle("desktop:set-editor-font-size", (_event, value: unknown): void => {
    const next = validEditorFontSize(value);
    if (next === undefined) throw new Error("Editor font size must be an integer from 10 to 24");
    editorFontSize = next;
    saveSettings({ editorFontSize });
  });

  ipcMain.handle("desktop:set-code-block-font-size", (_event, value: unknown): void => {
    const next = validCodeFontSize(value);
    if (next === undefined) throw new Error("Code block font size must be an integer from 10 to 24");
    codeBlockFontSize = next;
    saveSettings({ codeBlockFontSize });
  });

  ipcMain.handle("desktop:set-selected-model", async (
    _event,
    threadId: unknown,
    connectionValue: unknown,
    value: unknown,
  ): Promise<void> => {
    if (threadId !== null && (typeof threadId !== "string" || !threadId)) {
      throw new Error("Thread ID must be text");
    }
    const connectionId = parseId(connectionValue, "Provider connection");
    providerConnections.resolve(connectionId);
    if (typeof value !== "string") throw new Error("Model must be text");
    if (threadId) await store.setThreadModel(threadId, connectionId, value);
    selectedProviderConnectionId = connectionId;
    selectedModel = value;
    saveSettings({ selectedModel, selectedProviderConnectionId });
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

  ipcMain.handle("desktop:set-subagent", (_event, value: unknown): void => {
    const next = subagentProfile(value);
    if (next.providerConnectionId) providerConnections.resolve(next.providerConnectionId);
    subagent = next;
    saveSettings({ subagent });
  });

  ipcMain.handle("desktop:set-compaction", (_event, modeValue: unknown, thresholdValue: unknown): void => {
    if (modeValue !== "automatic" && modeValue !== "custom") throw new Error("Unknown compaction mode");
    const threshold = validCompactionThreshold(thresholdValue);
    if (threshold === undefined) throw new Error("Compaction threshold must be an integer from 30 to 90");
    compactionMode = modeValue;
    customCompactionThreshold = threshold;
    saveSettings({ compactionMode, compactionThreshold: customCompactionThreshold });
  });

  ipcMain.handle("desktop:set-web-search-backend", async (_event, value: unknown): Promise<DesktopState> => {
    const backend = validWebSearchBackend(value);
    if (!backend) throw new Error("Unknown web search backend");
    webSearchBackend = backend;
    saveSettings({ webSearchBackend });
    return desktopState(false);
  });

  ipcMain.handle("desktop:set-web-search-api-key", async (
    _event,
    backendValue: unknown,
    keyValue: unknown,
  ): Promise<DesktopState> => {
    const backend = validKetchSearchBackend(backendValue);
    if (!backend || backend === "ddg") throw new Error("This backend does not accept an API key");
    if (typeof keyValue !== "string") throw new Error("API key must be text");
    storedWebSearchApiKeys[backend] = keyValue.trim();
    saveWebSearchApiKeys();
    return desktopState(false);
  });

  ipcMain.handle("desktop:set-web-search-enabled", (_event, value: unknown): void => {
    if (typeof value !== "boolean") throw new Error("Web search setting must be true or false");
    webSearchEnabled = value;
    saveSettings({ webSearchEnabled });
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

async function desktopState(includeConversation = true): Promise<DesktopState> {
  const state = await store.state();
  const sandbox = await probeNativeSandbox();
  const conversation = includeConversation ? await store.entries(state.activeThreadId) : [];
  const workspace =
    state.workspaces.find((item) => item.id === state.activeWorkspaceId) ?? null;
  return {
    workspace,
    workspaces: state.workspaces,
    activeThreadId: state.activeThreadId,
    conversation,
    contextCheckpoints: includeConversation ? await store.context.checkpoints(state.activeThreadId) : [],
    modelInstructions: await store.systemInstructions(state.activeThreadId),
    toolSpecs: currentToolSpecs(),
    savedMessages: await store.savedMessages.summaries(),
    providerConnections: providerConnections.list(),
    openRouterAvailable: providerConnections.list().find(
      (connection) => connection.id === OPENROUTER_CONNECTION_ID,
    )?.hasApiKey ?? false,
    ketchAvailable: Boolean(findKetch()),
    webSearchEnabled,
    webSearchBackend,
    webSearchKeyBackends: WEB_SEARCH_BACKENDS.flatMap((backend) =>
      backend !== "openrouter" && backend !== "ddg" && webSearchApiKey(backend) ? [backend] : []
    ),
    runningThreadIds: runs.runningThreadIds(),
    unsafeThreadIds: runs.unsafeThreadIds(),
    defaultModel: selectedModel || null,
    defaultProviderConnectionId: selectedProviderConnectionId,
    restrictedHostAvailable: sandbox.available,
    restrictedHostDetail: sandbox.detail,
    themeId: activeTheme.id,
    interfaceFont,
    primaryFont,
    secondaryFont,
    codeFont,
    interfaceFontScale,
    conversationFontScale,
    codeBlockFontSize,
    editorFontSize,
    editorCommand,
    editorArguments,
    maxSteps,
    providerTimeoutMinutes,
    providerRetries,
    subagent,
    compactionMode,
    compactionThreshold: customCompactionThreshold,
  };
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function saveSettings(update: SettingsUpdate): void {
  saveSettingsFile(settingsPath(), update);
}

function validEditorFontSize(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 10 && Number(value) <= 24
    ? Number(value)
    : undefined;
}

function validCodeFontSize(value: unknown): number | undefined {
  return validEditorFontSize(value);
}

function validCompactionThreshold(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 30 && Number(value) <= 90
    ? Number(value)
    : undefined;
}

function parseContextLength(value: unknown): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 128_000;
}

function currentCapabilities() {
  return builtInCapabilities(
    defaultTools(webSearchEnabled
      ? {
          webSearchEnabled: true,
          backend: webSearchBackend,
          apiKey: webSearchApiKey(webSearchBackend),
          openRouterApiKey: openRouterApiKey(),
        }
      : {}),
  );
}

function currentToolSpecs() {
  const tools = currentCapabilities().tools.map(({ tool }) => tool);
  if (activeSubagent(subagent)) tools.push(delegateTaskTool(async () => ""));
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
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

function parseId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} id must be a string`);
  return value;
}

function openRouterApiKey(): string {
  try {
    return providerConnections.resolve(OPENROUTER_CONNECTION_ID).apiKey ?? "";
  } catch {
    return "";
  }
}

function webSearchApiKey(backend: WebSearchBackend): string | undefined {
  if (backend === "ddg" || backend === "openrouter") return undefined;
  const environment = {
    exa: process.env.EXA_API_KEY || process.env.KETCH_EXA_API_KEY,
    tavily: process.env.TAVILY_API_KEY || process.env.KETCH_TAVILY_API_KEY,
    brave: process.env.BRAVE_API_KEY || process.env.KETCH_BRAVE_API_KEY,
    firecrawl: process.env.FIRECRAWL_API_KEY || process.env.KETCH_FIRECRAWL_API_KEY,
  };
  return environment[backend] || storedWebSearchApiKeys[backend] || undefined;
}

function loadWebSearchApiKeys(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const backend of ["exa", "tavily", "brave", "firecrawl"] as const) {
    const key = decodeSecret((value as Record<string, unknown>)[backend]);
    if (key) storedWebSearchApiKeys[backend] = key;
  }
}

function saveWebSearchApiKeys(): void {
  saveSettings({
    tavilyApiKey: undefined,
    webSearchApiKeys: Object.fromEntries(
      Object.entries(storedWebSearchApiKeys).flatMap(([backend, key]) =>
        key ? [[backend, encodeSecret(key)]] : []
      ),
    ),
  });
}

function validWebSearchBackend(value: unknown): WebSearchBackend | undefined {
  return typeof value === "string" && WEB_SEARCH_BACKENDS.includes(value as WebSearchBackend)
    ? value as WebSearchBackend
    : undefined;
}

function validKetchSearchBackend(value: unknown): KetchSearchBackend | undefined {
  const backend = validWebSearchBackend(value);
  return backend && backend !== "openrouter" ? backend : undefined;
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

function loadDevelopmentEnvironment(): void {
  const projectRoot = path.resolve(desktopDirectory, "../../..");
  const environmentPath = path.join(projectRoot, ".env");
  if (existsSync(environmentPath)) loadEnvFile(environmentPath);
}

app.whenReady().then(start).catch(reportStartupError);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  runs?.stopAll();
  store?.close();
});

function reportStartupError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  app.quit();
}
