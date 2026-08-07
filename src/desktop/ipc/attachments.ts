import { BrowserWindow, clipboard, dialog, ipcMain } from "electron";
import type { OpenDialogOptions } from "electron";
import type { AttachmentStore } from "../../attachments/store.js";
import { MAX_ATTACHMENTS } from "../../attachments/store.js";
import type { DesktopStore } from "../store.js";

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
