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
      "model.completed",
      "tool.started",
      "tool.completed",
      "model.completed",
      "run.completed",
    ],
  );
});
