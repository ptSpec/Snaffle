import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Message } from "../src/protocol.js";
import { openStore } from "../src/desktop/store.js";

test("chat entry ids stay stable and saved messages survive source deletion", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "esch-store-"));
  const store = await openStore(path.join(root, "esch.db"));
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });

  await store.addWorkspace(root, "example");
  const state = await store.state();
  const workspaceId = state.activeWorkspaceId!;
  const threadId = state.activeThreadId!;
  const first: Message[] = [
    { role: "system", content: "system" },
    { role: "user", content: "question" },
    { role: "assistant", content: "answer", model: "test-model" },
  ];
  await store.saveMessages(threadId, first);
  const originalIds = (await store.entries(threadId)).map((entry) => entry.id);
  await store.saveMessages(threadId, [...first, { role: "user", content: "follow up" }]);
  assert.deepEqual(
    (await store.entries(threadId)).slice(0, first.length).map((entry) => entry.id),
    originalIds,
  );

  await store.savedMessages.save({
    threadId,
    sequence: 2,
    text: "answer",
    model: "test-model",
  });
  await store.removeWorkspace(workspaceId);
  const saved = await store.savedMessages.list();
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.text, "answer");
  assert.equal(saved[0]?.sourceAvailable, false);
});
