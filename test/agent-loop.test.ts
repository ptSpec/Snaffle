import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runAgent } from "../src/agent-loop.js";
import type { ModelProvider } from "../src/providers/provider.js";
import type { Message, ModelResponse, RunEvent, ToolSpec } from "../src/protocol.js";
import { defaultTools } from "../src/tools/default-tools.js";
import { toolErrorContent, type Tool } from "../src/tools/tool.js";
import { writeTool } from "../src/tools/write.js";
import type { Trace } from "../src/trace.js";
import { LocalWorkspace } from "../src/workspace.js";

class ScriptedProvider implements ModelProvider {
  readonly model = "scripted-test-model";
  private call = 0;

  async complete(
    messages: Message[],
    tools: ToolSpec[],
    _signal: AbortSignal,
  ): Promise<ModelResponse> {
    assert.equal(tools.length, 7);
    this.call += 1;

    if (this.call === 1) {
      return {
        text: "",
        toolCalls: [
          {
            id: "call-1",
            name: "write_file",
            input: { path: "answer.txt", content: "done\n" },
          },
        ],
      };
    }

    assert.equal(messages.at(-1)?.role, "tool");
    return { text: "Created answer.txt.", toolCalls: [] };
  }
}

class MemoryTrace implements Trace {
  readonly events: RunEvent[] = [];

  async write(event: RunEvent): Promise<void> {
    this.events.push(event);
  }
}

class DirectProvider implements ModelProvider {
  readonly model = "direct-test-model";
  messages: Message[] = [];

  constructor(private readonly reply: string) {}

  async complete(messages: Message[]): Promise<ModelResponse> {
    this.messages = [...messages];
    return { text: this.reply, toolCalls: [] };
  }
}

test("agent loop executes a tool and completes naturally", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const trace = new MemoryTrace();

  const result = await runAgent({
    task: "Create answer.txt",
    provider: new ScriptedProvider(),
    tools: defaultTools(),
    workspace: new LocalWorkspace(root, "disabled"),
    trace,
    signal: new AbortController().signal,
  });

  assert.equal(result.text, "Created answer.txt.");
  assert.equal(result.steps, 2);
  assert.equal(await readFile(path.join(root, "answer.txt"), "utf8"), "done\n");
  assert.deepEqual(
    trace.events.map((event) => event.type),
    [
      "run.started",
      "model.started",
      "model.completed",
      "tool.started",
      "tool.completed",
      "model.started",
      "model.completed",
      "run.completed",
    ],
  );
});

test("agent loop carries conversation history into a follow-up", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-history-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = new LocalWorkspace(root, "disabled");
  const signal = new AbortController().signal;
  const first = await runAgent({
    task: "Write a short paragraph.",
    provider: new DirectProvider("A short paragraph."),
    tools: defaultTools(),
    workspace,
    trace: new MemoryTrace(),
    signal,
  });
  const provider = new DirectProvider("A longer paragraph.");

  await runAgent({
    task: "Make it longer.",
    history: first.messages,
    provider,
    tools: defaultTools(),
    workspace,
    trace: new MemoryTrace(),
    signal,
  });

  assert.deepEqual(provider.messages.slice(-3).map(({ role, content }) => ({ role, content })), [
    { role: "user", content: "Write a short paragraph." },
    { role: "assistant", content: "A short paragraph." },
    { role: "user", content: "Make it longer." },
  ]);
});

test("agent loop applies steering after the current model output", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-steering-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const replies = ["Initial answer.", "Revised answer."];
  const seen: Message[][] = [];
  const provider: ModelProvider = {
    model: "steering-test-model",
    async complete(messages) {
      seen.push([...messages]);
      return { text: replies.shift() ?? "", toolCalls: [] };
    },
  };
  let steering = ["Change direction."];

  const result = await runAgent({
    task: "Start work.",
    provider,
    tools: defaultTools(),
    workspace: new LocalWorkspace(root, "disabled"),
    trace: new MemoryTrace(),
    signal: new AbortController().signal,
    takeSteering: () => steering.splice(0),
  });

  assert.equal(result.text, "Revised answer.");
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[1]?.slice(-2).map(({ role, content }) => ({ role, content })), [
    { role: "assistant", content: "Initial answer." },
    { role: "user", content: "Change direction." },
  ]);
});

test("tool examples are shown after failure, not sent in every tool description", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-tool-example-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.ok(defaultTools().every((tool) => tool.exampleInput));
  let call = 0;
  const provider: ModelProvider = {
    model: "tool-example-test-model",
    async complete(messages, tools) {
      call += 1;
      if (call === 1) {
        assert.ok(tools.every((tool) => !tool.description.includes("Example:")));
        assert.ok(tools.every((tool) => !("exampleInput" in tool)));
        return {
          text: "",
          toolCalls: [{ id: "bad-write", name: "write_file", input: { content: "missing path" } }],
        };
      }

      const failure = messages.at(-1);
      assert.equal(failure?.role, "tool");
      assert.match(failure?.content ?? "", /Here is a valid example input for the write_file tool/);
      assert.match(failure?.content ?? "", /"path": "src\/config.ts"/);
      return { text: "Corrected the tool input.", toolCalls: [] };
    },
  };

  const result = await runAgent({
    task: "Write a file.",
    provider,
    tools: defaultTools(),
    workspace: new LocalWorkspace(root, "disabled"),
    trace: new MemoryTrace(),
    signal: new AbortController().signal,
  });

  assert.equal(result.text, "Corrected the tool input.");
  assert.equal(call, 2);
  assert.equal(toolErrorContent(writeTool, new Error("Disk is full")), "Error: Disk is full");
});

test("web fetch guidance follows web search availability", () => {
  const withoutSearch = defaultTools().find((tool) => tool.name === "web_fetch");
  const withSearch = defaultTools({ openRouterApiKey: "test" }).find((tool) => tool.name === "web_fetch");
  const disabledSearch = defaultTools({ webSearchEnabled: false, openRouterApiKey: "test" });

  assert.match(withoutSearch?.description ?? "", /Web discovery is unavailable/);
  assert.doesNotMatch(withSearch?.description ?? "", /Web discovery is unavailable/);
  assert.equal(disabledSearch.some((tool) => tool.name === "web_search"), false);
});

test("only explicitly cited tool sources reach the final answer", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-source-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceTool: Tool = {
    name: "lookup",
    description: "Return sources.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      return {
        content: "Sources A and B",
        sources: [
          { title: "A", url: "https://a.example/source" },
          { title: "B", url: "https://b.example/source" },
        ],
      };
    },
  };
  let call = 0;
  const provider: ModelProvider = {
    model: "source-test-model",
    async complete() {
      call += 1;
      return call === 1
        ? { text: "", toolCalls: [{ id: "lookup-1", name: "lookup", input: {} }] }
        : { text: "Supported by [A](https://a.example/source).", toolCalls: [] };
    },
  };

  const result = await runAgent({
    task: "Research this.",
    provider,
    tools: [sourceTool],
    workspace: new LocalWorkspace(root, "disabled"),
    trace: new MemoryTrace(),
    signal: new AbortController().signal,
  });
  const final = result.messages.at(-1);

  assert.equal(final?.role, "assistant");
  assert.deepEqual(final?.role === "assistant" ? final.sources : undefined, [
    { title: "A", url: "https://a.example/source" },
  ]);
});
