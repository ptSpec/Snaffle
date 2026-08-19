import { BrowserWindow, clipboard, dialog, ipcMain } from "electron";
import path from "node:path";
import type { OpenDialogOptions } from "electron";
import type { AttachmentStore } from "../../attachments/store.js";
import { MAX_ATTACHMENTS } from "../../attachments/store.js";
import type { DesktopStore } from "../store.js";
import { DEFAULT_TOOL_OUTPUT_CHARS, truncateMiddle } from "../../tools/output.js";

const MAX_TERMINAL_CAPTURE_CHARS = 200_000;
const MAX_CODE_SELECTION_CHARS = 200_000;

export function registerAttachmentIpc(
  store: DesktopStore,
  attachments: AttachmentStore,
  mainWindow: () => BrowserWindow | undefined,
): void {
  ipcMain.handle("desktop:choose-attachments", async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow();
    const options: OpenDialogOptions = {
      title: "Attach files",
      properties: ["openFile", "multiSelections"],
      filters: [{
        name: "Images and documents",
        extensions: ["png", "jpg", "jpeg", "webp", "gif", "pdf", "txt", "md", "json", "csv", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "odt", "ods", "odp", "rtf", "epub"],
      }],
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : attachments.importFiles(result.filePaths.slice(0, MAX_ATTACHMENTS));
  });

  ipcMain.handle("desktop:import-clipboard-image", async () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) throw new Error("The clipboard does not contain an image");
    return attachments.importClipboardImage(image.toPNG());
  });

  ipcMain.handle("desktop:import-terminal-output", async (
    _event,
    workspaceValue: unknown,
    outputValue: unknown,
  ) => {
    const workspaceId = id(workspaceValue, "Workspace");
    const workspace = (await store.state()).workspaces.find((item) => item.id === workspaceId);
    if (!workspace) throw new Error("Workspace no longer exists");
    if (typeof outputValue !== "string" || outputValue.length > MAX_TERMINAL_CAPTURE_CHARS) {
      throw new Error("Terminal output must be text no longer than 200,000 characters");
    }
    const output = outputValue.trim();
    if (!output) throw new Error("The terminal has no output to attach");
    const heading = `Terminal output from ${workspace.name}:\n\n`;
    const text = `${heading}${truncateMiddle(output, DEFAULT_TOOL_OUTPUT_CHARS - heading.length)}`;
    return attachments.importText("Terminal output.txt", text);
  });

  ipcMain.handle("desktop:import-code-selection", (_event, value: unknown) => {
    const selection = codeSelection(value);
    const label = selection.ranges.length === 1
      ? `${path.basename(selection.path)} · lines ${lineLabel(selection.ranges[0]!)}`
      : `${path.basename(selection.path)} · ${selection.ranges.length} selections`;
    const sections = selection.ranges.map((range, index) => [
      `## Selection ${index + 1} · lines ${lineLabel(range)}`,
      codeBlock(range.text),
    ].join("\n\n"));
    return attachments.importText(
      label,
      [`Selected code from workspace file \`${selection.path}\`.`, ...sections].join("\n\n"),
    );
  });

  ipcMain.handle("desktop:import-dropped-files", (_event, value: unknown) => {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new Error("Dropped files must be local file paths");
    }
    return attachments.importFiles(value.slice(0, MAX_ATTACHMENTS));
  });

  ipcMain.handle("desktop:read-clipboard-text", () => clipboard.readText());
  ipcMain.handle("desktop:read-clipboard-html", () => clipboard.readHTML());
  ipcMain.handle("desktop:remove-attachment", (_event, value: unknown) => attachments.remove(id(value, "Attachment")));

  ipcMain.handle(
    "desktop:set-attachment-context",
    (_event, threadId: unknown, sequence: unknown, attachmentId: unknown, include: unknown) => {
      if (typeof include !== "boolean") throw new Error("Invalid attachment context setting");
      if (!Number.isInteger(sequence) || Number(sequence) < 0) throw new Error("Invalid message sequence");
      return store.setAttachmentContext(
        id(threadId, "Thread"),
        Number(sequence),
        id(attachmentId, "Attachment"),
        include,
      );
    },
  );
}

function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} ID must be text`);
  return value;
}

type CodeSelection = {
  path: string;
  ranges: Array<{ fromLine: number; toLine: number; text: string }>;
};

function codeSelection(value: unknown): CodeSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid code selection");
  const input = value as { path?: unknown; ranges?: unknown };
  if (typeof input.path !== "string" || !input.path || input.path.length > 1_000) {
    throw new Error("Code selection path must be text");
  }
  if (!Array.isArray(input.ranges) || !input.ranges.length || input.ranges.length > 64) {
    throw new Error("Select between 1 and 64 code ranges");
  }

  let characters = 0;
  const ranges = input.ranges.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid code selection range");
    const range = item as { fromLine?: unknown; toLine?: unknown; text?: unknown };
    if (!Number.isInteger(range.fromLine) || !Number.isInteger(range.toLine) ||
        Number(range.fromLine) < 1 || Number(range.toLine) < Number(range.fromLine)) {
      throw new Error("Code selection lines are invalid");
    }
    if (typeof range.text !== "string" || !range.text.length) throw new Error("Code selection is empty");
    characters += range.text.length;
    return { fromLine: Number(range.fromLine), toLine: Number(range.toLine), text: range.text };
  });
  if (characters > MAX_CODE_SELECTION_CHARS) throw new Error("Selected code is larger than 200,000 characters");
  return { path: input.path, ranges };
}

function lineLabel(range: { fromLine: number; toLine: number }): string {
  return range.fromLine === range.toLine ? String(range.fromLine) : `${range.fromLine}–${range.toLine}`;
}

function codeBlock(text: string): string {
  const longest = Math.max(3, ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1));
  const fence = "`".repeat(longest);
  return `${fence}\n${text}\n${fence}`;
}
