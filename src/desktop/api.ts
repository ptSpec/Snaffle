import type { OpenRouterModel } from "../providers/openrouter.js";
import type { Message, RunEvent } from "../protocol.js";

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
  defaultModel: string | null;
  unsafeHostDefault: boolean;
  themeId: string;
  maxSteps: number;
  providerTimeoutMinutes: number;
  providerRetries: number;
};

export type StartRunInput = {
  threadId: string;
  task: string;
  model: string;
  unsafeHostExecution: boolean;
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
  setTheme(themeId: string): Promise<void>;
  setMaxSteps(maxSteps: number): Promise<void>;
  setProviderTimeoutMinutes(minutes: number): Promise<void>;
  setProviderRetries(retries: number): Promise<void>;
  saveMessage(input: SaveMessageInput): Promise<SavedMessage[]>;
  deleteSavedMessage(id: string): Promise<SavedMessage[]>;
  openSavedMessage(id: string): Promise<SavedMessageSource | null>;
  openExternal(url: string): Promise<void>;
  onRunEvent(listener: (event: DesktopRunEvent) => void): () => void;
}
