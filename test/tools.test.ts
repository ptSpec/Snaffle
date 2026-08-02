import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

async function fixture(): Promise<{ root: string; workspace: LocalWorkspace }> {
  const root = await mkdtemp(path.join(tmpdir(), "tool-test-"));
  return { root, workspace: new LocalWorkspace(root, true) };
}

test("the five explicit file and command tools work together", async (t) => {
  const { root, workspace } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeTool.execute(workspace, { path: "src/example.ts", content: "const value = 1;\n" });
  const read = await readTool.execute(workspace, { path: "src/example.ts" });
  assert.match(read.content, /const value = 1/);

  await editTool.execute(workspace, {
    path: "src/example.ts",
    oldText: "value = 1",
    newText: "value = 2",
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
  assert.equal(await readFile(path.join(root, "src/example.ts"), "utf8"), "const value = 2;\n");
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
  await writeFile(path.join(root, "duplicate.txt"), "same\nsame\n");

  await assert.rejects(
    editTool.execute(workspace, {
      path: "duplicate.txt",
      oldText: "same",
      newText: "different",
    }),
    /found 2/,
  );
});

test("workspace rejects paths outside its root", async (t) => {
  const { root, workspace } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(workspace.read("../secret"), /leaves the workspace/);
  await assert.rejects(workspace.write("/tmp/secret", "no"), /must be relative/);
});

test("commands require explicit host permission", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = new LocalWorkspace(root, false);

  await assert.rejects(workspace.run("true", undefined, 1000), /disabled/);
});
