import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runGit } from "./process.js";
import { parseGitNumstat } from "./repository.js";
import type { TurnChangesArtifact } from "./types.js";

const MAX_PATCH_CHARACTERS = 200_000;

export type TurnChangesBaseline = {
  workspace: string;
  tree: string;
  revision: string | null;
  directory: string;
  environment: Record<string, string>;
};

export async function beginTurnChanges(workspace: string): Promise<TurnChangesBaseline | null> {
  let directory: string | null = null;
  try {
    directory = await mkdtemp(path.join(tmpdir(), "snaffle-turn-"));
    const objects = path.join(directory, "objects");
    await mkdir(objects);
    const repositoryObjects = (await runGit(workspace, ["rev-parse", "--git-path", "objects"])).stdout.trim();
    const environment = {
      GIT_INDEX_FILE: path.join(directory, "index"),
      GIT_OBJECT_DIRECTORY: objects,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: path.resolve(workspace, repositoryObjects),
    };
    return { workspace, directory, environment, ...(await snapshot(workspace, environment)) };
  } catch {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    return null;
  }
}

export async function finishTurnChanges(
  baseline: TurnChangesBaseline | null,
): Promise<Omit<TurnChangesArtifact, "id"> | null> {
  if (!baseline) return null;
  try {
    const end = await snapshot(baseline.workspace, baseline.environment);
    if (end.tree === baseline.tree) return null;

    const args = ["--literal-pathspecs", "diff", "--no-ext-diff", "--no-color", "--no-renames"];
    const numstat = await runGit(baseline.workspace, [
      ...args,
      "--numstat",
      "-z",
      baseline.tree,
      end.tree,
      "--",
      ".",
    ], baseline.environment);
    const files = parseGitNumstat(numstat.stdout);
    const output = await runGit(baseline.workspace, [
      ...args,
      "--unified=3",
      baseline.tree,
      end.tree,
      "--",
      ".",
    ], baseline.environment).then(({ stdout }) => stdout, () => "");
    const truncated = output.length > MAX_PATCH_CHARACTERS || !output;

    return {
      version: 1,
      files: files.size,
      additions: [...files.values()].reduce((total, file) => total + file.additions, 0),
      deletions: [...files.values()].reduce((total, file) => total + file.deletions, 0),
      truncated,
      patch: truncatePatch(output),
      startRevision: baseline.revision,
      endRevision: end.revision,
    };
  } catch {
    return null;
  } finally {
    await discardTurnChanges(baseline);
  }
}

export async function discardTurnChanges(baseline: TurnChangesBaseline | null): Promise<void> {
  if (baseline) await rm(baseline.directory, { recursive: true, force: true }).catch(() => undefined);
}

async function snapshot(
  workspace: string,
  environment: Record<string, string>,
): Promise<{ tree: string; revision: string | null }> {
  const revision = await runGit(workspace, ["rev-parse", "--verify", "HEAD"], environment)
    .then(({ stdout }) => stdout.trim(), () => null);
  await runGit(workspace, revision ? ["read-tree", revision] : ["read-tree", "--empty"], environment);
  await runGit(workspace, ["add", "-A", "--", "."], environment);
  const tree = (await runGit(workspace, ["write-tree"], environment)).stdout.trim();
  return { tree, revision };
}

function truncatePatch(patch: string): string {
  if (patch.length <= MAX_PATCH_CHARACTERS) return patch;
  const end = patch.lastIndexOf("\n", MAX_PATCH_CHARACTERS);
  return `${patch.slice(0, end > 0 ? end : MAX_PATCH_CHARACTERS)}\n… diff truncated\n`;
}
