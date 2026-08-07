import assert from "node:assert/strict";
import test from "node:test";
import {
  compactionPreparationThreshold,
  compactionThreshold,
  estimateContextCharacters,
  estimateContextTokens,
} from "../src/context/budget.js";
import { compactionBoundary } from "../src/context/compaction.js";
import { projectContext, type ContextCheckpoint } from "../src/context/projection.js";
import { serializeForSummary, summaryMessages, SUMMARY_SYSTEM_PROMPT } from "../src/context/summary.js";
import { buildContextReport } from "../src/context/report.js";
import type { Message, ToolSpec } from "../src/protocol.js";

const checkpoint: ContextCheckpoint = {
  id: "checkpoint-1",
  threadId: "thread-1",
  throughSequence: 2,
  createdAfterSequence: 4,
  summary: "The user asked for a counter. Stage one is complete.",
  sourceCharacters: 500,
  summaryCharacters: 53,
  model: "test-model",
  createdAt: 1,
  appliedAt: null,
  injectedCharacters: null,
  appliedThroughSequence: null,
};

test("context projection uses the checkpoint tail and omits completed reasoning", () => {
  const entries = [
    { sequence: 0, message: { role: "system" as const, content: "system" } },
    { sequence: 3, message: { role: "user" as const, content: "continue" } },
    {
      sequence: 4,
      message: {
        role: "assistant" as const,
        content: "done",
        reasoning: "private scratch work",
        toolCalls: [{ id: "call-1", name: "read_file", input: { path: "counter.py" } }],
      },
    },
    { sequence: 5, message: { role: "tool" as const, toolCallId: "call-1", content: "file" } },
  ];
  const tools: ToolSpec[] = [{ name: "read_file", description: "Read", inputSchema: { type: "object" } }];
  const projection = projectContext(entries, checkpoint, tools);

  assert.equal(projection.messages[0]?.role, "system");
  assert.match(projection.messages[1]?.content ?? "", /Stage one is complete/);
  assert.deepEqual(projection.messages.slice(2).map((message) => message.role), ["user", "assistant", "tool"]);
  assert.equal(projection.messages[3]?.role === "assistant" && projection.messages[3].reasoning, undefined);
  assert.equal(projection.messages[3]?.role === "assistant" && projection.messages[3].toolCalls?.[0]?.name, "read_file");
  assert.ok(projection.estimatedCharacters > 0);
  assert.equal(projection.estimatedTokens, estimateContextTokens(projection.estimatedCharacters));
});

test("summary serialization excludes reasoning but retains tool continuity", () => {
  const messages: Message[] = [
    { role: "assistant", content: "Checking.", reasoning: "hidden reasoning", toolCalls: [{ id: "1", name: "run_command", input: { command: "pwd" } }] },
    { role: "tool", toolCallId: "1", content: "/workspace" },
  ];
  const serialized = serializeForSummary(messages);

  assert.doesNotMatch(serialized, /hidden reasoning/);
  assert.match(serialized, /run_command/);
  assert.match(serialized, /\/workspace/);
});

test("compaction prompt supports general conversations and preserves user preferences", () => {
  assert.doesNotMatch(SUMMARY_SYSTEM_PROMPT, /coding conversation/i);
  assert.match(SUMMARY_SYSTEM_PROMPT, /User preferences/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /durable preferences/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /Key files/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /short change summary/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /without any previous information/);
  assert.match(summaryMessages([], undefined, true)[0]?.content ?? "", /small context window/);
});

test("automatic compaction thresholds scale with model context size", () => {
  assert.equal(compactionThreshold(128_000, "automatic", 65), 80);
  assert.equal(compactionThreshold(256_000, "automatic", 65), 65);
  assert.equal(compactionThreshold(1_000_000, "automatic", 65), 55);
  assert.equal(compactionThreshold(1_000_000, "custom", 72), 72);
  assert.equal(compactionPreparationThreshold(256_000, "automatic", 65), 58);
  assert.equal(compactionPreparationThreshold(32_000, "automatic", 65), 73);
  assert.ok(estimateContextCharacters([{ role: "user", content: "hello" }]) >= 9);
});

test("compaction keeps the latest complete turn in the raw tail", () => {
  assert.equal(compactionBoundary([
    { sequence: 0, message: { role: "system", content: "system" } },
    { sequence: 1, message: { role: "user", content: "first" } },
    { sequence: 2, message: { role: "assistant", content: "first answer" } },
    { sequence: 3, message: { role: "user", content: "latest" } },
    { sequence: 4, message: { role: "assistant", content: "latest answer" } },
  ]), 2);
});

test("context report exposes usage and the resolved compaction point", () => {
  const report = buildContextReport({
    entries: [{ sequence: 0, message: { role: "user", content: "hello" } }],
    checkpoint: null,
    tools: [],
    contextLength: 256_000,
    mode: "automatic",
    threshold: 80,
    preparing: false,
  });

  assert.ok(report.estimatedTokens > 0);
  assert.equal(report.compactAtTokens, 166_400);
  assert.equal(report.prepareAtTokens, 148_480);
  assert.equal(report.checkpointPrepared, false);
  assert.equal(report.canCompact, false);
});
