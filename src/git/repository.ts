import { readFile, stat } from "node:fs/promises";
import type { GitChanges, GitFileChange, GitFileContents } from "../desktop/api.js";
import { MAX_GIT_OUTPUT_BYTES, runGit, safeWorkspacePath } from "./process.js";

export async function gitChanges(workspace: string): Promise<GitChanges> {
  let prefix: string;
  try {
    prefix = (await runGit(workspace, ["rev-parse", "--show-prefix"])).stdout.trim().replace(/\/$/, "");
  } catch (error) {
    if (isMissingCommand(error)) return empty("unavailable", "Git is not installed or could not be found.");
    if (exitCode(error) === 128) return empty("not-repository", "This workspace is not a Git repository.");
    return empty("error", errorText(error));
  }

  try {
    const status = await runGit(workspace, [
      "status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames", "--", ".",
    ]);
    const parsed = parseGitStatus(status.stdout).map((change) => ({
      ...change,
      path: workspaceRelativePath(change.path, prefix),
    }));
    const hasHead = await gitHasHead(workspace);
    const numstat = await runGit(
      workspace,
      hasHead
        ? ["diff", "--numstat", "-z", "--no-renames", "HEAD", "--", "."]
        : ["diff", "--numstat", "-z", "--no-renames", "--cached", "--", "."],
    );
    const counts = new Map(
      [...parseGitNumstat(numstat.stdout)].map(([filePath, count]) => [
        workspaceRelativePath(filePath, prefix),
        count,
      ]),
    );
    const files = await Promise.all(parsed.map(async (change) => {
      const file = safeWorkspacePath(workspace, change.path);
      const exists = await stat(file).then(() => true, () => false);
      const tracked = counts.get(change.path);
      const additions = tracked?.additions ?? (change.status === "?" && exists ? await lineCount(file) : 0);
      return { ...change, additions, deletions: tracked?.deletions ?? 0, exists };
    }));

    return {
      state: "ready",
      files,
      additions: files.reduce((total, file) => total + file.additions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0),
    };
  } catch (error) {
    return empty("error", errorText(error));
  }
}

export async function gitFileContents(workspace: string, filePath: string): Promise<GitFileContents> {
  const file = safeWorkspacePath(workspace, filePath);
  const prefix = (await runGit(workspace, ["rev-parse", "--show-prefix"])).stdout.trim().replace(/\/$/, "");
  const current = await readTextFile(file).catch((error) => {
    if (isMissingCommand(error)) return "";
    throw error;
  });
  const repositoryPath = prefix ? `${prefix}/${filePath}` : filePath;
  const original = await runGit(workspace, ["show", `HEAD:${repositoryPath}`])
    .then(({ stdout }) => textContent(stdout), (error) => exitCode(error) === 128 ? "" : Promise.reject(error));
  return {
    current: normalizeLineEndings(current),
    original: normalizeLineEndings(original),
    lineEnding: detectLineEnding(current.includes("\n") ? current : original),
  };
}

export function parseGitStatus(output: string): Omit<GitFileChange, "additions" | "deletions" | "exists">[] {
  return output.split("\0").filter(Boolean).map((entry) => ({
    path: entry.slice(3),
    status: statusLabel(entry.slice(0, 2)),
  }));
}

export function parseGitNumstat(output: string): Map<string, { additions: number; deletions: number }> {
  const result = new Map<string, { additions: number; deletions: number }>();
  for (const entry of output.split("\0").filter(Boolean)) {
    const [added, deleted, ...name] = entry.split("\t");
    if (!added || !deleted || name.length === 0) continue;
    result.set(name.join("\t"), {
      additions: Number.isFinite(Number(added)) ? Number(added) : 0,
      deletions: Number.isFinite(Number(deleted)) ? Number(deleted) : 0,
    });
  }
  return result;
}

async function gitHasHead(workspace: string): Promise<boolean> {
  return runGit(workspace, ["rev-parse", "--verify", "HEAD"]).then(() => true, () => false);
}

async function lineCount(file: string): Promise<number> {
  const info = await stat(file);
  if (info.size > MAX_GIT_OUTPUT_BYTES) return 0;
  const content = await readFile(file, "utf8");
  if (content.includes("\0") || content.length === 0) return 0;
  return content.replaceAll("\r\n", "\n").split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

async function readTextFile(file: string): Promise<string> {
  if ((await stat(file)).size > MAX_GIT_OUTPUT_BYTES) throw new Error("File is too large to edit here");
  return textContent(await readFile(file, "utf8"));
}

function textContent(content: string): string {
  if (content.includes("\0")) throw new Error("Binary files cannot be edited here");
  return content;
}

function normalizeLineEndings(content: string): string {
  return content.replaceAll("\r\n", "\n");
}

function detectLineEnding(content: string): GitFileContents["lineEnding"] {
  const newlines = content.split("\n").length - 1;
  const crlf = content.split("\r\n").length - 1;
  return crlf > newlines - crlf ? "crlf" : "lf";
}

function workspaceRelativePath(filePath: string, prefix: string): string {
  return prefix && filePath.startsWith(`${prefix}/`) ? filePath.slice(prefix.length + 1) : filePath;
}

function statusLabel(code: string): string {
  if (code === "??") return "?";
  if (code.includes("D")) return "D";
  if (code.includes("A")) return "A";
  if (code.includes("R")) return "R";
  return "M";
}

function empty(state: GitChanges["state"], message: string): GitChanges {
  return { state, message, files: [], additions: 0, deletions: 0 };
}

function isMissingCommand(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function exitCode(error: unknown): number | undefined {
  return error !== null && typeof error === "object" && "code" in error && typeof error.code === "number" ? error.code : undefined;
}

function errorText(error: unknown): string {
  if (error !== null && typeof error === "object" && "stderr" in error && typeof error.stderr === "string") {
    return error.stderr.trim() || "Git command failed.";
  }
  return error instanceof Error ? error.message : String(error);
}
