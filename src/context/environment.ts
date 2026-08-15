import path from "node:path";
import type { Workspace } from "../execution/workspace.js";
import type { Message } from "../protocol.js";

const sessionStartedAt = new Date();

export function currentEnvironmentMessage(workspace: Workspace, now = sessionStartedAt): Message {
  return { role: "system", content: currentEnvironmentContent(workspace.root, now) };
}

export function currentEnvironmentContent(workspaceRoot: string | undefined, now = sessionStartedAt): string {
  const platform = process.platform === "darwin"
    ? "macOS"
    : process.platform === "win32"
      ? "Windows"
      : "Linux";
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const shellPath = process.env.SHELL ?? process.env.COMSPEC;
  const shell = shellPath ? path.basename(shellPath.replaceAll("\\", "/")) : "unknown";

  return `Current environment:
- Current date: ${localDate(now)}
- Time zone: ${zone} (${utcOffset(now)})
- Platform: ${platform} ${process.arch}
- Workspace: ${workspaceRoot ?? "unknown"}
- Shell: ${shell}`;
}

export function withCurrentEnvironment(messages: Message[], environment: Message): Message[] {
  const firstNonSystem = messages.findIndex((message) => message.role !== "system");
  const index = firstNonSystem < 0 ? messages.length : firstNonSystem;
  return [...messages.slice(0, index), environment, ...messages.slice(index)];
}

function localDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function utcOffset(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}
