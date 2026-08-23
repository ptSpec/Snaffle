import { safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CompactionMode } from "../context/budget.js";
import type { SubagentProfile } from "../agent/subagents/profile.js";
import type { KetchSearchBackend, WebSearchBackend } from "../tools/web/types.js";
import type { McpServerConfig } from "../mcp/types.js";
import type { FontId } from "./typography.js";
import type { ImageUnderstandingProfile } from "../attachments/vision.js";
import type { ModelToolSurfaces } from "../capabilities/surface.js";
import type { RestrictedEngine } from "../execution/workspace.js";

export type SavedSettings = {
  onboardingComplete?: unknown;
  themeId?: unknown;
  animationsEnabled?: unknown;
  interfaceFont?: unknown;
  primaryFont?: unknown;
  secondaryFont?: unknown;
  codeFont?: unknown;
  interfaceFontScale?: unknown;
  conversationFontScale?: unknown;
  codeBlockFontSize?: unknown;
  editorFontSize?: unknown;
  editorCommand?: unknown;
  editorArguments?: unknown;
  maxSteps?: unknown;
  autoTitleGeneration?: unknown;
  restrictedEngine?: unknown;
  providerTimeoutMinutes?: unknown;
  providerRetries?: unknown;
  subagent?: unknown;
  compactionMode?: unknown;
  compactionThreshold?: unknown;
  selectedModel?: unknown;
  selectedProviderConnectionId?: unknown;
  providerConnections?: unknown;
  tavilyApiKey?: unknown;
  webSearchEnabled?: unknown;
  webSearchBackend?: unknown;
  webSearchApiKeys?: unknown;
  mcpEnabled?: unknown;
  mcpServers?: unknown;
  systemPrompt?: unknown;
  disabledTools?: unknown;
  imageUnderstanding?: unknown;
  modelToolSurfaces?: unknown;
};

export type SettingsUpdate = {
  onboardingComplete?: boolean;
  themeId?: string;
  animationsEnabled?: boolean;
  interfaceFont?: FontId;
  primaryFont?: FontId;
  secondaryFont?: FontId;
  codeFont?: FontId;
  interfaceFontScale?: number;
  conversationFontScale?: number;
  codeBlockFontSize?: number;
  editorFontSize?: number;
  editorCommand?: string;
  editorArguments?: string;
  maxSteps?: number;
  autoTitleGeneration?: boolean;
  restrictedEngine?: RestrictedEngine;
  providerTimeoutMinutes?: number;
  providerRetries?: number;
  subagent?: SubagentProfile;
  compactionMode?: CompactionMode;
  compactionThreshold?: number;
  selectedModel?: string;
  selectedProviderConnectionId?: string;
  providerConnections?: unknown[];
  tavilyApiKey?: string | undefined;
  webSearchEnabled?: boolean;
  webSearchBackend?: WebSearchBackend;
  webSearchApiKeys?: Partial<Record<KetchSearchBackend, string>>;
  mcpEnabled?: boolean;
  mcpServers?: McpServerConfig[];
  systemPrompt?: string;
  disabledTools?: string[];
  imageUnderstanding?: ImageUnderstandingProfile;
  modelToolSurfaces?: ModelToolSurfaces;
};

export function loadSettings(file: string): SavedSettings {
  try {
    if (!existsSync(file)) return {};
    const value = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as SavedSettings
      : {};
  } catch {
    return {};
  }
}

export function saveSettings(file: string, update: SettingsUpdate): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...loadSettings(file), ...update }, null, 2)}\n`);
}

export function encodeSecret(value: string): string {
  return safeStorage.isEncryptionAvailable()
    ? `encrypted:${safeStorage.encryptString(value).toString("base64")}`
    : `plain:${Buffer.from(value).toString("base64")}`;
}

export function decodeSecret(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    if (value.startsWith("encrypted:")) {
      return safeStorage.decryptString(Buffer.from(value.slice(10), "base64"));
    }
    if (value.startsWith("plain:")) return Buffer.from(value.slice(6), "base64").toString();
  } catch {
    return "";
  }
  return "";
}
