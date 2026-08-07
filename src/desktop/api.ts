import type { AttachmentPreview, AttachmentRef } from "../attachments/types.js";
import type { OpenRouterModel } from "../providers/openrouter.js";
import type { CommandApprovalDecision, Message, RunEvent } from "../protocol.js";
import type { FontId } from "./typography.js";
import type { KetchSearchBackend, WebSearchBackend } from "../tools/web/types.js";
import type { CompactionMode } from "../context/budget.js";
import type { ContextCheckpoint } from "../context/projection.js";
import type { ContextReport } from "../context/report.js";

export type GitFileChange = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  exists: boolean;
  editable: boolean;
};

export type GitChanges = {
  state: "ready" | "unavailable" | "not-repository" | "error";
  message?: string;
  branch: string | null;
  files: GitFileChange[];
  additions: number;
  deletions: number;
};

export type GitFileContents = {
  current: string;
  original: string;
  lineEnding: "lf" | "crlf";
};

export type GitDiffPreview = {
  lines: string[];
  truncated: boolean;
};

export type DesktopThread = {
  id: string;
  workspaceId: string;
  title: string;
  draft: string;
  bookmarked: boolean;
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

export type DesktopState = {
  workspace: DesktopWorkspace | null;
  workspaces: DesktopWorkspace[];
  activeThreadId: string | null;
  conversation: DesktopEntry[];
  contextCheckpoints: ContextCheckpoint[];
  savedMessages: SavedMessageSummary[];
  openRouterAvailable: boolean;
  ketchAvailable: boolean;
  webSearchEnabled: boolean;
  webSearchBackend: WebSearchBackend;
  webSearchKeyBackends: KetchSearchBackend[];
  runningThreadIds: string[];
  unsafeThreadIds: string[];
  defaultModel: string | null;
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
  providerTimeoutMinutes: number;
  providerRetries: number;
  compactionMode: CompactionMode;
  compactionThreshold: number;
};

export type StartRunInput = {
  threadId: string;
  task: string;
  model: string;
  contextLength: number;
  attachments?: AttachmentRef[];
};

export type DesktopRunEvent = {
  threadId: string;
  event: RunEvent;
};

export interface DesktopApi {
  platform: string;
  getState(): Promise<DesktopState>;
  chooseWorkspace(): Promise<DesktopState | null>;
  selectWorkspace(workspaceId: string): Promise<DesktopState>;
  createThread(workspaceId: string): Promise<DesktopState>;
  selectThread(threadId: string): Promise<DesktopState>;
  setThreadDraft(threadId: string, draft: string): Promise<void>;
  setThreadBookmarked(threadId: string, bookmarked: boolean): Promise<DesktopState>;
  deleteThreads(threadIds: string[]): Promise<DesktopState>;
  removeWorkspace(workspaceId: string): Promise<DesktopState>;
  listOpenRouterModels(): Promise<OpenRouterModel[]>;
  setSelectedModel(model: string): Promise<void>;
  chooseAttachments(): Promise<AttachmentPreview[]>;
  importDroppedFiles(files: File[]): Promise<AttachmentPreview[]>;
  importClipboardImage(): Promise<AttachmentPreview>;
  readClipboardText(): Promise<string>;
  readClipboardHtml(): Promise<string>;
  removeAttachment(id: string): Promise<void>;
  setAttachmentContext(threadId: string, sequence: number, attachmentId: string, include: boolean): Promise<void>;
  startRun(input: StartRunInput): Promise<void>;
  steerRun(threadId: string, message: string): Promise<boolean>;
  stopRun(threadId: string): Promise<boolean>;
  setThreadUnsafe(threadId: string, unsafe: boolean): Promise<DesktopState>;
  resolveCommandApproval(id: string, decision: CommandApprovalDecision): Promise<DesktopState>;
  setTheme(themeId: string): Promise<void>;
  setTypography(interfaceFont: FontId, primary: FontId, secondary: FontId, code: FontId): Promise<void>;
  setTypographyScale(role: "interface" | "conversation", value: number): Promise<void>;
  setCodeBlockFontSize(size: number): Promise<void>;
  setEditorFontSize(size: number): Promise<void>;
  setEditorLauncher(command: string, argumentsTemplate: string): Promise<void>;
  chooseEditorApplication(): Promise<string | null>;
  setMaxSteps(maxSteps: number): Promise<void>;
  setProviderTimeoutMinutes(minutes: number): Promise<void>;
  setProviderRetries(retries: number): Promise<void>;
  setCompaction(mode: CompactionMode, threshold: number): Promise<void>;
  getContextReport(threadId: string, contextLength: number): Promise<ContextReport>;
  compactContext(threadId: string, model: string, contextLength: number): Promise<void>;
  setWebSearchEnabled(enabled: boolean): Promise<void>;
  setWebSearchBackend(backend: WebSearchBackend): Promise<DesktopState>;
  setWebSearchApiKey(backend: KetchSearchBackend, apiKey: string): Promise<DesktopState>;
  saveMessage(input: SaveMessageInput): Promise<SavedMessageSummary[]>;
  deleteSavedMessage(id: string): Promise<SavedMessageSummary[]>;
  listSavedMessages(): Promise<SavedMessage[]>;
  openSavedMessage(id: string): Promise<SavedMessageSource | null>;
  getGitChanges(workspaceId: string): Promise<GitChanges>;
  getGitFile(workspaceId: string, path: string): Promise<GitFileContents>;
  getGitDiffPreview(workspaceId: string, path: string): Promise<GitDiffPreview>;
  saveGitFile(workspaceId: string, path: string, content: string, lineEnding: GitFileContents["lineEnding"]): Promise<void>;
  commitGitChanges(workspaceId: string, message: string, paths: string[]): Promise<GitChanges>;
  openWorkspaceFile(workspaceId: string, path: string): Promise<void>;
  revealWorkspaceFile(workspaceId: string, path: string): Promise<void>;
  initializeGitRepository(workspaceId: string): Promise<GitChanges>;
  openExternal(url: string): Promise<void>;
  onRunEvent(listener: (event: DesktopRunEvent) => void): () => void;
}
