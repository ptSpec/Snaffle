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
