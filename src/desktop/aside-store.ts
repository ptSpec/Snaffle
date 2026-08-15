import type { Client, Row } from "@libsql/client";
import { MAX_KEPT_ASIDE_MESSAGES, type KeptAsideMessage } from "./api.js";

export class AsideStore {
  constructor(private readonly database: Client) {}

  async initialize(): Promise<void> {
    await this.database.batch(
      [
        `CREATE TABLE IF NOT EXISTS thread_asides (
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (thread_id, entry_id)
        )`,
        `CREATE INDEX IF NOT EXISTS thread_asides_thread_created
          ON thread_asides(thread_id, created_at)`,
        `DELETE FROM thread_asides
          WHERE entry_id IN (SELECT id FROM entries WHERE role != 'assistant')`,
        `DELETE FROM thread_asides
          WHERE rowid IN (
            SELECT rowid FROM (
              SELECT rowid, ROW_NUMBER() OVER (
                PARTITION BY thread_id ORDER BY created_at, rowid
              ) AS position
              FROM thread_asides
            )
            WHERE position > ${MAX_KEPT_ASIDE_MESSAGES}
          )`,
      ],
      "write",
    );
  }

  async keep(threadId: string, entryId: string): Promise<KeptAsideMessage[]> {
    const source = await this.database.execute({
      sql: "SELECT role FROM entries WHERE id = ? AND thread_id = ?",
      args: [entryId, threadId],
    });
    const role = source.rows[0] ? rowText(source.rows[0], "role") : null;
    if (role !== "assistant") {
      throw new Error("Only assistant messages can be kept aside");
    }

    const existing = await this.database.execute({
      sql: "SELECT 1 FROM thread_asides WHERE thread_id = ? AND entry_id = ?",
      args: [threadId, entryId],
    });
    if (!existing.rows.length) {
      const count = await this.database.execute({
        sql: "SELECT COUNT(*) AS count FROM thread_asides WHERE thread_id = ?",
        args: [threadId],
      });
      if (rowNumber(count.rows[0], "count") >= MAX_KEPT_ASIDE_MESSAGES) {
        throw new Error(`You can keep up to ${MAX_KEPT_ASIDE_MESSAGES} messages aside in a thread`);
      }
      await this.database.execute({
        sql: "INSERT INTO thread_asides(thread_id, entry_id, created_at) VALUES (?, ?, ?)",
        args: [threadId, entryId, Date.now()],
      });
    }

    return this.list(threadId);
  }

  async remove(threadId: string, entryId: string): Promise<KeptAsideMessage[]> {
    await this.database.execute({
      sql: "DELETE FROM thread_asides WHERE thread_id = ? AND entry_id = ?",
      args: [threadId, entryId],
    });
    return this.list(threadId);
  }

  async list(threadId: string | null): Promise<KeptAsideMessage[]> {
    if (!threadId) return [];
    const result = await this.database.execute({
      sql: `SELECT a.entry_id, e.sequence, e.text, a.created_at
        FROM thread_asides a
        JOIN entries e ON e.id = a.entry_id AND e.thread_id = a.thread_id
        WHERE a.thread_id = ?
        ORDER BY a.created_at, a.rowid`,
      args: [threadId],
    });
    return result.rows.map((row) => ({
      entryId: rowText(row, "entry_id"),
      sequence: rowNumber(row, "sequence"),
      text: rowText(row, "text"),
      createdAt: rowNumber(row, "created_at"),
    }));
  }
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
