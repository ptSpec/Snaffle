import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { saveGitFile } from "../src/git/actions.js";
import { gitFileContents, parseGitNumstat, parseGitStatus } from "../src/git/repository.js";

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
  const workspace = await mkdtemp(join(tmpdir(), "esch-git-"));
  try {
    await exec("git", ["init"], { cwd: workspace });
    await writeFile(join(workspace, "example.txt"), "one\ntwo\n");
    await exec("git", ["add", "example.txt"], { cwd: workspace });
    await exec("git", ["-c", "user.name=Esch Test", "-c", "user.email=test@example.com", "commit", "-m", "initial"], { cwd: workspace });
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
