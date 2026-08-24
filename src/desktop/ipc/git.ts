import { ipcMain, shell } from "electron";
import { commitGitChanges, initializeGitRepository, saveGitFile } from "../../git/actions.js";
import { safeWorkspacePath } from "../../git/process.js";
import { gitChanges, gitDiffPreview, gitFileContents } from "../../git/repository.js";
import type { GitWalkthroughContext, GitWalkthroughTarget } from "../../git/types.js";
import { gitWalkthroughContext, gitWalkthroughOptions } from "../../git/walkthrough.js";
import { isReasoningEffort } from "../../providers/provider.js";
import type {
  GitWalkthroughResult,
  GitWalkthroughRunInput,
} from "../api.js";
import type { DesktopStore } from "../store.js";

export function registerGitIpc(
  store: DesktopStore,
  runWalkthrough: (
    context: GitWalkthroughContext,
    input: Omit<GitWalkthroughRunInput, "workspaceId" | "target">,
  ) => Promise<GitWalkthroughResult>,
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

  ipcMain.handle("desktop:get-git-walkthrough-options", async (_event, workspaceId: unknown) => {
    return gitWalkthroughOptions(await workspacePath(workspaceId));
  });

  ipcMain.handle("desktop:get-git-walkthrough", async (_event, value: unknown) => {
    const workspaceId = text(value, "Workspace ID");
    const workspace = await workspacePath(workspaceId);
    const saved = await store.gitWalkthrough(workspaceId);
    if (!saved) return null;
    const outdated = await gitWalkthroughContext(workspace, saved.target)
      .then((context) => context.snapshot !== saved.snapshot, () => true);
    return { ...saved, outdated };
  });

  ipcMain.handle("desktop:run-git-walkthrough", async (_event, rawInput: unknown) => {
    const input = walkthroughInput(rawInput);
    const context = await gitWalkthroughContext(await workspacePath(input.workspaceId), input.target);
    const result = await runWalkthrough(context, {
      providerConnectionId: input.providerConnectionId,
      model: input.model,
      ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
    });
    await store.saveGitWalkthrough(input.workspaceId, result);
    return result;
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

function walkthroughTarget(value: unknown): GitWalkthroughTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid walkthrough target");
  }
  const target = value as Record<string, unknown>;
  if (target.kind === "working") return { kind: "working" };
  if (target.kind === "branch" && typeof target.baseBranch === "string" && target.baseBranch) {
    return { kind: "branch", baseBranch: target.baseBranch };
  }
  throw new Error("Invalid walkthrough target");
}

function walkthroughInput(value: unknown): GitWalkthroughRunInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid walkthrough request");
  }
  const input = value as Record<string, unknown>;
  if (input.reasoningEffort !== undefined && !isReasoningEffort(input.reasoningEffort)) {
    throw new Error("Invalid reasoning effort");
  }
  return {
    workspaceId: text(input.workspaceId, "Workspace id"),
    target: walkthroughTarget(input.target),
    providerConnectionId: text(input.providerConnectionId, "Provider connection id"),
    model: text(input.model, "Model"),
    ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
  };
}
