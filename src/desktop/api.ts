import type { OpenRouterModel } from "../providers/openrouter.js";
import type { RunEvent } from "../protocol.js";

export type DesktopWorkspace = {
  path: string;
  name: string;
};

export type DesktopState = {
  workspace: DesktopWorkspace | null;
  openRouterAvailable: boolean;
  runActive: boolean;
  defaultModel: string | null;
  unsafeHostDefault: boolean;
  themeId: string;
};

export type StartRunInput = {
  task: string;
  model: string;
  unsafeHostExecution: boolean;
};

export interface DesktopApi {
  platform: string;
  getState(): Promise<DesktopState>;
  chooseWorkspace(): Promise<DesktopWorkspace | null>;
  listOpenRouterModels(): Promise<OpenRouterModel[]>;
  startRun(input: StartRunInput): Promise<void>;
  stopRun(): Promise<boolean>;
  resetConversation(): Promise<void>;
  setTheme(themeId: string): Promise<void>;
  onRunEvent(listener: (event: RunEvent) => void): () => void;
}
