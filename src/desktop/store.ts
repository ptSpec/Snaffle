import { createClient, type Client, type Row, type InStatement } from "@libsql/client/sqlite3";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Message } from "../protocol.js";
import { ContextStore } from "../context/store.js";
import type { DesktopEntry, DesktopThread, DesktopWorkspace } from "./api.js";
import { SavedMessageStore } from "./saved-messages-store.js";

export type StoreState = {
  workspaces: DesktopWorkspace[];
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
};

export async function openStore(filename: string): Promise<DesktopStore> {
  mkdirSync(path.dirname(filename), { recursive: true });
  const database = createClient({ url: pathToFileURL(filename).href });
  const store = new DesktopStore(database);
  await store.initialize();
  return store;
}

export class DesktopStore {
  readonly savedMessages: SavedMessageStore;
  readonly context: ContextStore;

  constructor(private readonly database: Client) {
    this.savedMessages = new SavedMessageStore(database);
    this.context = new ContextStore(database);
  }

  async initialize(): Promise<void> {
    await this.database.batch(
      [
        `CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS threads (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          draft TEXT NOT NULL DEFAULT '',
          bookmarked INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS threads_workspace_updated
          ON threads(workspace_id, updated_at DESC)`,
        `CREATE TABLE IF NOT EXISTS entries (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL,
          role TEXT NOT NULL,
          text TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(thread_id, sequence)
        )`,
        `CREATE INDEX IF NOT EXISTS entries_thread_sequence
          ON entries(thread_id, sequence)`,
        `CREATE VIRTUAL TABLE IF NOT EXISTS entries_search USING fts5(
          text,
          content='entries',
          content_rowid='rowid'
        )`,
        `CREATE TRIGGER IF NOT EXISTS entries_search_insert AFTER INSERT ON entries BEGIN
          INSERT INTO entries_search(rowid, text) VALUES (new.rowid, new.text);
        END`,
        `CREATE TRIGGER IF NOT EXISTS entries_search_delete AFTER DELETE ON entries BEGIN
          INSERT INTO entries_search(entries_search, rowid, text)
          VALUES ('delete', old.rowid, old.text);
        END`,
        `CREATE TABLE IF NOT EXISTS app_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )`,
      ],
      "write",
    );
    const threadColumns = await this.database.execute("PRAGMA table_info(threads)");
    if (!threadColumns.rows.some((row) => rowText(row, "name") === "draft")) {
      await this.database.execute("ALTER TABLE threads ADD COLUMN draft TEXT NOT NULL DEFAULT ''");
    }
    await this.database.execute("PRAGMA foreign_keys = ON");
    await this.savedMessages.initialize();
    await this.context.initialize();
  }

  async state(): Promise<StoreState> {
    const [workspaceResult, threadResult, stateResult] = await Promise.all([
      this.database.execute("SELECT * FROM workspaces ORDER BY updated_at DESC"),
      this.database.execute("SELECT * FROM threads ORDER BY updated_at DESC"),
      this.database.execute("SELECT key, value FROM app_state"),
    ]);
    const threads = threadResult.rows.map(threadFromRow);
    const state = new Map(stateResult.rows.map((row) => [rowText(row, "key"), rowText(row, "value")]));

    return {
      workspaces: workspaceResult.rows.map((row) => ({
        id: rowText(row, "id"),
        path: rowText(row, "path"),
        name: rowText(row, "name"),
        updatedAt: rowNumber(row, "updated_at"),
        threads: threads.filter((thread) => thread.workspaceId === rowText(row, "id")),
      })),
      activeWorkspaceId: state.get("active_workspace_id") ?? null,
      activeThreadId: state.get("active_thread_id") ?? null,
    };
  }

  async addWorkspace(workspacePath: string, name: string): Promise<void> {
    const existing = await this.database.execute({
      sql: "SELECT id FROM workspaces WHERE path = ?",
      args: [workspacePath],
    });
    const workspaceId = existing.rows[0] ? rowText(existing.rows[0], "id") : randomUUID();
    const now = Date.now();

    if (!existing.rows[0]) {
      await this.database.execute({
        sql: `INSERT INTO workspaces(id, path, name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)`,
        args: [workspaceId, workspacePath, name, now, now],
      });
    }

    const threadId = await this.ensureThread(workspaceId);
    await this.setActive(workspaceId, threadId);
  }

  async selectWorkspace(workspaceId: string): Promise<void> {
    await this.requireWorkspace(workspaceId);
    const threadId = await this.ensureThread(workspaceId);
    await this.setActive(workspaceId, threadId);
  }

  async createThread(workspaceId: string): Promise<void> {
    await this.requireWorkspace(workspaceId);
    const count = await this.database.execute({
      sql: "SELECT COUNT(*) AS count FROM threads WHERE workspace_id = ?",
      args: [workspaceId],
    });
    const threadId = randomUUID();
    const now = Date.now();
    const number = rowNumber(count.rows[0], "count") + 1;
    await this.database.execute({
      sql: `INSERT INTO threads(id, workspace_id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)`,
      args: [threadId, workspaceId, `Thread ${number}`, now, now],
    });
    await this.setActive(workspaceId, threadId);
  }

  async selectThread(threadId: string): Promise<void> {
    const result = await this.database.execute({
      sql: "SELECT workspace_id FROM threads WHERE id = ?",
      args: [threadId],
    });
    const row = result.rows[0];
    if (!row) throw new Error("Thread no longer exists");
    await this.setActive(rowText(row, "workspace_id"), threadId);
  }

  async setBookmarked(threadId: string, bookmarked: boolean): Promise<void> {
    const result = await this.database.execute({
      sql: "UPDATE threads SET bookmarked = ? WHERE id = ?",
      args: [bookmarked ? 1 : 0, threadId],
    });
    if (result.rowsAffected === 0) throw new Error("Thread no longer exists");
  }

  async setDraft(threadId: string, draft: string): Promise<void> {
    const result = await this.database.execute({
      sql: "UPDATE threads SET draft = ? WHERE id = ?",
      args: [draft, threadId],
    });
    if (result.rowsAffected === 0) throw new Error("Thread no longer exists");
  }

  async deleteThreads(threadIds: string[]): Promise<void> {
    if (threadIds.length === 0) return;
    const current = await this.state();
    const placeholders = threadIds.map(() => "?").join(", ");
    await this.database.execute({
      sql: `DELETE FROM threads WHERE id IN (${placeholders})`,
      args: threadIds,
    });

    if (!current.activeThreadId || !threadIds.includes(current.activeThreadId)) return;
    if (!current.activeWorkspaceId) return;
    const nextThreadId = await this.ensureThread(current.activeWorkspaceId);
    await this.setActive(current.activeWorkspaceId, nextThreadId);
  }

  async removeWorkspace(workspaceId: string): Promise<void> {
    const current = await this.state();
    await this.database.execute({
      sql: "DELETE FROM workspaces WHERE id = ?",
      args: [workspaceId],
    });
    if (current.activeWorkspaceId !== workspaceId) return;

    const next = await this.database.execute(
      "SELECT id FROM workspaces ORDER BY updated_at DESC LIMIT 1",
    );
    const row = next.rows[0];
    if (!row) {
      await this.database.batch(
        [
          { sql: "DELETE FROM app_state WHERE key = ?", args: ["active_workspace_id"] },
          { sql: "DELETE FROM app_state WHERE key = ?", args: ["active_thread_id"] },
        ],
        "write",
      );
      return;
    }

    await this.selectWorkspace(rowText(row, "id"));
  }

  async messages(threadId: string | null): Promise<Message[]> {
    return (await this.entries(threadId)).map((entry) => entry.message);
  }

  async lastSequence(threadId: string): Promise<number> {
    const result = await this.database.execute({
      sql: "SELECT COALESCE(MAX(sequence), -1) AS sequence FROM entries WHERE thread_id = ?",
      args: [threadId],
    });
    return rowNumber(result.rows[0], "sequence");
  }

  async appendMessage(threadId: string, sequence: number, message: Message): Promise<void> {
    const now = Date.now();
    const firstTask = message.role === "user" ? message.content.trim().replace(/\s+/g, " ") : "";
    const title = firstTask && firstTask.length > 48 ? `${firstTask.slice(0, 47)}…` : firstTask;
    await this.database.batch(
      [
        {
          sql: `INSERT INTO entries(id, thread_id, sequence, role, text, data, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(thread_id, sequence) DO UPDATE SET
              role = excluded.role, text = excluded.text, data = excluded.data`,
          args: [randomUUID(), threadId, sequence, message.role, message.content, JSON.stringify(message), now],
        },
        {
          sql: `UPDATE threads
            SET title = CASE WHEN title GLOB 'Thread [0-9]*' AND ? != '' THEN ? ELSE title END,
                draft = '', updated_at = ?
            WHERE id = ?`,
          args: [title, title, now, threadId],
        },
      ],
      "write",
    );
  }

  async restoreThread(threadId: string, sequence: number): Promise<void> {
    const result = await this.database.execute({
      sql: "SELECT data FROM entries WHERE thread_id = ? AND sequence = ?",
      args: [threadId, sequence],
    });
    const message = result.rows[0]
      ? JSON.parse(rowText(result.rows[0], "data")) as Message
      : null;
    if (message?.role !== "user") throw new Error("The restore point is no longer available");

    await this.database.batch(
      [
        {
          sql: `DELETE FROM context_checkpoints
            WHERE thread_id = ? AND (through_sequence >= ? OR created_after_sequence >= ?)`,
          args: [threadId, sequence, sequence],
        },
        {
          sql: "DELETE FROM entries WHERE thread_id = ? AND sequence >= ?",
          args: [threadId, sequence],
        },
        {
          sql: "UPDATE threads SET draft = ?, updated_at = ? WHERE id = ?",
          args: [message.content, Date.now(), threadId],
        },
      ],
      "write",
    );
  }

  async entries(threadId: string | null): Promise<DesktopEntry[]> {
    if (!threadId) return [];
    const result = await this.database.execute({
      sql: "SELECT id, sequence, data FROM entries WHERE thread_id = ? ORDER BY sequence",
      args: [threadId],
    });
    return result.rows.map(entryFromRow);
  }

  async saveMessages(threadId: string, messages: Message[]): Promise<void> {
    const now = Date.now();
    const serialized = messages.map((message) => JSON.stringify(message));
    const existing = await this.database.execute({
      sql: "SELECT data FROM entries WHERE thread_id = ? ORDER BY sequence",
      args: [threadId],
    });
    let unchanged = 0;
    while (
      unchanged < existing.rows.length &&
      unchanged < serialized.length &&
      rowText(existing.rows[unchanged], "data") === serialized[unchanged]
    ) {
      unchanged += 1;
    }
    const firstTask = messages.find((message) => message.role === "user")?.content
      .trim()
      .replace(/\s+/g, " ");
    const title = firstTask && firstTask.length > 48 ? `${firstTask.slice(0, 47)}…` : firstTask;
    const statements: InStatement[] = [
      {
        sql: "DELETE FROM entries WHERE thread_id = ? AND sequence >= ?",
        args: [threadId, unchanged],
      },
      ...messages.slice(unchanged).map((message, offset) => ({
        sql: `INSERT INTO entries(id, thread_id, sequence, role, text, data, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          randomUUID(),
          threadId,
          unchanged + offset,
          message.role,
          message.content,
          JSON.stringify(message),
          now,
        ],
      })),
      {
        sql: `UPDATE threads
          SET title = CASE WHEN title GLOB 'Thread [0-9]*' AND ? IS NOT NULL THEN ? ELSE title END,
              draft = '',
              updated_at = ?
          WHERE id = ?`,
        args: [title ?? null, title ?? null, now, threadId],
      },
    ];
    await this.database.batch(statements, "write");
  }

  async setAttachmentContext(
    threadId: string,
    sequence: number,
    attachmentId: string,
    include: boolean,
  ): Promise<void> {
    const result = await this.database.execute({
      sql: "SELECT data FROM entries WHERE thread_id = ? AND sequence = ?",
      args: [threadId, sequence],
    });
    if (!result.rows[0]) throw new Error("Message no longer exists");

    const message = JSON.parse(rowText(result.rows[0], "data")) as Message;
    if (message.role !== "user" || !message.attachments?.length) {
      throw new Error("Message has no attachments");
    }

    let found = false;
    const attachments = message.attachments.map((attachment) => {
      if (attachment.id !== attachmentId) return attachment;
      found = true;
      if (!include) return { ...attachment, includeInContext: false as const };
      const { includeInContext: _removed, ...restored } = attachment;
      return restored;
    });
    if (!found) throw new Error("Attachment no longer exists");

    await this.database.execute({
      sql: "UPDATE entries SET data = ? WHERE thread_id = ? AND sequence = ?",
      args: [JSON.stringify({ ...message, attachments }), threadId, sequence],
    });
  }

  close(): void {
    this.database.close();
  }

  private async ensureThread(workspaceId: string): Promise<string> {
    const existing = await this.database.execute({
      sql: "SELECT id FROM threads WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 1",
      args: [workspaceId],
    });
    if (existing.rows[0]) return rowText(existing.rows[0], "id");

    const threadId = randomUUID();
    const now = Date.now();
    await this.database.execute({
      sql: `INSERT INTO threads(id, workspace_id, title, created_at, updated_at)
        VALUES (?, ?, 'Thread 1', ?, ?)`,
      args: [threadId, workspaceId, now, now],
    });
    return threadId;
  }

  private async requireWorkspace(workspaceId: string): Promise<void> {
    const result = await this.database.execute({
      sql: "SELECT 1 FROM workspaces WHERE id = ?",
      args: [workspaceId],
    });
    if (!result.rows[0]) throw new Error("Workspace no longer exists");
  }

  private async setActive(workspaceId: string, threadId: string): Promise<void> {
    await this.database.batch(
      [
        stateStatement("active_workspace_id", workspaceId),
        stateStatement("active_thread_id", threadId),
        {
          sql: "UPDATE workspaces SET updated_at = ? WHERE id = ?",
          args: [Date.now(), workspaceId],
        },
      ],
      "write",
    );
  }
}

function stateStatement(key: string, value: string): InStatement {
  return {
    sql: `INSERT INTO app_state(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [key, value],
  };
}

function threadFromRow(row: Row): DesktopThread {
  return {
    id: rowText(row, "id"),
    workspaceId: rowText(row, "workspace_id"),
    title: rowText(row, "title"),
    draft: rowText(row, "draft"),
    bookmarked: rowNumber(row, "bookmarked") === 1,
    updatedAt: rowNumber(row, "updated_at"),
  };
}

function entryFromRow(row: Row): DesktopEntry {
  return {
    id: rowText(row, "id"),
    sequence: rowNumber(row, "sequence"),
    message: JSON.parse(rowText(row, "data")) as Message,
  };
}

function rowText(row: Row | undefined, key: string): string {
  const value = row?.[key];
  if (typeof value !== "string") throw new Error(`Invalid database value: ${key}`);
  return value;
}

function rowNumber(row: Row | undefined, key: string): number {
  const value = row?.[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`Invalid database value: ${key}`);
}
