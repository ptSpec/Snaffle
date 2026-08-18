import assert from "node:assert/strict";
import test from "node:test";
import { applySubagentUpdate } from "../src/agent/subagents/activity.js";
import { ProviderCapacity } from "../src/agent/subagents/capacity.js";
import { checkCommandTool } from "../src/agent/subagents/check-tool.js";
import { subagentProfile, threadSubagent } from "../src/agent/subagents/profile.js";
import { runSubagents } from "../src/agent/subagents/runner.js";
import type { Workspace } from "../src/execution/workspace.js";
import type { Message } from "../src/protocol.js";

test("thread subagent mode can inherit or override the app default", () => {
  const profile = subagentProfile({
    enabled: false,
    modelMode: "main",
    maxSteps: 30,
  });

  assert.equal(threadSubagent(profile, "inherit"), null);
  assert.equal(threadSubagent(profile, "disabled"), null);
  assert.equal(threadSubagent(profile, "enabled")?.modelMode, "main");

  const legacyFixed = subagentProfile({
    enabled: true,
    providerConnectionId: "local",
    model: "small-model",
  });
  assert.equal(legacyFixed.modelMode, "fixed");
});

test("subagent activity keeps interleaved child updates separate", () => {
  let activity = applySubagentUpdate(undefined, {
    type: "batch.started",
    profile: "explore",
    runs: [
      { id: "child-a", task: "Inspect providers" },
      { id: "child-b", task: "Inspect settings" },
    ],
  });
  activity = applySubagentUpdate(activity, {
    type: "reasoning.delta",
    runId: "child-b",
    step: 1,
    text: "Found settings.",
  });
  activity = applySubagentUpdate(activity, {
    type: "reasoning.delta",
    runId: "child-a",
    step: 1,
    text: "Found providers.",
  });

  assert.equal(activity?.runs[0]?.steps[0]?.reasoning, "Found providers.");
  assert.equal(activity?.runs[1]?.steps[0]?.reasoning, "Found settings.");
  assert.equal(activity?.profile, "explore");
});

test("read-only subagents allow verification commands but reject shell composition", async () => {
  const commands: string[] = [];
  const workspace = {
    environment: "test",
    async read() { return ""; },
    async write() {},
    async search() { return []; },
    async run(command: string) {
      commands.push(command);
      return { exitCode: 0, stdout: "ok", stderr: "" };
    },
  } satisfies Workspace;

  await checkCommandTool("review").execute(workspace, { command: "git diff --stat" });
  await checkCommandTool("test").execute(workspace, { command: "npm test" });
  await assert.rejects(
    checkCommandTool("test").execute(workspace, { command: "npm test && rm output" }),
    /shell chaining/,
  );
  assert.deepEqual(commands, ["git diff --stat", "npm test"]);
});

test("provider capacity queues work after the configured limit", async () => {
  const capacity = new ProviderCapacity();
  const controller = new AbortController();
  const first = capacity.tryAcquire("local", 1);
  assert.ok(first);
  let acquired = false;
  const waiting = capacity.acquire("local", 1, controller.signal).then((release) => {
    acquired = true;
    release();
  });
  await Promise.resolve();
  assert.equal(acquired, false);
  first();
  await waiting;
  assert.equal(acquired, true);
});

test("provider capacity gives foreground work the next available slot", async () => {
  const capacity = new ProviderCapacity();
  const signal = new AbortController().signal;
  const first = capacity.tryAcquire("local", 1);
  assert.ok(first);
  const order: string[] = [];
  const background = capacity.acquire("local", 1, signal).then((release) => {
    order.push("background");
    release();
  });
  const foreground = capacity.acquire("local", 1, signal, true).then((release) => {
    order.push("foreground");
    release();
  });

  first();
  await Promise.all([background, foreground]);
  assert.deepEqual(order, ["foreground", "background"]);
});

test("a reserved provider route releases capacity between model calls", async () => {
  const capacity = new ProviderCapacity();
  const initial = capacity.tryAcquire("local", 1);
  assert.ok(initial);
  let finish!: () => void;
  const route = capacity.reserve({
    model: "local-model",
    providerId: "local",
    connectionId: "local",
    async complete() {
      await new Promise<void>((resolve) => (finish = resolve));
      return { text: "done", toolCalls: [] };
    },
  }, 1, initial);

  const request = route.provider.complete([], [], new AbortController().signal);
  await Promise.resolve();
  assert.equal(capacity.tryAcquire("local", 1), null);
  finish();
  await request;

  const next = capacity.tryAcquire("local", 1);
  assert.ok(next);
  next();
});

test("subagents receive their profile and reporting instructions", async () => {
  let messages: Message[] = [];
  const workspace = {
    environment: "test",
    async read() { return ""; },
    async write() {},
    async search() { return []; },
    async run() { return { exitCode: 0, stdout: "", stderr: "" }; },
  } satisfies Workspace;

  await runSubagents({
    profile: "review",
    tasks: ["Review the current change."],
    workspace,
    signal: new AbortController().signal,
    maxSteps: 2,
    async provider() {
      return {
        connectionName: "Test",
        release() {},
        provider: {
          model: "test-model",
          providerId: "test",
          connectionId: "test",
          async complete(requestMessages) {
            messages = requestMessages;
            return { text: "Review complete.", toolCalls: [] };
          },
        },
      };
    },
  });

  const prompt = messages.find((message) => message.role === "system")?.content ?? "";
  assert.match(prompt, /focused read-only review agent/);
  assert.match(prompt, /Return your final result using exactly this concise Markdown structure/);
});
