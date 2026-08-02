import { createHash, randomUUID } from "node:crypto";
import type { Client, Row } from "@libsql/client";
import type { SaveMessageInput, SavedMessage } from "./api.js";

export class SavedMessageStore {
  constructor(private readonly database: Client) {}

  async initialize(): Promise<void> {
    await this.database.batch(
      [
        `CREATE TABLE IF NOT EXISTS saved_messages (
          id TEXT PRIMARY KEY,
          source_key TEXT NOT NULL UNIQUE,
          source_entry_id TEXT,
          source_thread_id TEXT NOT NULL,
          source_workspace_id TEXT NOT NULL,
          source_sequence INTEGER NOT NULL,
          workspace_name TEXT NOT NULL,
          thread_title TEXT NOT NULL,
          role TEXT NOT NULL,
          text TEXT NOT NULL,
          model TEXT,
          created_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS saved_messages_created
          ON saved_messages(created_at DESC)`,
        "DELETE FROM saved_messages WHERE role != 'assistant'",
      ],
      "write",
    );
  }

  async save(input: SaveMessageInput): Promise<SavedMessage[]> {
    const source = await this.database.execute({
      sql: `SELECT e.id AS entry_id, e.role, e.text, t.workspace_id, t.title, w.name
        FROM threads t
        JOIN workspaces w ON w.id = t.workspace_id
        LEFT JOIN entries e ON e.thread_id = t.id AND e.sequence = ?
        WHERE t.id = ?`,
      args: [input.sequence, input.threadId],
    });
    const row = source.rows[0];
    if (!row) throw new Error("The source thread no longer exists");

    const entryMatches =
      rowTextOrNull(row, "entry_id") !== null &&
      rowTextOrNull(row, "role") === "assistant" &&
      rowTextOrNull(row, "text") === input.text;
    const model = input.model?.trim() || null;
    const sourceKey = createHash("sha256")
      .update(JSON.stringify([input.threadId, input.sequence, input.text, model]))
      .digest("hex");

    await this.database.execute({
      sql: `INSERT OR IGNORE INTO saved_messages(
          id, source_key, source_entry_id, source_thread_id, source_workspace_id,
          source_sequence, workspace_name, thread_title, role, text, model, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        randomUUID(),
        sourceKey,
        entryMatches ? rowTextOrNull(row, "entry_id") : null,
        input.threadId,
        rowText(row, "workspace_id"),
        input.sequence,
        rowText(row, "name"),
        rowText(row, "title"),
        "assistant",
        input.text,
        model,
        Date.now(),
      ],
    });
    return this.list();
  }

  async delete(id: string): Promise<SavedMessage[]> {
    await this.database.execute({ sql: "DELETE FROM saved_messages WHERE id = ?", args: [id] });
    return this.list();
  }

  async list(): Promise<SavedMessage[]> {
    const result = await this.database.execute(`SELECT s.*,
        EXISTS(
          SELECT 1 FROM entries e
          WHERE e.thread_id = s.source_thread_id
            AND e.role = s.role
            AND e.text = s.text
            AND (
              (s.source_entry_id IS NOT NULL AND e.id = s.source_entry_id)
              OR (s.source_entry_id IS NULL AND e.sequence = s.source_sequence)
            )
        ) AS source_available
      FROM saved_messages s
      ORDER BY s.created_at DESC`);
    return result.rows.map(savedMessageFromRow);
  }

  async source(id: string): Promise<{ threadId: string; entryId: string } | null> {
    const result = await this.database.execute({
      sql: `SELECT e.id, e.thread_id
        FROM saved_messages s
        JOIN entries e ON e.thread_id = s.source_thread_id
          AND e.role = s.role
          AND e.text = s.text
          AND (
            (s.source_entry_id IS NOT NULL AND e.id = s.source_entry_id)
            OR (s.source_entry_id IS NULL AND e.sequence = s.source_sequence)
          )
        WHERE s.id = ?`,
      args: [id],
    });
    const row = result.rows[0];
    return row ? { threadId: rowText(row, "thread_id"), entryId: rowText(row, "id") } : null;
  }
}

function savedMessageFromRow(row: Row): SavedMessage {
  const role = rowText(row, "role");
  if (role !== "assistant") throw new Error("Invalid saved message role");
  return {
    id: rowText(row, "id"),
    sourceEntryId: rowTextOrNull(row, "source_entry_id"),
    sourceThreadId: rowText(row, "source_thread_id"),
    sourceWorkspaceId: rowText(row, "source_workspace_id"),
    sourceSequence: rowNumber(row, "source_sequence"),
    workspaceName: rowText(row, "workspace_name"),
    threadTitle: rowText(row, "thread_title"),
    role,
    text: rowText(row, "text"),
    model: rowTextOrNull(row, "model"),
    createdAt: rowNumber(row, "created_at"),
    sourceAvailable: rowNumber(row, "source_available") === 1,
  };
}

function rowText(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Invalid database value: ${key}`);
  return value;
}

function rowTextOrNull(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`Invalid database value: ${key}`);
  return value;
}

function rowNumber(row: Row, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`Invalid database value: ${key}`);
}
