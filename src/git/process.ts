import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);
export const MAX_GIT_OUTPUT_BYTES = 8 * 1024 * 1024;

export function runGit(
  workspace: string,
  args: string[],
  environment: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string }> {
  return runFile("git", args, {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", ...environment },
  });
}

export function safeWorkspacePath(workspace: string, filePath: string): string {
  if (!filePath || path.isAbsolute(filePath)) throw new Error("File path must be workspace-relative");
  const root = path.resolve(workspace);
  const target = path.resolve(root, filePath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("File path leaves the workspace");
  return target;
}
