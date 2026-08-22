import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runAgent } from "../src/agent/loop.js";
import { activeCapabilities, builtInCapabilities } from "../src/capabilities/active.js";
import { activeToolNamesForSurface } from "../src/capabilities/surface.js";
import type { ModelProvider } from "../src/providers/provider.js";
import type { Message, ModelResponse, RunEvent, ToolSpec } from "../src/protocol.js";
import { defaultTools } from "../src/tools/built-ins.js";
import { editTool } from "../src/tools/edit.js";
import { updatePlanTool, type PlanItem } from "../src/tools/plan.js";
import { ToolInputError, toolErrorContent, type Tool } from "../src/tools/tool.js";
import { writeTool } from "../src/tools/write.js";
import type { Trace } from "../src/agent/trace.js";
import { LocalWorkspace } from "../src/execution/workspace.js";

class ScriptedProvider implements ModelProvider {
  readonly model = "scripted-test-model";
  readonly providerId = "test";
  readonly connectionId = "test";
  private call = 0;

  async complete(
    messages: Message[],
    tools: ToolSpec[],
    _signal: AbortSignal,
  ): Promise<ModelResponse> {
    assert.equal(tools.length, 5);
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
  readonly providerId = "test";
  readonly connectionId = "test";
  messages: Message[] = [];

  constructor(private readonly reply: string) {}

  async complete(messages: Message[]): Promise<ModelResponse> {
    this.messages = [...messages];
    return { text: this.reply, toolCalls: [] };
  }
}

test("active capabilities reject duplicate tool names", () => {
  assert.throws(
    () => activeCapabilities([
      { source: { type: "built-in" }, tool: writeTool },
      { source: { type: "plugin", pluginId: "example" }, tool: writeTool },
    ]),
    /Active tool name must be unique: write_file/,
  );
});

test("custom model surfaces allow selected tools beyond the recommendation", () => {
  const available = [
    "run_command", "read_file", "search_files", "edit_file", "write_file",
    "update_plan", "web_search", "web_fetch", "use_skill", "mcp",
  ];
  const custom = activeToolNamesForSurface(
    available,
    { mode: "custom", optionalTools: ["web_search", "web_fetch", "mcp"] },
    ["use_skill"],
  );
  assert.deepEqual(custom, available);
  assert.deepEqual(
    activeToolNamesForSurface(available, { mode: "expanded", optionalTools: [] }),
    available,
  );
});

test("agent loop executes a tool and completes naturally", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const trace = new MemoryTrace();
  const persisted: Array<{ sequence: number; role: Message["role"] }> = [];

  const result = await runAgent({
    task: "Create answer.txt",
    provider: new ScriptedProvider(),
    capabilities: builtInCapabilities(defaultTools()),
    workspace: new LocalWorkspace(root, "disabled"),
    trace,
    signal: new AbortController().signal,
    sequenceStart: 10,
    onMessage: (message, sequence) => {
      persisted.push({ sequence, role: message.role });
    },
  });

  assert.equal(result.text, "Created answer.txt.");
  assert.equal(result.steps, 2);
  assert.equal(await readFile(path.join(root, "answer.txt"), "utf8"), "done\n");
  assert.deepEqual(persisted, [
    { sequence: 10, role: "assistant" },
    { sequence: 11, role: "tool" },
    { sequence: 12, role: "assistant" },
  ]);
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
    capabilities: builtInCapabilities(defaultTools()),
    workspace,
    trace: new MemoryTrace(),
    signal,
  });
  const provider = new DirectProvider("A longer paragraph.");

  await runAgent({
    task: "Make it longer.",
    history: first.messages,
    provider,
    capabilities: builtInCapabilities(defaultTools()),
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

test("agent loop rejects a response stopped by its output limit", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-output-limit-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const trace = new MemoryTrace();

  await assert.rejects(runAgent({
    task: "Write a large file.",
    provider: {
      model: "limited-test-model",
      providerId: "test",
      connectionId: "test",
      async complete() {
        return { text: "Partial output", toolCalls: [], finishReason: "length" };
      },
    },
    capabilities: builtInCapabilities(defaultTools()),
    workspace: new LocalWorkspace(root, "disabled"),
    trace,
    signal: new AbortController().signal,
  }), /stopped before completion \(length\)/);
  assert.equal(trace.events.at(-1)?.type, "run.failed");
});

test("agent loop applies steering after the current model output", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-steering-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const replies = ["Initial answer.", "Revised answer."];
  const seen: Message[][] = [];
  const provider: ModelProvider = {
    model: "steering-test-model",
    providerId: "test",
    connectionId: "test",
    async complete(messages) {
      seen.push([...messages]);
      return { text: replies.shift() ?? "", toolCalls: [] };
    },
  };
  let steering = ["Change direction."];

  const result = await runAgent({
    task: "Start work.",
    provider,
    capabilities: builtInCapabilities(defaultTools()),
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

test("a stopped run does not execute a pending tool call", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-cancel-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const controller = new AbortController();
  let executed = false;
  const tool: Tool = {
    name: "pending_tool",
    description: "Test tool",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      executed = true;
      return { content: "unexpected" };
    },
  };
  const provider: ModelProvider = {
    model: "cancel-test-model",
    providerId: "test",
    connectionId: "test",
    async complete() {
      controller.abort();
      return { text: "", toolCalls: [{ id: "pending", name: tool.name, input: {} }] };
    },
  };

  await assert.rejects(runAgent({
    task: "Stop before the tool runs.",
    provider,
    capabilities: builtInCapabilities([tool]),
    workspace: new LocalWorkspace(root, "disabled"),
    trace: new MemoryTrace(),
    signal: controller.signal,
  }), /aborted/i);
  assert.equal(executed, false);
});

test("an active plan keeps the agent running until actionable work is resolved", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-plan-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const seen: Message[][] = [];
  const persistedPlans: Array<PlanItem[] | null> = [];
  let call = 0;
  const provider: ModelProvider = {
    model: "plan-test-model",
    providerId: "test",
    connectionId: "test",
    async complete(messages) {
      seen.push([...messages]);
      call += 1;
      if (call === 1) {
        return {
          text: "",
          toolCalls: [{
            id: "plan-1",
            name: "update_plan",
            input: { items: [
              { step: "Implement", status: "in_progress" },
              { step: "Verify", status: "pending" },
            ] },
          }],
        };
      }
      if (call === 2) return { text: "Finished too early.", toolCalls: [] };
      if (call === 3) {
        const notice = messages.at(-1);
        assert.ok(notice?.role === "user");
        assert.equal(notice.internal, true);
        return {
          text: "",
          toolCalls: [{
            id: "plan-2",
            name: "update_plan",
            input: { items: [
              { step: "Implement", status: "completed" },
              { step: "Verify", status: "blocked" },
            ] },
          }],
        };
      }
      return { text: "Implemented; verification is blocked.", toolCalls: [] };
    },
  };

  const result = await runAgent({
    task: "Complete a multi-step task.",
    provider,
    capabilities: builtInCapabilities([updatePlanTool()]),
    workspace: new LocalWorkspace(root, "disabled"),
    trace: new MemoryTrace(),
    signal: new AbortController().signal,
    onPlan: (items) => {
      persistedPlans.push(items);
    },
  });

  assert.equal(result.steps, 4);
  assert.equal(result.text, "Implemented; verification is blocked.");
  assert.equal(seen.length, 4);
  assert.equal(result.messages.filter((message) => message.role === "user" && message.internal).length, 1);
  assert.equal(persistedPlans.length, 2);
  assert.equal(persistedPlans.at(-1), null);
});

test("plan guidance still respects the agent step limit", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-plan-limit-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const provider: ModelProvider = {
    model: "plan-limit-test-model",
    providerId: "test",
    connectionId: "test",
    async complete() {
      return { text: "Stopping early.", toolCalls: [] };
    },
  };

  await assert.rejects(runAgent({
    task: "Keep working.",
    provider,
    capabilities: builtInCapabilities([updatePlanTool()]),
    workspace: new LocalWorkspace(root, "disabled"),
    trace: new MemoryTrace(),
    signal: new AbortController().signal,
    initialPlan: [{ step: "Keep working", status: "in_progress" }],
    maxSteps: 1,
  }), /exceeded the 1-step limit/);
});

test("tool examples are shown after failure, not sent in every tool description", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-tool-example-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.ok(defaultTools().every((tool) => tool.exampleInput));
  let call = 0;
  const provider: ModelProvider = {
    model: "tool-example-test-model",
    providerId: "test",
    connectionId: "test",
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
      assert.equal(failure?.role, "user");
      assert.match(failure?.content ?? "", /tool input correction notice/);
      assert.match(failure?.content ?? "", /Here is a valid example input for the write_file tool/);
      assert.match(failure?.content ?? "", /"path": "src\/config.ts"/);
      return { text: "Corrected the tool input.", toolCalls: [] };
    },
  };

  const result = await runAgent({
    task: "Write a file.",
    provider,
    capabilities: builtInCapabilities(defaultTools()),
    workspace: new LocalWorkspace(root, "disabled"),
    trace: new MemoryTrace(),
    signal: new AbortController().signal,
  });

  assert.equal(result.text, "Corrected the tool input.");
  assert.equal(call, 2);
  assert.equal(toolErrorContent(writeTool, new Error("Disk is full")), "Error: Disk is full");
  assert.match(
    toolErrorContent(editTool, new ToolInputError("edits must be a non-empty array")),
    /Prefer correcting and retrying edit_file/,
  );
});

test("web tools follow web search availability", () => {
  const withoutWeb = defaultTools();
  const withWeb = defaultTools({
    webSearchEnabled: true,
    backend: "ddg",
    ketchPath: "/test/ketch",
  });
  const richSearch = defaultTools({
    webSearchEnabled: true,
    backend: "openrouter",
    openRouterApiKey: "test",
  });
  const disabledSearch = defaultTools({ webSearchEnabled: false, openRouterApiKey: "test" });

  assert.equal(withoutWeb.some((tool) => tool.name === "web_fetch"), false);
  assert.doesNotMatch(withWeb.find((tool) => tool.name === "web_fetch")?.description ?? "", /Web discovery is unavailable/);
  assert.equal(richSearch.some((tool) => tool.name === "web_fetch"), true);
  assert.equal(disabledSearch.some((tool) => tool.name === "web_search"), false);
  assert.equal(disabledSearch.some((tool) => tool.name === "web_fetch"), false);
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
    providerId: "test",
    connectionId: "test",
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
    capabilities: builtInCapabilities([sourceTool]),
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
