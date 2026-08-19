import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { commitGitChanges, saveGitFile } from "../src/git/actions.js";
import { gitChanges, gitDiffPreview, gitFileContents, parseGitNumstat, parseGitStatus } from "../src/git/repository.js";
import { beginTurnChanges, finishTurnChanges } from "../src/git/turn-changes.js";

const exec = promisify(execFile);

test("Git porcelain output preserves paths and change counts", () => {
  assert.deepEqual(parseGitStatus(" M src/app.ts\0?? folder/new file.ts\0A  staged.ts\0"), [
    { path: "src/app.ts", status: "M" },
    { path: "folder/new file.ts", status: "?" },
    { path: "staged.ts", status: "A" },
  ]);
  assert.deepEqual(
    [...parseGitNumstat("4\t2\tsrc/app.ts\u00003\t0\tfolder/new file.ts\u0000")],
    [
      ["src/app.ts", { additions: 4, deletions: 2 }],
      ["folder/new file.ts", { additions: 3, deletions: 0 }],
    ],
  );
});

test("Git editor preserves CRLF line endings", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-git-"));
  try {
    await exec("git", ["init"], { cwd: workspace });
    await writeFile(join(workspace, "example.txt"), "one\ntwo\n");
    await exec("git", ["add", "example.txt"], { cwd: workspace });
    await exec("git", ["-c", "user.name=Snaffle Test", "-c", "user.email=test@example.com", "commit", "-m", "initial"], { cwd: workspace });
    await writeFile(join(workspace, "example.txt"), "one\r\ntwo changed\r\n");

    const contents = await gitFileContents(workspace, "example.txt");
    assert.deepEqual(contents, {
      current: "one\ntwo changed\n",
      original: "one\ntwo\n",
      lineEnding: "crlf",
    });

    await saveGitFile(workspace, "example.txt", "one\ntwo saved\n", contents.lineEnding);
    assert.equal(await readFile(join(workspace, "example.txt"), "utf8"), "one\r\ntwo saved\r\n");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("Git changes do not open directory symbolic links as files", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-git-link-"));
  try {
    await exec("git", ["init"], { cwd: workspace });
    await mkdir(join(workspace, "target"));
    await symlink(join(workspace, "target"), join(workspace, "current"));

    const changes = await gitChanges(workspace);
    const link = changes.files.find((file) => file.path === "current");
    assert.equal(link?.exists, true);
    assert.equal(link?.editable, false);
    await assert.rejects(gitFileContents(workspace, "current"), /Symbolic links cannot be edited/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("Git commit includes only selected files", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-git-commit-"));
  try {
    await exec("git", ["init"], { cwd: workspace });
    await exec("git", ["config", "user.name", "Snaffle Test"], { cwd: workspace });
    await exec("git", ["config", "user.email", "test@example.com"], { cwd: workspace });
    await writeFile(join(workspace, "one.txt"), "one\n");
    await writeFile(join(workspace, "two.txt"), "two\n");
    await exec("git", ["add", "."], { cwd: workspace });
    await exec("git", ["commit", "-m", "initial"], { cwd: workspace });

    await writeFile(join(workspace, "one.txt"), "one changed\n");
    await writeFile(join(workspace, "two.txt"), "two changed\n");
    await writeFile(join(workspace, "new.txt"), "new\n");
    const preview = await gitDiffPreview(workspace, "one.txt");
    assert.ok(preview.lines.includes("-one"));
    assert.ok(preview.lines.includes("+one changed"));
    await exec("git", ["add", "two.txt"], { cwd: workspace });
    await commitGitChanges(workspace, "selected files", ["one.txt", "new.txt"]);

    assert.equal((await exec("git", ["show", "HEAD:one.txt"], { cwd: workspace })).stdout, "one changed\n");
    assert.equal((await exec("git", ["show", "HEAD:new.txt"], { cwd: workspace })).stdout, "new\n");
    assert.equal((await exec("git", ["show", "HEAD:two.txt"], { cwd: workspace })).stdout, "two\n");
    assert.match((await exec("git", ["status", "--porcelain", "two.txt"], { cwd: workspace })).stdout, /^M  two\.txt/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("turn changes exclude work that existed before the run", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "snaffle-turn-changes-"));
  try {
    await exec("git", ["init"], { cwd: workspace });
    await exec("git", ["config", "user.name", "Snaffle Test"], { cwd: workspace });
    await exec("git", ["config", "user.email", "test@example.com"], { cwd: workspace });
    await writeFile(join(workspace, "existing.txt"), "committed\n");
    await exec("git", ["add", "."], { cwd: workspace });
    await exec("git", ["commit", "-m", "initial"], { cwd: workspace });
    await writeFile(join(workspace, "existing.txt"), "committed\nbefore run\n");

    const baseline = await beginTurnChanges(workspace);
    await writeFile(join(workspace, "existing.txt"), "committed\nbefore run\nduring run\n");
    await writeFile(join(workspace, "new.txt"), "new during run\n");
    const changes = await finishTurnChanges(baseline);

    assert.deepEqual(
      changes && { files: changes.files, additions: changes.additions, deletions: changes.deletions },
      { files: 2, additions: 2, deletions: 0 },
    );
    assert.doesNotMatch(changes?.patch ?? "", /^\+before run$/m);
    assert.match(changes?.patch ?? "", /^\+during run$/m);
    assert.match(changes?.patch ?? "", /^\+new during run$/m);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
