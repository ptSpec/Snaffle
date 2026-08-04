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
  const summaries = await store.savedMessages.summaries();
  assert.equal("text" in summaries[0]!, false);
  await store.removeWorkspace(workspaceId);
  const saved = await store.savedMessages.list();
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.text, "answer");
  assert.equal(saved[0]?.sourceAvailable, false);
});

test("sent attachments can leave and rejoin model context", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "esch-store-"));
  const store = await openStore(path.join(root, "esch.db"));
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });

  await store.addWorkspace(root, "example");
  const threadId = (await store.state()).activeThreadId!;
  const attachment = {
    id: "attachment-1",
    name: "notes.md",
    mediaType: "text/markdown",
    size: 10,
    kind: "document" as const,
    delivery: "markdown" as const,
    estimatedTokens: 3,
  };
  await store.saveMessages(threadId, [
    { role: "system", content: "system" },
    { role: "user", content: "read this", attachments: [attachment] },
  ]);

  await store.setAttachmentContext(threadId, 1, attachment.id, false);
  const removed = (await store.messages(threadId))[1];
  assert.equal(removed?.role === "user" && removed.attachments?.[0]?.includeInContext, false);

  await store.setAttachmentContext(threadId, 1, attachment.id, true);
  const restored = (await store.messages(threadId))[1];
  assert.equal(restored?.role === "user" && restored.attachments?.[0]?.includeInContext, undefined);
});
