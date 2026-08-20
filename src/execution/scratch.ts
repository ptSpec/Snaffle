import { chmod, mkdir, readdir, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";

export const THREAD_SCRATCH_MAX_IDLE_MS = 5 * 24 * 60 * 60 * 1_000;

export function threadScratchDirectory(root: string, threadId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(threadId)) throw new Error("Invalid thread ID for temporary storage");
  return path.join(root, threadId);
}

export async function prepareScratchDirectory(directory: string): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const now = new Date();
  await utimes(directory, now, now);
  return directory;
}

export async function removeThreadScratch(root: string, threadId: string): Promise<void> {
  await rm(threadScratchDirectory(root, threadId), { recursive: true, force: true });
}

export async function cleanInactiveThreadScratch(root: string, maxIdleMs: number): Promise<void> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  const cutoff = Date.now() - maxIdleMs;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(root, entry.name);
    if ((await stat(directory)).mtimeMs < cutoff) {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
