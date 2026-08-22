import path from "node:path";
import type { Message } from "../protocol.js";

const sessionStartedAt = new Date();

export function currentEnvironmentMessage(executionEnvironment?: string): Message {
  return {
    role: "system",
    content: currentEnvironmentContent(sessionStartedAt, executionEnvironment),
  };
}

export function currentEnvironmentContent(
  now = sessionStartedAt,
  executionEnvironment?: string,
): string {
  const platform = process.platform === "darwin"
    ? "macOS"
    : process.platform === "win32"
      ? "Windows"
      : "Linux";
  const resolvedLocale = Intl.DateTimeFormat().resolvedOptions();
  const zone = resolvedLocale.timeZone;
  const locale = resolvedLocale.locale;
  const language = new Intl.DisplayNames(["en"], { type: "language" }).of(locale) ?? locale;
  const shellPath = process.env.SHELL ?? process.env.COMSPEC;
  const shell = shellPath ? path.basename(shellPath.replaceAll("\\", "/")) : "unknown";

  const runtime = executionEnvironment
    ? `- Command environment: ${executionEnvironment}`
    : `- Platform: ${platform} ${process.arch}
- Workspace: current project root; use workspace-relative paths
- Shell: ${shell}`;

  return `Current environment:
- Current date: ${localDate(now)}
- Time zone: ${zone} (${utcOffset(now)})
- Preferred language: ${language} (${locale}); use it unless the user asks for another language
${runtime}`;
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
