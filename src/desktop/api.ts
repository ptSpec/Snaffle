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

export type DesktopState = {
  workspace: DesktopWorkspace | null;
  workspaces: DesktopWorkspace[];
  activeThreadId: string | null;
  conversation: Message[];
  openRouterAvailable: boolean;
  runningThreadIds: string[];
  defaultModel: string | null;
  unsafeHostDefault: boolean;
  themeId: string;
  maxSteps: number;
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
  openExternal(url: string): Promise<void>;
  onRunEvent(listener: (event: DesktopRunEvent) => void): () => void;
}
