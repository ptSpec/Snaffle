import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { healToolCall, healToolInput } from "../src/tool-input.js";
import { editTool } from "../src/tools/edit.js";
import { readTool } from "../src/tools/read.js";
import { runTool } from "../src/tools/run.js";
import { searchTool } from "../src/tools/search.js";
import { webSearchTool } from "../src/tools/web/search.js";
import { extractWithKetch, searchWithKetch } from "../src/tools/web/ketch.js";
import { fetchPublicText } from "../src/tools/web/request.js";
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

  const written = await writeTool.execute(workspace, {
    path: "src/example.ts",
    content: "const value = 1;\nconst ready = false;\nconst label = 'old';\n",
  });
  assert.equal(written.content, "Successfully wrote 59 bytes to src/example.ts");
  const read = await readTool.execute(workspace, { path: "src/example.ts" });
  assert.equal(read.content, "const value = 1;\nconst ready = false;\nconst label = 'old';\n");

  const edited = await editTool.execute(workspace, {
    path: "src/example.ts",
    edits: [
      { oldText: "const value = 1;", newText: "const value = 2;" },
      { oldText: "const ready = false;", newText: "const ready = true;" },
    ],
  });
  assert.equal(edited.content, "Successfully replaced 2 block(s) in src/example.ts.");
  const finalEdit = await editTool.execute(workspace, {
    path: "src/example.ts",
    edits: [{ oldText: "const label = 'old';", newText: "const label = 'new';\nexport {};" }],
  });
  assert.equal(finalEdit.content, "Successfully replaced 1 block(s) in src/example.ts.");

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
    "const value = 2;\nconst ready = true;\nconst label = 'new';\nexport {};\n",
  );
});

test("run command reports a nonzero exit separately from tool failure", async (t) => {
  const { root, workspace } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await runTool.execute(workspace, { command: "exit 7" });

  assert.equal(result.exitCode, 7);
  assert.match(result.content, /exit code: 7/);
});

test("OpenRouter web search has one bounded server-side search", async (t) => {
  const { root, workspace } = await fixture();
  const originalFetch = globalThis.fetch;
  let request: Record<string, unknown> | undefined;
  t.after(() => {
    globalThis.fetch = originalFetch;
    return rm(root, { recursive: true, force: true });
  });
  globalThis.fetch = async (_input, init) => {
    request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      choices: [{ message: { content: "Grounded answer", annotations: [] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const tool = webSearchTool({
    webSearchEnabled: true,
    backend: "openrouter",
    openRouterApiKey: "test-key",
  });
  assert.ok(tool);
  await tool.execute(workspace, { query: "current Node.js release", maxResults: 3 });

  assert.equal(request?.tool_choice, "required");
  assert.equal(request?.max_tool_calls, 1);
  assert.equal(request?.max_tokens, 1_000);
  assert.deepEqual(request?.tools, [{
    type: "openrouter:web_search",
    parameters: {
      engine: "exa",
      max_results: 3,
      max_total_results: 3,
      max_uses: 1,
      max_characters: 3_000,
    },
  }]);
});

test("Ketch search and extraction use its structured CLI output", {
  skip: process.platform === "win32",
}, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "ketch-test-"));
  const executable = path.join(root, "ketch");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(executable, `#!/bin/sh
if [ "$1" = "search" ]; then
  printf '[{"title":"Example","url":"https://example.com","description":"short","content":"%s:%s"}]' "$4" "$KETCH_TAVILY_API_KEY"
else
  cat >/dev/null
  printf '{"url":"https://example.com","title":"Example page","markdown":"# Extracted","words":1}'
fi
`);
  await chmod(executable, 0o755);

  assert.deepEqual(await searchWithKetch(executable, "tavily", "secret", "example query", 3), [{
    title: "Example",
    url: "https://example.com",
    content: "tavily:secret",
  }]);
  assert.deepEqual(await extractWithKetch(executable, "<h1>Ignored</h1>", "https://example.com", 4_000), {
    title: "Example page",
    content: "# Extracted",
  });
});

test("Fandom Cloudflare challenges fall back to its public wiki API", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/api.php?")) {
      return new Response(JSON.stringify({
        parse: { title: "Example page", text: { "*": "<p>Readable wiki content</p>" } },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("challenge", {
      status: 403,
      headers: { "cf-mitigated": "challenge", "Content-Type": "text/html" },
    });
  };

  const page = await fetchPublicText("https://example.fandom.com/wiki/Some_page");

  assert.equal(page.url, "https://example.fandom.com/wiki/Some_page");
  assert.match(page.contentType, /text\/html/);
  assert.match(page.text, /Readable wiki content/);
  assert.equal(requests.length, 2);
  assert.match(requests[1]!, /\/api\.php\?.*page=Some_page/);
});

test("tool input healer repairs a quoted object with a malformed integer", () => {
  const malformed =
    '{"path": "build/spreadsheet/spreadsheet.py", "offset": .290, "limit": 15}';
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
    offset: 290,
    limit: 15,
  });
  assert.equal(
    healed.inputRepair,
    'Arguments were sent as a quoted JSON string; converted them to a JSON object; "offset" was .290; changed it to 290 because it requires an integer',
  );
});

test("tool input healer accepts one edit without an array", () => {
  const healed = healToolCall(
    {
      id: "call-1",
      name: "edit_file",
      input: {
        path: "src/app.ts",
        edits: { oldText: "const port = 3000;", newText: "const port = 4000;" },
      },
    },
    editTool.inputSchema,
  );

  assert.deepEqual(healed.input, {
    path: "src/app.ts",
    edits: [{ oldText: "const port = 3000;", newText: "const port = 4000;" }],
  });
  assert.equal(healed.inputRepair, '"edits" was one object; wrapped it in an array');
});

test("tool input healer parses stringified array properties", () => {
  const healed = healToolCall(
    {
      id: "call-1",
      name: "edit_file",
      input: {
        path: "src/app.ts",
        edits: JSON.stringify([
          { oldText: "const port = 3000;", newText: "const port = 4000;" },
        ]),
      },
    },
    editTool.inputSchema,
  );

  assert.deepEqual(healed.input, {
    path: "src/app.ts",
    edits: [{ oldText: "const port = 3000;", newText: "const port = 4000;" }],
  });
  assert.equal(healed.inputRepair, '"edits" was array JSON sent as a string; parsed it');
});

test("edit rejects ambiguous and overlapping exact matches", async (t) => {
  const { root, workspace } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = "first\nsecond\nthird\n";
  await writeFile(path.join(root, "example.txt"), original);

  await assert.rejects(
    editTool.execute(workspace, {
      path: "example.txt",
      edits: [
        { oldText: "first\nsecond", newText: "changed" },
        { oldText: "second\nthird", newText: "overlap" },
      ],
    }),
    /must not overlap/,
  );

  await writeFile(path.join(root, "example.txt"), "repeat\nrepeat\n");
  await assert.rejects(
    editTool.execute(workspace, {
      path: "example.txt",
      edits: [{ oldText: "repeat", newText: "changed" }],
    }),
    /matched more than once/,
  );
});

test("exact edit accepts LF input and preserves CRLF files", async (t) => {
  const { root, workspace } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = "first\r\nsecond\r\n";
  await writeFile(path.join(root, "example.txt"), original);

  await editTool.execute(workspace, {
    path: "example.txt",
    edits: [{ oldText: "first\nsecond", newText: "one\ntwo" }],
  });

  assert.equal(await readFile(path.join(root, "example.txt"), "utf8"), "one\r\ntwo\r\n");
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
  const listing = await workspace.run("ls -la", undefined, 5000);
  const nestedDirectory = await workspace.run("cd nested && pwd", undefined, 5000);
  const outsideRead = await workspace.run(`cat ${JSON.stringify(secret)}`, undefined, 5000);
  const gitWrite = await workspace.run("touch .git/forbidden", undefined, 5000);
  const nestedGitWrite = await workspace.run("touch nested/.git/forbidden", undefined, 5000);
  const inheritedSecret = await workspace.run("test -z \"$OPENROUTER_API_KEY\"", undefined, 5000);

  assert.equal(inside.exitCode, 0);
  assert.equal(listing.exitCode, 0);
  assert.equal(nestedDirectory.exitCode, 0);
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
