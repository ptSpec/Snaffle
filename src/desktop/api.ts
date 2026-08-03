import type { OpenRouterModel } from "../providers/openrouter.js";
import type { CommandApprovalDecision, Message, RunEvent } from "../protocol.js";

export type GitFileChange = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  exists: boolean;
};

export type GitChanges = {
  state: "ready" | "unavailable" | "not-repository" | "error";
  message?: string;
  files: GitFileChange[];
  additions: number;
  deletions: number;
};

export type GitFileContents = {
  current: string;
  original: string;
  lineEnding: "lf" | "crlf";
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
  savedMessages: SavedMessage[];
  openRouterAvailable: boolean;
  runningThreadIds: string[];
  unsafeThreadIds: string[];
  defaultModel: string | null;
  restrictedHostAvailable: boolean;
  restrictedHostDetail: string;
  themeId: string;
  editorFontSize: number;
  maxSteps: number;
  providerTimeoutMinutes: number;
  providerRetries: number;
};

export type StartRunInput = {
  threadId: string;
  task: string;
  model: string;
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
  startRun(input: StartRunInput): Promise<void>;
  stopRun(threadId: string): Promise<boolean>;
  setThreadUnsafe(threadId: string, unsafe: boolean): Promise<DesktopState>;
  resolveCommandApproval(id: string, decision: CommandApprovalDecision): Promise<DesktopState>;
  setTheme(themeId: string): Promise<void>;
  setEditorFontSize(size: number): Promise<void>;
  setMaxSteps(maxSteps: number): Promise<void>;
  setProviderTimeoutMinutes(minutes: number): Promise<void>;
  setProviderRetries(retries: number): Promise<void>;
  saveMessage(input: SaveMessageInput): Promise<SavedMessage[]>;
  deleteSavedMessage(id: string): Promise<SavedMessage[]>;
  openSavedMessage(id: string): Promise<SavedMessageSource | null>;
  getGitChanges(workspaceId: string): Promise<GitChanges>;
  getGitFile(workspaceId: string, path: string): Promise<GitFileContents>;
  saveGitFile(workspaceId: string, path: string, content: string, lineEnding: GitFileContents["lineEnding"]): Promise<void>;
  openWorkspaceFile(workspaceId: string, path: string): Promise<void>;
  revealWorkspaceFile(workspaceId: string, path: string): Promise<void>;
  initializeGitRepository(workspaceId: string): Promise<GitChanges>;
  openExternal(url: string): Promise<void>;
  onRunEvent(listener: (event: DesktopRunEvent) => void): () => void;
}
