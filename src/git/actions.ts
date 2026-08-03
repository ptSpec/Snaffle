import { LocalWorkspace } from "../workspace.js";
import type { GitFileContents } from "../desktop/api.js";
import { MAX_GIT_OUTPUT_BYTES, runGit } from "./process.js";

export async function initializeGitRepository(workspace: string): Promise<void> {
  await runGit(workspace, ["init"]);
}

export async function commitGitChanges(workspace: string, message: string, paths: string[]): Promise<void> {
  await runGit(workspace, ["--literal-pathspecs", "add", "-A", "--", ...paths]);
  await runGit(workspace, ["--literal-pathspecs", "commit", "--only", "-m", message, "--", ...paths]);
}

export async function saveGitFile(
  workspace: string,
  filePath: string,
  content: string,
  lineEnding: GitFileContents["lineEnding"],
): Promise<void> {
  const normalized = content.replaceAll("\r\n", "\n");
  const output = lineEnding === "crlf" ? normalized.replaceAll("\n", "\r\n") : normalized;
  if (Buffer.byteLength(output) > MAX_GIT_OUTPUT_BYTES) throw new Error("File is too large to edit here");
  await new LocalWorkspace(workspace, "disabled").write(filePath, output);
}
