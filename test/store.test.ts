import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Message } from "../src/protocol.js";
import { openStore } from "../src/desktop/store.js";

test("chat entry ids stay stable and saved messages survive source deletion", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-store-"));
  const store = await openStore(path.join(root, "store.db"));
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
  const root = await mkdtemp(path.join(tmpdir(), "harness-store-"));
  const store = await openStore(path.join(root, "store.db"));
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

test("restoring a thread removes the failed turn and newer context checkpoints", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-restore-store-"));
  const store = await openStore(path.join(root, "store.db"));
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });

  await store.addWorkspace(root, "example");
  const threadId = (await store.state()).activeThreadId!;
  await store.saveMessages(threadId, [
    { role: "system", content: "system" },
    { role: "user", content: "first" },
    { role: "assistant", content: "first answer" },
    { role: "user", content: "retry this" },
    { role: "assistant", content: "malformed call" },
  ]);
  await store.context.save({
    threadId,
    throughSequence: 2,
    createdAfterSequence: 4,
    summary: "First turn completed.",
    sourceCharacters: 50,
    model: "test-model",
  });

  await store.restoreThread(threadId, 3);

  assert.deepEqual((await store.messages(threadId)).map((message) => message.content), [
    "system",
    "first",
    "first answer",
  ]);
  assert.equal((await store.state()).workspaces[0]?.threads[0]?.draft, "retry this");
  assert.equal(await store.context.latest(threadId), null);
});

test("forking a thread copies history through one message and preserves its source", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-fork-store-"));
  const store = await openStore(path.join(root, "store.db"));
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });

  await store.addWorkspace(root, "example");
  const sourceThreadId = (await store.state()).activeThreadId!;
  await store.saveMessages(sourceThreadId, [
    { role: "system", content: "system" },
    { role: "user", content: "first" },
    { role: "assistant", content: "first answer" },
    { role: "user", content: "second" },
    { role: "assistant", content: "second answer" },
  ]);
  const sourceEntryId = (await store.entries(sourceThreadId))[2]!.id;

  await store.forkThread(sourceThreadId, 2);

  const state = await store.state();
  const forkThreadId = state.activeThreadId!;
  const fork = state.workspaces[0]!.threads.find((thread) => thread.id === forkThreadId)!;
  assert.notEqual(forkThreadId, sourceThreadId);
  assert.equal(fork.sourceThreadId, sourceThreadId);
  assert.equal(fork.sourceEntryId, sourceEntryId);
  assert.equal(fork.branchLabel, null);
  assert.deepEqual((await store.messages(forkThreadId)).map((message) => message.content), [
    "system",
    "first",
    "first answer",
  ]);
  assert.equal((await store.messages(sourceThreadId)).length, 5);
});

test("conversation search finds prefixes and follows updated messages", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-search-store-"));
  const store = await openStore(path.join(root, "store.db"));
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });

  await store.addWorkspace(root, "example");
  const threadId = (await store.state()).activeThreadId!;
  await store.appendMessage(threadId, 0, { role: "user", content: "Investigate the walrus parser" });
  assert.equal((await store.searchConversations("walr"))[0]?.threadId, threadId);

  await store.appendMessage(threadId, 0, { role: "user", content: "Investigate the capybara parser" });
  assert.equal((await store.searchConversations("walrus")).length, 0);
  assert.equal((await store.searchConversations("capy"))[0]?.entryId, (await store.entries(threadId))[0]?.id);
});

test("context checkpoints preserve the full transcript and project only the tail", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-context-store-"));
  const store = await openStore(path.join(root, "store.db"));
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });

  await store.addWorkspace(root, "example");
  const threadId = (await store.state()).activeThreadId!;
  const messages: Message[] = [
    { role: "system", content: "system" },
    { role: "user", content: "first" },
    { role: "assistant", content: "first answer", reasoning: "scratch" },
    { role: "user", content: "second" },
    { role: "assistant", content: "second answer" },
  ];
  await store.saveMessages(threadId, messages);
  const checkpoint = await store.context.save({
    threadId,
    throughSequence: 2,
    createdAfterSequence: 4,
    summary: "First turn completed.",
    sourceCharacters: 100,
    model: "test-model",
  });
  await store.context.markApplied(checkpoint.id, 60, 4);

  assert.equal((await store.entries(threadId)).length, messages.length);
  assert.deepEqual(
    (await store.context.entries(threadId, checkpoint)).map((entry) => entry.sequence),
    [0, 3, 4],
  );
  const stored = await store.context.latest(threadId);
  assert.equal(stored?.summary, "First turn completed.");
  assert.equal(stored?.injectedCharacters, 60);
  assert.equal(stored?.appliedThroughSequence, 4);
});
