import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { healToolCall, healToolInput } from "../src/tool-input.js";
import { editTool } from "../src/tools/edit.js";
import { readTool } from "../src/tools/read.js";
import { runTool } from "../src/tools/run.js";
import { searchTool } from "../src/tools/search.js";
import { writeTool } from "../src/tools/write.js";
import { LocalWorkspace } from "../src/workspace.js";
import { nativeSandboxStatus } from "../src/sandbox.js";

async function fixture(): Promise<{ root: string; workspace: LocalWorkspace }> {
  const root = await mkdtemp(path.join(tmpdir(), "tool-test-"));
  return { root, workspace: new LocalWorkspace(root, "unsafe") };
}

test("the five explicit file and command tools work together", async (t) => {
  const { root, workspace } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeTool.execute(workspace, {
    path: "src/example.ts",
    content: "const value = 1;\nconst ready = false;\n",
  });
  const read = await readTool.execute(workspace, { path: "src/example.ts" });
  assert.match(read.content, /const value = 1/);

  await editTool.execute(workspace, {
    path: "src/example.ts",
    edits: [
      { oldText: "value = 1", newText: "value = 2" },
      { oldText: "ready = false", newText: "ready = true" },
    ],
  });

  const matches = await searchTool.execute(workspace, { query: "value = 2" });
  assert.match(matches.content, /src\/example\.ts:1/);

  const healedCommand = healToolCall(
    {
      id: "call-1",
      name: "run_command",
      input: { command: "node -e \"process.stdout.write('ok')\"", cwd: "" },
    },
    runTool.inputSchema,
  );
  assert.deepEqual(healedCommand.input, { command: "node -e \"process.stdout.write('ok')\"" });
  assert.equal(healedCommand.inputRepair, '"cwd" was empty; omitted it because it is optional');
  const command = await runTool.execute(workspace, healedCommand.input);
  assert.match(command.content, /exit code: 0/);
  assert.match(command.content, /ok/);
  assert.equal(command.exitCode, 0);
  assert.equal(
    await readFile(path.join(root, "src/example.ts"), "utf8"),
    "const value = 2;\nconst ready = true;\n",
  );
});

test("run command reports a nonzero exit separately from tool failure", async (t) => {
  const { root, workspace } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await runTool.execute(workspace, { command: "exit 7" });

  assert.equal(result.exitCode, 7);
  assert.match(result.content, /exit code: 7/);
});

test("tool input healer repairs a quoted object with a malformed integer", () => {
  const malformed =
    '{"path": "build/spreadsheet/spreadsheet.py", "startLine": .290, "lineCount": 15}';
  const providerInput = healToolInput(JSON.stringify(malformed));
  const healed = healToolCall(
    {
      id: "call-1",
      name: "read_file",
      input: providerInput.input,
      ...(providerInput.repair ? { inputRepair: providerInput.repair } : {}),
    },
    readTool.inputSchema,
  );

  assert.deepEqual(healed.input, {
    path: "build/spreadsheet/spreadsheet.py",
    startLine: 290,
    lineCount: 15,
  });
  assert.equal(
    healed.inputRepair,
    'Arguments were sent as a quoted JSON string; converted them to a JSON object; "startLine" was .290; changed it to 290 because it requires an integer',
  );
});

test("edit rejects ambiguous text", async (t) => {
  const { root, workspace } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "duplicate.txt"), "first\nsame\nsame\n");

  await assert.rejects(
    editTool.execute(workspace, {
      path: "duplicate.txt",
      edits: [
        { oldText: "first", newText: "changed" },
        { oldText: "same", newText: "different" },
      ],
    }),
    /Edit 2.*found 2.*one edit/,
  );
  assert.equal(await readFile(path.join(root, "duplicate.txt"), "utf8"), "first\nsame\nsame\n");
});

test("workspace rejects paths outside its root", async (t) => {
  const { root, workspace } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(workspace.read("../secret"), /leaves the workspace/);
  await assert.rejects(workspace.write("/tmp/secret", "no"), /must be relative/);
  await mkdir(path.join(root, ".git"));
  await assert.rejects(workspace.write(".git/config", "no"), /managed by Esch/);
});

test("workspace rejects symlinks that leave its root", async (t) => {
  const { root, workspace } = await fixture();
  const outside = await mkdtemp(path.join(tmpdir(), "tool-outside-test-"));
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true }),
  ]));
  await writeFile(path.join(outside, "secret.txt"), "secret");
  await symlink(outside, path.join(root, "escape"));

  await assert.rejects(workspace.read("escape/secret.txt"), /leaves the workspace/);
  await assert.rejects(workspace.write("escape/new.txt", "no"), /leaves the workspace/);
});

test("restricted commands stay inside the workspace", async (t) => {
  if (!nativeSandboxStatus().available) return t.skip(nativeSandboxStatus().detail);

  const root = await mkdtemp(path.join(tmpdir(), "sandbox-workspace-test-"));
  const outside = await mkdtemp(path.join(tmpdir(), "sandbox-outside-test-"));
  const previousApiKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "must-not-enter-the-sandbox";
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true }),
  ]).finally(() => {
    if (previousApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousApiKey;
  }));
  await mkdir(path.join(root, ".git"));
  await mkdir(path.join(root, "nested/.git"), { recursive: true });
  const secret = path.join(outside, "secret.txt");
  await writeFile(secret, "secret");
  const workspace = new LocalWorkspace(root, "restricted");

  const inside = await workspace.run("printf ok > generated.txt", undefined, 5000);
  const outsideRead = await workspace.run(`cat ${JSON.stringify(secret)}`, undefined, 5000);
  const gitWrite = await workspace.run("touch .git/forbidden", undefined, 5000);
  const nestedGitWrite = await workspace.run("touch nested/.git/forbidden", undefined, 5000);
  const inheritedSecret = await workspace.run("test -z \"$OPENROUTER_API_KEY\"", undefined, 5000);

  assert.equal(inside.exitCode, 0);
  assert.equal(await readFile(path.join(root, "generated.txt"), "utf8"), "ok");
  assert.notEqual(outsideRead.exitCode, 0);
  assert.notEqual(gitWrite.exitCode, 0);
  assert.notEqual(nestedGitWrite.exitCode, 0);
  assert.equal(inheritedSecret.exitCode, 0);
});

test("restricted commands can be approved once or for the thread", async (t) => {
  if (!nativeSandboxStatus().available) return t.skip(nativeSandboxStatus().detail);

  const root = await mkdtemp(path.join(tmpdir(), "sandbox-approval-test-"));
  await mkdir(path.join(root, ".git"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const decisions = ["once", "thread"] as const;
  let approvals = 0;
  const workspace = new LocalWorkspace(root, "restricted", async () => decisions[approvals++] ?? "deny");

  const once = await workspace.run("printf once > .git/once", undefined, 5000);
  const thread = await workspace.run("printf thread > .git/thread", undefined, 5000);
  const after = await workspace.run("printf after > .git/after", undefined, 5000);

  assert.equal(once.approval, "once");
  assert.equal(thread.approval, "thread");
  assert.equal(after.exitCode, 0);
  assert.equal(approvals, 2);
  assert.equal(await readFile(path.join(root, ".git/after"), "utf8"), "after");
});

test("commands require explicit host permission", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = new LocalWorkspace(root, "disabled");

  await assert.rejects(workspace.run("true", undefined, 1000), /disabled/);
});
