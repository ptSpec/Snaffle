import assert from "node:assert/strict";
import test from "node:test";
import { applySubagentUpdate } from "../src/agent/subagents/activity.js";

test("subagent activity keeps interleaved child updates separate", () => {
  let activity = applySubagentUpdate(undefined, {
    type: "batch.started",
    access: "read",
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
});
