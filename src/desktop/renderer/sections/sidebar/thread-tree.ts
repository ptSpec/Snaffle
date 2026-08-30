import type { DesktopThread } from "../../../api.js";

export type ThreadTreeRow = {
  thread: DesktopThread;
  depth: number;
  hasChildren: boolean;
  inPreferredPath: boolean;
};

export function buildThreadTreeRows(
  threads: DesktopThread[],
  collapsedIds: ReadonlySet<string> = new Set(),
  preferredThreadId?: string | null,
): ThreadTreeRow[] {
  const threadsById = new Map(threads.map((thread) => [thread.id, thread]));
  const parentById = new Map<string, string>();

  for (const thread of threads) {
    if (thread.id === preferredThreadId) continue;
    const parentId = validParentId(thread, threadsById);
    if (parentId) parentById.set(thread.id, parentId);
  }

  const childrenById = new Map<string, DesktopThread[]>();
  for (const thread of threads) {
    const parentId = parentById.get(thread.id);
    if (!parentId) continue;
    const children = childrenById.get(parentId) ?? [];
    children.push(thread);
    childrenById.set(parentId, children);
  }

  const preferredPath = new Set<string>();
  let pathId = preferredThreadId && threadsById.has(preferredThreadId)
    ? preferredThreadId
    : undefined;
  while (pathId && !preferredPath.has(pathId)) {
    preferredPath.add(pathId);
    pathId = parentById.get(pathId);
  }

  const activityById = new Map<string, number>();
  function latestActivity(thread: DesktopThread): number {
    const cached = activityById.get(thread.id);
    if (cached !== undefined) return cached;
    const activity = Math.max(
      thread.updatedAt,
      ...(childrenById.get(thread.id) ?? []).map(latestActivity),
    );
    activityById.set(thread.id, activity);
    return activity;
  }

  function compare(left: DesktopThread, right: DesktopThread): number {
    const leftPreferred = preferredPath.has(left.id);
    const rightPreferred = preferredPath.has(right.id);
    if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1;
    return latestActivity(right) - latestActivity(left) || left.id.localeCompare(right.id);
  }

  const roots = threads.filter((thread) => !parentById.has(thread.id)).sort(compare);
  for (const children of childrenById.values()) children.sort(compare);

  const rows: ThreadTreeRow[] = [];
  function append(thread: DesktopThread, depth: number): void {
    const children = childrenById.get(thread.id) ?? [];
    rows.push({
      thread,
      depth,
      hasChildren: children.length > 0,
      inPreferredPath: preferredPath.has(thread.id),
    });
    if (collapsedIds.has(thread.id)) return;
    for (const child of children) append(child, depth + 1);
  }
  for (const root of roots) append(root, 0);
  return rows;
}

function validParentId(
  thread: DesktopThread,
  threadsById: ReadonlyMap<string, DesktopThread>,
): string | null {
  const parentId = thread.sourceThreadId;
  if (!parentId || !threadsById.has(parentId) || parentId === thread.id) return null;

  const visited = new Set([thread.id]);
  let candidateId: string | null = parentId;
  while (candidateId) {
    if (visited.has(candidateId)) return null;
    visited.add(candidateId);
    candidateId = threadsById.get(candidateId)?.sourceThreadId ?? null;
    if (candidateId && !threadsById.has(candidateId)) break;
  }
  return parentId;
}
