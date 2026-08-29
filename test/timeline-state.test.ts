import assert from "node:assert/strict";
import test from "node:test";
import {
  addRunEvent,
  modelCallsForReasoning,
  type TimelineItem,
} from "../src/desktop/renderer/sections/conversation/timeline-state.js";

test("finishing a run closes orphaned running tools", () => {
  let timeline: TimelineItem[] = [];
  const apply = (update: (items: TimelineItem[]) => TimelineItem[]): void => {
    timeline = update(timeline);
  };

  addRunEvent({
    type: "tool.started",
    step: 1,
    index: 0,
    call: { id: "call-1", name: "run_command", input: { command: "echo done" } },
  }, apply);
  addRunEvent({ type: "run.completed", text: "Done", steps: 1 }, apply);

  const tool = timeline.find((item) => item.kind === "tool");
  assert.equal(tool?.kind, "tool");
  if (tool?.kind !== "tool") return;
  assert.equal(tool.phase, "completed");
  assert.equal(tool.isError, true);
  assert.match(tool.content ?? "", /completion result/);
});

test("reasoning blocks map to their model calls across a collapsed activity group", () => {
  const timeline: TimelineItem[] = [
    {
      id: "work",
      kind: "activity-group",
      items: [
        { id: "thinking-1", kind: "reasoning", step: 1, text: "First", streaming: false },
        { id: "call-1", kind: "assistant", text: "", streaming: false, intermediate: true },
        { id: "thinking-2", kind: "reasoning", step: 2, text: "Second", streaming: false },
      ],
    },
    { id: "call-2", kind: "assistant", text: "Done", streaming: false },
  ];

  assert.deepEqual([...modelCallsForReasoning(timeline)].map(([reasoningId, call]) => [reasoningId, call.id]), [
    ["thinking-1", "call-1"],
    ["thinking-2", "call-2"],
  ]);
});

test("work before a message steered into an active run still collapses", () => {
  let timeline: TimelineItem[] = [{ id: "user-1", kind: "user", text: "Start", sequence: 0 }];
  const apply = (update: (items: TimelineItem[]) => TimelineItem[]): void => {
    timeline = update(timeline);
  };

  addRunEvent({ type: "model.started", step: 1 }, apply);
  addRunEvent({ type: "model.reasoning.delta", step: 1, text: "Working" }, apply);
  addRunEvent({
    type: "model.completed",
    step: 1,
    sequence: 1,
    model: "test-model",
    providerId: "test-provider",
    providerConnectionId: "test-connection",
    durationMs: 10,
    response: {
      text: "I will inspect it.",
      toolCalls: [{ id: "call-1", name: "read", input: { path: "src/a.ts" } }],
    },
  }, apply);
  addRunEvent({
    type: "tool.started",
    step: 1,
    index: 0,
    call: { id: "call-1", name: "read", input: { path: "src/a.ts" } },
  }, apply);

  timeline = [...timeline, { id: "user-2", kind: "user", text: "Also check tests", sequence: 3 }];

  addRunEvent({
    type: "tool.completed",
    step: 1,
    index: 0,
    sequence: 2,
    call: { id: "call-1", name: "read", input: { path: "src/a.ts" } },
    content: "contents",
    isError: false,
  }, apply);
  addRunEvent({ type: "run.completed", text: "Done", steps: 1 }, apply);

  assert.deepEqual(timeline.map(({ kind }) => kind), ["user", "activity-group", "user"]);
  const work = timeline[1];
  assert.equal(work?.kind, "activity-group");
  if (work?.kind !== "activity-group") return;
  assert.deepEqual(work.items.map(({ kind }) => kind), ["reasoning", "assistant", "tool"]);
});
