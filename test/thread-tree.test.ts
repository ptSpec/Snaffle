import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopThread } from "../src/desktop/api.js";
import { buildThreadTreeRows } from "../src/desktop/renderer/sections/sidebar/thread-tree.js";

test("thread tree keeps descendants together by recent branch activity", () => {
  const threads = [
    thread("new-root", 40),
    thread("root", 10),
    thread("sibling", 30, "root"),
    thread("child", 20, "root"),
    thread("grandchild", 15, "child"),
  ];

  const rows = buildThreadTreeRows(threads);

  assert.deepEqual(rows.map(({ thread, depth }) => [thread.id, depth]), [
    ["new-root", 0],
    ["root", 0],
    ["sibling", 1],
    ["child", 1],
    ["grandchild", 2],
  ]);
});

test("thread tree temporarily detaches the promoted thread for the active island", () => {
  const threads = [
    thread("root", 10),
    thread("sibling", 30, "root"),
    thread("child", 20, "root"),
    thread("grandchild", 15, "child"),
  ];

  const rows = buildThreadTreeRows(threads, new Set(), "grandchild");

  assert.deepEqual(rows.map(({ thread, depth }) => [thread.id, depth]), [
    ["grandchild", 0],
    ["root", 0],
    ["sibling", 1],
    ["child", 1],
  ]);
  assert.deepEqual(rows.filter(({ inPreferredPath }) => inPreferredPath).map(({ thread }) => thread.id), [
    "grandchild",
  ]);
});

test("thread tree collapses branches without changing their stored relationships", () => {
  const threads = [thread("root", 10), thread("child", 9, "root"), thread("leaf", 8, "child")];

  assert.deepEqual(
    buildThreadTreeRows(threads, new Set(["root"])).map(({ thread }) => thread.id),
    ["root"],
  );
  assert.deepEqual(
    buildThreadTreeRows(threads, new Set(["child"]), "child").map(({ thread }) => thread.id),
    ["child", "root"],
  );
});

test("thread tree treats missing parents and cycles as independent roots", () => {
  const rows = buildThreadTreeRows([
    thread("orphan", 30, "deleted"),
    thread("self", 20, "self"),
    thread("cycle-a", 10, "cycle-b"),
    thread("cycle-b", 9, "cycle-a"),
  ]);

  assert.equal(rows.length, 4);
  assert.ok(rows.every(({ depth }) => depth === 0));
});

function thread(id: string, updatedAt: number, sourceThreadId: string | null = null): DesktopThread {
  return {
    id,
    workspaceId: "workspace",
    title: id,
    draft: "",
    model: null,
    providerConnectionId: "provider",
    reasoningEffort: "",
    bookmarked: false,
    sourceThreadId,
    sourceEntryId: sourceThreadId ? `${sourceThreadId}-entry` : null,
    branchLabel: null,
    subagentMode: "inherit",
    updatedAt,
  };
}
