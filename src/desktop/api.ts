import type { AttachmentPreview, AttachmentRef } from "../attachments/types.js";
import type {
  ProviderCatalog,
  ProviderAllowance,
  ProviderConnection,
  ProviderConnectionInput,
  ProviderStatus,
  ReasoningEffort,
} from "../providers/provider.js";
import type { CommandApprovalDecision, Message, RunEvent, ToolSpec } from "../protocol.js";
import type { FontId } from "./typography.js";
import type { KetchSearchBackend, WebSearchBackend } from "../tools/web/types.js";
import type { CompactionMode } from "../context/budget.js";
import type { ContextCheckpoint } from "../context/projection.js";
import type { ContextReport } from "../context/report.js";
import type { SubagentProfile, ThreadSubagentMode } from "../agent/subagents/profile.js";
import type { GitChanges, GitDiffPreview, GitFileContents } from "../git/types.js";
import type { McpServerConfig, McpServerStatus } from "../mcp/types.js";
import type { SkillSummary } from "../extensions/skills/types.js";
import type { ImageUnderstandingProfile } from "../attachments/vision.js";
import type { ModelToolSurface, ModelToolSurfaces } from "../capabilities/surface.js";
import type { DesktopUpdateState } from "./updates.js";
import type { SandboxAccessGrant, SandboxAccessInput } from "../execution/access.js";

export type { SandboxAccessGrant, SandboxAccessInput } from "../execution/access.js";

export type { GitChanges, GitDiffPreview, GitFileChange, GitFileContents } from "../git/types.js";
export type { DesktopUpdateState } from "./updates.js";

export type DesktopThread = {
  id: string;
  workspaceId: string;
  title: string;
  draft: string;
  model: string | null;
  providerConnectionId: string;
  reasoningEffort: ReasoningEffort | "";
  bookmarked: boolean;
  sourceThreadId: string | null;
  sourceEntryId: string | null;
  branchLabel: string | null;
  subagentMode: ThreadSubagentMode;
  updatedAt: number;
};

export type DesktopWorkspace = {
  id: string;
  path: string;
  name: string;
  updatedAt: number;
  threads: DesktopThread[];
};

export type DesktopEntry = {
  id: string;
  sequence: number;
  message: Message;
};

export type DesktopSearchResult = {
  entryId: string;
  workspaceId: string;
  workspaceName: string;
  threadId: string;
  threadTitle: string;
  sequence: number;
  role: "user" | "assistant";
  excerpt: string;
};

export type SavedMessage = {
  id: string;
  sourceEntryId: string | null;
  sourceThreadId: string;
  sourceWorkspaceId: string;
  sourceSequence: number;
  workspaceName: string;
  threadTitle: string;
  role: "assistant";
  text: string;
  model: string | null;
  createdAt: number;
  sourceAvailable: boolean;
};

export type SavedMessageSummary = Omit<SavedMessage, "text">;

export type SaveMessageInput = {
  threadId: string;
  sequence: number;
  text: string;
  model?: string;
};

export type SavedMessageSource = {
  state: DesktopState;
  entryId: string;
};

export type KeptAsideMessage = {
  entryId: string;
  sequence: number;
  text: string;
  createdAt: number;
};

export const MAX_KEPT_ASIDE_MESSAGES = 3;

export type DesktopState = {
  onboardingComplete: boolean;
  workspace: DesktopWorkspace | null;
  workspaces: DesktopWorkspace[];
  activeThreadId: string | null;
  conversation: DesktopEntry[];
  contextCheckpoints: ContextCheckpoint[];
  modelInstructions: string[];
  toolSpecs: ToolSpec[];
  modelTools: ModelToolSetting[];
  systemPrompt: string;
  runtimeMetadata: string;
  disabledTools: string[];
  modelToolSurfaces: ModelToolSurfaces;
  skills: SkillSummary[];
  savedMessages: SavedMessageSummary[];
  keptAside: KeptAsideMessage[];
  providerConnections: ProviderConnection[];
  mcpEnabled: boolean;
  mcpServers: McpServerConfig[];
  openRouterAvailable: boolean;
  deepSeekAvailable: boolean;
  ketchAvailable: boolean;
  webSearchEnabled: boolean;
  webSearchBackend: WebSearchBackend;
  webSearchKeyBackends: KetchSearchBackend[];
  runningThreadIds: string[];
  unsafeThreadIds: string[];
  sandboxAccess: SandboxAccessGrant[];
  defaultModel: string | null;
  defaultProviderConnectionId: string;
  restrictedHostAvailable: boolean;
  restrictedHostDetail: string;
  themeId: string;
  interfaceFont: FontId;
  primaryFont: FontId;
  secondaryFont: FontId;
  codeFont: FontId;
  interfaceFontScale: number;
  conversationFontScale: number;
  codeBlockFontSize: number;
  editorFontSize: number;
  editorCommand: string;
  editorArguments: string;
  maxSteps: number;
  autoTitleGeneration: boolean;
  providerTimeoutMinutes: number;
  providerRetries: number;
  subagent: SubagentProfile;
  compactionMode: CompactionMode;
  compactionThreshold: number;
  imageUnderstanding: ImageUnderstandingProfile;
};

export type ModelToolSetting = ToolSpec & {
  available: boolean;
  enabled: boolean;
};

export type StartRunInput = {
  threadId: string;
  task: string;
  model: string;
  providerConnectionId: string;
  reasoningEffort?: ReasoningEffort;
  contextLength: number;
  imageInputSupported: boolean;
  attachments?: AttachmentRef[];
  explicitlyActiveTools?: string[];
};

export type DesktopRunEvent = {
  threadId: string;
  event: RunEvent;
};

export type DesktopTerminalDataEvent = {
  workspaceId: string;
  data: string;
};

export type DesktopTerminalExitEvent = {
  workspaceId: string;
  exitCode: number;
};

export type CodeSelectionInput = {
  path: string;
  ranges: Array<{
    fromLine: number;
    toLine: number;
    text: string;
  }>;
};

export interface DesktopApi {
  platform: string;
  getState(): Promise<DesktopState>;
  getUpdateState(): Promise<DesktopUpdateState>;
  checkForUpdates(): Promise<DesktopUpdateState>;
  applyUpdate(): Promise<void>;
  completeOnboarding(): Promise<void>;
  chooseWorkspace(): Promise<DesktopState | null>;
  selectWorkspace(workspaceId: string): Promise<DesktopState>;
  createThread(workspaceId: string): Promise<DesktopState>;
  forkThread(threadId: string, sequence: number): Promise<DesktopState>;
  selectThread(threadId: string): Promise<DesktopState>;
  setThreadDraft(threadId: string, draft: string): Promise<void>;
  setThreadSubagentMode(threadId: string, mode: ThreadSubagentMode): Promise<DesktopState>;
  restoreThread(threadId: string, sequence: number): Promise<DesktopState>;
  setThreadBookmarked(threadId: string, bookmarked: boolean): Promise<DesktopState>;
  deleteThreads(threadIds: string[]): Promise<DesktopState>;
  removeWorkspace(workspaceId: string): Promise<DesktopState>;
  searchConversations(query: string): Promise<DesktopSearchResult[]>;
  listProviderModels(): Promise<ProviderCatalog[]>;
  getProviderStatus(input: ProviderConnectionInput): Promise<ProviderStatus>;
  getProviderAllowance(connectionId: string): Promise<ProviderAllowance | null>;
  saveProviderConnection(input: ProviderConnectionInput): Promise<DesktopState>;
  removeProviderConnection(connectionId: string): Promise<DesktopState>;
  setMcpEnabled(enabled: boolean): Promise<DesktopState>;
  saveMcpServer(server: McpServerConfig): Promise<DesktopState>;
  removeMcpServer(id: string): Promise<DesktopState>;
  testMcpServer(server: McpServerConfig): Promise<McpServerStatus>;
  setSelectedModel(
    threadId: string | null,
    connectionId: string,
    model: string,
    reasoningEffort?: ReasoningEffort,
  ): Promise<void>;
  chooseAttachments(): Promise<AttachmentPreview[]>;
  importDroppedFiles(files: File[]): Promise<AttachmentPreview[]>;
  importClipboardImage(): Promise<AttachmentPreview>;
  importTerminalOutput(workspaceId: string, output: string): Promise<AttachmentPreview>;
  importCodeSelection(input: CodeSelectionInput): Promise<AttachmentPreview>;
  readClipboardText(): Promise<string>;
  readClipboardHtml(): Promise<string>;
  removeAttachment(id: string): Promise<void>;
  setAttachmentContext(threadId: string, sequence: number, attachmentId: string, include: boolean): Promise<void>;
  startRun(input: StartRunInput): Promise<void>;
  steerRun(threadId: string, message: string): Promise<boolean>;
  stopRun(threadId: string): Promise<boolean>;
  setThreadUnsafe(threadId: string, unsafe: boolean): Promise<DesktopState>;
  chooseSandboxFolder(): Promise<string | null>;
  addSandboxAccess(threadId: string, input: SandboxAccessInput): Promise<DesktopState>;
  removeSandboxAccess(threadId: string, grantId: string): Promise<DesktopState>;
  resolveCommandApproval(id: string, decision: CommandApprovalDecision): Promise<DesktopState>;
  setTheme(themeId: string): Promise<void>;
  setTypography(interfaceFont: FontId, primary: FontId, secondary: FontId, code: FontId): Promise<void>;
  setTypographyScale(role: "interface" | "conversation", value: number): Promise<void>;
  setCodeBlockFontSize(size: number): Promise<void>;
  setEditorFontSize(size: number): Promise<void>;
  setEditorLauncher(command: string, argumentsTemplate: string): Promise<void>;
  chooseEditorApplication(): Promise<string | null>;
  setMaxSteps(maxSteps: number): Promise<void>;
  setAutoTitleGeneration(enabled: boolean): Promise<void>;
  setProviderTimeoutMinutes(minutes: number): Promise<void>;
  setProviderRetries(retries: number): Promise<void>;
  setSubagent(profile: SubagentProfile): Promise<void>;
  setImageUnderstanding(profile: ImageUnderstandingProfile): Promise<void>;
  setCompaction(mode: CompactionMode, threshold: number): Promise<void>;
  setSystemPrompt(prompt: string): Promise<DesktopState>;
  setToolEnabled(name: string, enabled: boolean): Promise<DesktopState>;
  setModelToolSurface(connectionId: string, model: string, surface: ModelToolSurface): Promise<DesktopState>;
  getContextReport(threadId: string, contextLength: number): Promise<ContextReport>;
  compactContext(threadId: string, connectionId: string, model: string, contextLength: number): Promise<void>;
  setWebSearchEnabled(enabled: boolean): Promise<void>;
  setWebSearchBackend(backend: WebSearchBackend): Promise<DesktopState>;
  setWebSearchApiKey(backend: KetchSearchBackend, apiKey: string): Promise<DesktopState>;
  saveMessage(input: SaveMessageInput): Promise<SavedMessageSummary[]>;
  deleteSavedMessage(id: string): Promise<SavedMessageSummary[]>;
  listSavedMessages(): Promise<SavedMessage[]>;
  openSavedMessage(id: string): Promise<SavedMessageSource | null>;
  keepAside(threadId: string, entryId: string): Promise<KeptAsideMessage[]>;
  removeAside(threadId: string, entryId: string): Promise<KeptAsideMessage[]>;
  getGitChanges(workspaceId: string): Promise<GitChanges>;
  getGitFile(workspaceId: string, path: string): Promise<GitFileContents>;
  getGitDiffPreview(workspaceId: string, path: string): Promise<GitDiffPreview>;
  saveGitFile(workspaceId: string, path: string, content: string, lineEnding: GitFileContents["lineEnding"]): Promise<void>;
  commitGitChanges(workspaceId: string, message: string, paths: string[]): Promise<GitChanges>;
  openWorkspaceFile(workspaceId: string, path: string): Promise<void>;
  revealWorkspaceFile(workspaceId: string, path: string): Promise<void>;
  initializeGitRepository(workspaceId: string): Promise<GitChanges>;
  openExternal(url: string): Promise<void>;
  openTerminal(workspaceId: string, columns: number, rows: number): Promise<void>;
  writeTerminal(workspaceId: string, data: string): Promise<void>;
  resizeTerminal(workspaceId: string, columns: number, rows: number): Promise<void>;
  closeTerminal(workspaceId: string): Promise<void>;
  onRunEvent(listener: (event: DesktopRunEvent) => void): () => void;
  onUpdateState(listener: (state: DesktopUpdateState) => void): () => void;
  onTerminalData(listener: (event: DesktopTerminalDataEvent) => void): () => void;
  onTerminalExit(listener: (event: DesktopTerminalExitEvent) => void): () => void;
}
