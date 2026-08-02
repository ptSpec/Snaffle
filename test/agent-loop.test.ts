import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runAgent } from "../src/agent-loop.js";
import type { ModelProvider } from "../src/providers/provider.js";
import type { Message, ModelResponse, RunEvent, ToolSpec } from "../src/protocol.js";
import { defaultTools } from "../src/tools/default-tools.js";
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
    workspace: new LocalWorkspace(root, false),
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
  const workspace = new LocalWorkspace(root, false);
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
