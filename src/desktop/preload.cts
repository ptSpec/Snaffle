import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { CommandApprovalDecision } from "../protocol.js";
import type { ProviderConnectionInput, ReasoningEffort } from "../providers/provider.js";
import type {
  DesktopApi,
  DesktopRunEvent,
  DesktopTerminalDataEvent,
  DesktopTerminalExitEvent,
  DesktopUpdateState,
  GitFileContents,
  SaveMessageInput,
  StartRunInput,
} from "./api.js";
import type { FontId } from "./typography.js";
import type { KetchSearchBackend, WebSearchBackend } from "../tools/web/types.js";
import type { SubagentProfile, ThreadSubagentMode } from "../agent/subagents/profile.js";
import type { McpServerConfig } from "../mcp/types.js";
import type { ImageUnderstandingProfile } from "../attachments/vision.js";
import type { ModelToolSurface } from "../capabilities/surface.js";
import type { SandboxAccessInput } from "../execution/access.js";

const api: DesktopApi = {
  platform: process.platform,
  getState: () => ipcRenderer.invoke("desktop:get-state"),
  getUpdateState: () => ipcRenderer.invoke("desktop:get-update-state"),
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
  applyUpdate: () => ipcRenderer.invoke("desktop:apply-update"),
  completeOnboarding: () => ipcRenderer.invoke("desktop:complete-onboarding"),
  chooseWorkspace: () => ipcRenderer.invoke("desktop:choose-workspace"),
  selectWorkspace: (workspaceId: string) =>
    ipcRenderer.invoke("desktop:select-workspace", workspaceId),
  createThread: (workspaceId: string) =>
    ipcRenderer.invoke("desktop:create-thread", workspaceId),
  forkThread: (threadId: string, sequence: number) =>
    ipcRenderer.invoke("desktop:fork-thread", threadId, sequence),
  selectThread: (threadId: string) => ipcRenderer.invoke("desktop:select-thread", threadId),
  setThreadDraft: (threadId: string, draft: string) =>
    ipcRenderer.invoke("desktop:set-thread-draft", threadId, draft),
  setThreadSubagentMode: (threadId: string, mode: ThreadSubagentMode) =>
    ipcRenderer.invoke("desktop:set-thread-subagent-mode", threadId, mode),
  restoreThread: (threadId: string, sequence: number) =>
    ipcRenderer.invoke("desktop:restore-thread", threadId, sequence),
  setThreadBookmarked: (threadId: string, bookmarked: boolean) =>
    ipcRenderer.invoke("desktop:set-thread-bookmarked", threadId, bookmarked),
  deleteThreads: (threadIds: string[]) =>
    ipcRenderer.invoke("desktop:delete-threads", threadIds),
  removeWorkspace: (workspaceId: string) =>
    ipcRenderer.invoke("desktop:remove-workspace", workspaceId),
  searchConversations: (query: string) =>
    ipcRenderer.invoke("desktop:search-conversations", query),
  listProviderModels: () => ipcRenderer.invoke("desktop:list-provider-models"),
  getProviderStatus: (input: ProviderConnectionInput) => ipcRenderer.invoke("desktop:get-provider-status", input),
  getProviderAllowance: (connectionId: string) => ipcRenderer.invoke("desktop:get-provider-allowance", connectionId),
  saveProviderConnection: (input: ProviderConnectionInput) => ipcRenderer.invoke("desktop:save-provider-connection", input),
  removeProviderConnection: (connectionId: string) => ipcRenderer.invoke("desktop:remove-provider-connection", connectionId),
  setMcpEnabled: (enabled: boolean) => ipcRenderer.invoke("desktop:set-mcp-enabled", enabled),
  saveMcpServer: (server: McpServerConfig) => ipcRenderer.invoke("desktop:save-mcp-server", server),
  removeMcpServer: (id: string) => ipcRenderer.invoke("desktop:remove-mcp-server", id),
  testMcpServer: (server: McpServerConfig) => ipcRenderer.invoke("desktop:test-mcp-server", server),
  setSelectedModel: (
    threadId: string | null,
    connectionId: string,
    model: string,
    reasoningEffort?: ReasoningEffort,
  ) => ipcRenderer.invoke(
    "desktop:set-selected-model",
    threadId,
    connectionId,
    model,
    reasoningEffort ?? "",
  ),
  chooseAttachments: () => ipcRenderer.invoke("desktop:choose-attachments"),
  importDroppedFiles: (files: File[]) =>
    ipcRenderer.invoke("desktop:import-dropped-files", files.map((file) => webUtils.getPathForFile(file))),
  importClipboardImage: () => ipcRenderer.invoke("desktop:import-clipboard-image"),
  importTerminalOutput: (workspaceId: string, output: string) =>
    ipcRenderer.invoke("desktop:import-terminal-output", workspaceId, output),
  importCodeSelection: (input) => ipcRenderer.invoke("desktop:import-code-selection", input),
  readClipboardText: () => ipcRenderer.invoke("desktop:read-clipboard-text"),
  readClipboardHtml: () => ipcRenderer.invoke("desktop:read-clipboard-html"),
  removeAttachment: (id: string) => ipcRenderer.invoke("desktop:remove-attachment", id),
  setAttachmentContext: (threadId: string, sequence: number, attachmentId: string, include: boolean) =>
    ipcRenderer.invoke("desktop:set-attachment-context", threadId, sequence, attachmentId, include),
  startRun: (input: StartRunInput) => ipcRenderer.invoke("desktop:start-run", input),
  steerRun: (threadId: string, message: string) =>
    ipcRenderer.invoke("desktop:steer-run", threadId, message),
  stopRun: (threadId: string) => ipcRenderer.invoke("desktop:stop-run", threadId),
  setThreadUnsafe: (threadId: string, unsafe: boolean) =>
    ipcRenderer.invoke("desktop:set-thread-unsafe", threadId, unsafe),
  chooseSandboxFolder: () => ipcRenderer.invoke("desktop:choose-sandbox-folder"),
  addSandboxAccess: (threadId: string, input: SandboxAccessInput) =>
    ipcRenderer.invoke("desktop:add-sandbox-access", threadId, input),
  grantCommandSandboxAccess: (id: string, inputs: SandboxAccessInput[]) =>
    ipcRenderer.invoke("desktop:grant-command-sandbox-access", id, inputs),
  removeSandboxAccess: (threadId: string, grantId: string) =>
    ipcRenderer.invoke("desktop:remove-sandbox-access", threadId, grantId),
  resolveCommandApproval: (id: string, decision: CommandApprovalDecision) =>
    ipcRenderer.invoke("desktop:resolve-command-approval", id, decision),
  setTheme: (themeId: string) => ipcRenderer.invoke("desktop:set-theme", themeId),
  setTypography: (interfaceFont: FontId, primary: FontId, secondary: FontId, code: FontId) =>
    ipcRenderer.invoke("desktop:set-typography", interfaceFont, primary, secondary, code),
  setTypographyScale: (role: "interface" | "conversation", value: number) =>
    ipcRenderer.invoke("desktop:set-typography-scale", role, value),
  setCodeBlockFontSize: (size: number) => ipcRenderer.invoke("desktop:set-code-block-font-size", size),
  setEditorFontSize: (size: number) => ipcRenderer.invoke("desktop:set-editor-font-size", size),
  setEditorLauncher: (command: string, argumentsTemplate: string) =>
    ipcRenderer.invoke("desktop:set-editor-launcher", command, argumentsTemplate),
  chooseEditorApplication: () => ipcRenderer.invoke("desktop:choose-editor-application"),
  setMaxSteps: (maxSteps: number) => ipcRenderer.invoke("desktop:set-max-steps", maxSteps),
  setAutoTitleGeneration: (enabled: boolean) =>
    ipcRenderer.invoke("desktop:set-auto-title-generation", enabled),
  setProviderTimeoutMinutes: (minutes: number) =>
    ipcRenderer.invoke("desktop:set-provider-timeout", minutes),
  setProviderRetries: (retries: number) =>
    ipcRenderer.invoke("desktop:set-provider-retries", retries),
  setSubagent: (profile: SubagentProfile) =>
    ipcRenderer.invoke("desktop:set-subagent", profile),
  setImageUnderstanding: (profile: ImageUnderstandingProfile) =>
    ipcRenderer.invoke("desktop:set-image-understanding", profile),
  setCompaction: (mode, threshold) =>
    ipcRenderer.invoke("desktop:set-compaction", mode, threshold),
  setSystemPrompt: (prompt: string) => ipcRenderer.invoke("desktop:set-system-prompt", prompt),
  setToolEnabled: (name: string, enabled: boolean) =>
    ipcRenderer.invoke("desktop:set-tool-enabled", name, enabled),
  setModelToolSurface: (connectionId: string, model: string, surface: ModelToolSurface) =>
    ipcRenderer.invoke("desktop:set-model-tool-surface", connectionId, model, surface),
  getContextReport: (threadId, contextLength) =>
    ipcRenderer.invoke("desktop:get-context-report", threadId, contextLength),
  compactContext: (threadId, connectionId, model, contextLength) =>
    ipcRenderer.invoke("desktop:compact-context", threadId, connectionId, model, contextLength),
  setWebSearchEnabled: (enabled: boolean) =>
    ipcRenderer.invoke("desktop:set-web-search-enabled", enabled),
  setWebSearchBackend: (backend: WebSearchBackend) =>
    ipcRenderer.invoke("desktop:set-web-search-backend", backend),
  setWebSearchApiKey: (backend: KetchSearchBackend, apiKey: string) =>
    ipcRenderer.invoke("desktop:set-web-search-api-key", backend, apiKey),
  saveMessage: (input: SaveMessageInput) => ipcRenderer.invoke("desktop:save-message", input),
  deleteSavedMessage: (id: string) => ipcRenderer.invoke("desktop:delete-saved-message", id),
  listSavedMessages: () => ipcRenderer.invoke("desktop:list-saved-messages"),
  openSavedMessage: (id: string) => ipcRenderer.invoke("desktop:open-saved-message", id),
  keepAside: (threadId: string, entryId: string) => ipcRenderer.invoke("desktop:keep-aside", threadId, entryId),
  removeAside: (threadId: string, entryId: string) => ipcRenderer.invoke("desktop:remove-aside", threadId, entryId),
  getGitChanges: (workspaceId: string) =>
    ipcRenderer.invoke("desktop:get-git-changes", workspaceId),
  getGitFile: (workspaceId: string, path: string) =>
    ipcRenderer.invoke("desktop:get-git-file", workspaceId, path),
  getGitDiffPreview: (workspaceId: string, path: string) =>
    ipcRenderer.invoke("desktop:get-git-diff-preview", workspaceId, path),
  saveGitFile: (workspaceId: string, path: string, content: string, lineEnding: GitFileContents["lineEnding"]) =>
    ipcRenderer.invoke("desktop:save-git-file", workspaceId, path, content, lineEnding),
  commitGitChanges: (workspaceId: string, message: string, paths: string[]) =>
    ipcRenderer.invoke("desktop:commit-git-changes", workspaceId, message, paths),
  openWorkspaceFile: (workspaceId: string, path: string) =>
    ipcRenderer.invoke("desktop:open-workspace-file", workspaceId, path),
  revealWorkspaceFile: (workspaceId: string, path: string) =>
    ipcRenderer.invoke("desktop:reveal-workspace-file", workspaceId, path),
  initializeGitRepository: (workspaceId: string) =>
    ipcRenderer.invoke("desktop:initialize-git-repository", workspaceId),
  openExternal: (url: string) => ipcRenderer.invoke("desktop:open-external", url),
  openTerminal: (workspaceId: string, columns: number, rows: number) =>
    ipcRenderer.invoke("desktop:terminal-open", workspaceId, columns, rows),
  writeTerminal: (workspaceId: string, data: string) =>
    ipcRenderer.invoke("desktop:terminal-write", workspaceId, data),
  resizeTerminal: (workspaceId: string, columns: number, rows: number) =>
    ipcRenderer.invoke("desktop:terminal-resize", workspaceId, columns, rows),
  closeTerminal: (workspaceId: string) =>
    ipcRenderer.invoke("desktop:terminal-close", workspaceId),
  onRunEvent(listener: (event: DesktopRunEvent) => void): () => void {
    const receiveEvent = (_event: Electron.IpcRendererEvent, event: DesktopRunEvent) => listener(event);
    ipcRenderer.on("desktop:run-event", receiveEvent);
    return () => ipcRenderer.removeListener("desktop:run-event", receiveEvent);
  },
  onUpdateState(listener: (state: DesktopUpdateState) => void): () => void {
    const receiveEvent = (_event: Electron.IpcRendererEvent, state: DesktopUpdateState) => listener(state);
    ipcRenderer.on("desktop:update-state", receiveEvent);
    return () => ipcRenderer.removeListener("desktop:update-state", receiveEvent);
  },
  onTerminalData(listener: (event: DesktopTerminalDataEvent) => void): () => void {
    const receiveEvent = (_event: Electron.IpcRendererEvent, event: DesktopTerminalDataEvent) => listener(event);
    ipcRenderer.on("desktop:terminal-data", receiveEvent);
    return () => ipcRenderer.removeListener("desktop:terminal-data", receiveEvent);
  },
  onTerminalExit(listener: (event: DesktopTerminalExitEvent) => void): () => void {
    const receiveEvent = (_event: Electron.IpcRendererEvent, event: DesktopTerminalExitEvent) => listener(event);
    ipcRenderer.on("desktop:terminal-exit", receiveEvent);
    return () => ipcRenderer.removeListener("desktop:terminal-exit", receiveEvent);
  },
};

contextBridge.exposeInMainWorld("desktop", api);
