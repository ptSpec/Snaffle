import assert from "node:assert/strict";
import test from "node:test";
import {
  modelCallsForReasoning,
  type TimelineItem,
} from "../src/desktop/renderer/sections/conversation/timeline-state.js";

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
