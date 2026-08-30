import assert from "node:assert/strict";
import test from "node:test";
import { soundForRunEvent } from "../src/desktop/renderer/interface-sounds.js";

const foreground = { background: false, queued: false, userStopped: false };

test("permission requests always play the attention cue", () => {
  assert.equal(soundForRunEvent("permission.requested", foreground), "permission");
});

test("completion only plays after final background work", () => {
  assert.equal(soundForRunEvent("run.completed", foreground), undefined);
  assert.equal(soundForRunEvent("run.completed", { ...foreground, background: true }), "complete");
  assert.equal(soundForRunEvent("run.completed", {
    ...foreground,
    background: true,
    queued: true,
  }), undefined);
});

test("terminal failure ignores queued continuation and intentional stops", () => {
  assert.equal(soundForRunEvent("run.failed", foreground), "failure");
  assert.equal(soundForRunEvent("run.failed", { ...foreground, queued: true }), undefined);
  assert.equal(soundForRunEvent("run.failed", { ...foreground, userStopped: true }), undefined);
});
