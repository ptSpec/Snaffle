import { ipcMain, shell } from "electron";
import { commitGitChanges, initializeGitRepository, saveGitFile } from "../../git/actions.js";
import { safeWorkspacePath } from "../../git/process.js";
import { gitChanges, gitDiffPreview, gitFileContents } from "../../git/repository.js";
import type { DesktopStore } from "../store.js";

export function registerGitIpc(
  store: DesktopStore,
  openFile: (target: string) => Promise<void>,
): void {
  const workspacePath = async (value: unknown): Promise<string> => {
    const id = text(value, "Workspace ID");
    const workspace = (await store.state()).workspaces.find((item) => item.id === id);
    if (!workspace) throw new Error("The selected workspace no longer exists");
    return workspace.path;
  };

  ipcMain.handle("desktop:get-git-changes", async (_event, value: unknown) => {
    return gitChanges(await workspacePath(value));
  });

  ipcMain.handle("desktop:get-git-file", async (_event, workspaceId: unknown, filePath: unknown) => {
    return gitFileContents(await workspacePath(workspaceId), text(filePath, "File path"));
  });

  ipcMain.handle("desktop:get-git-diff-preview", async (_event, workspaceId: unknown, filePath: unknown) => {
    return gitDiffPreview(await workspacePath(workspaceId), text(filePath, "File path"));
  });

  ipcMain.handle("desktop:get-turn-changes", async (_event, value: unknown) => {
    return store.turnChanges(text(value, "Change artifact ID"));
  });

  ipcMain.handle("desktop:save-git-file", async (
    _event,
    workspaceId: unknown,
    filePath: unknown,
    content: unknown,
    lineEnding: unknown,
  ) => {
    if (typeof content !== "string") throw new Error("File content must be a string");
    if (lineEnding !== "lf" && lineEnding !== "crlf") throw new Error("Invalid line ending");
    await saveGitFile(await workspacePath(workspaceId), text(filePath, "File path"), content, lineEnding);
  });

  ipcMain.handle("desktop:commit-git-changes", async (
    _event,
    workspaceId: unknown,
    rawMessage: unknown,
    rawPaths: unknown,
  ) => {
    const workspace = await workspacePath(workspaceId);
    const message = typeof rawMessage === "string" ? rawMessage.trim() : "";
    if (!message) throw new Error("Enter a commit message");
    if (message.length > 6000) throw new Error("Commit message is too long");
    const paths = filePaths(rawPaths);
    paths.forEach((filePath) => safeWorkspacePath(workspace, filePath));
    await commitGitChanges(workspace, message, paths);
    return gitChanges(workspace);
  });

  ipcMain.handle("desktop:open-workspace-file", async (_event, workspaceId: unknown, filePath: unknown) => {
    await openFile(safeWorkspacePath(await workspacePath(workspaceId), text(filePath, "File path")));
  });

  ipcMain.handle("desktop:reveal-workspace-file", async (_event, workspaceId: unknown, filePath: unknown) => {
    shell.showItemInFolder(safeWorkspacePath(await workspacePath(workspaceId), text(filePath, "File path")));
  });

  ipcMain.handle("desktop:initialize-git-repository", async (_event, workspaceId: unknown) => {
    const workspace = await workspacePath(workspaceId);
    await initializeGitRepository(workspace);
    return gitChanges(workspace);
  });
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be text`);
  return value;
}

function filePaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item)) {
    throw new Error("Select at least one file to commit");
  }
  return value;
}
