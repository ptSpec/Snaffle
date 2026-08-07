import { randomUUID } from "node:crypto";
import type { Client, Row } from "@libsql/client/sqlite3";
import type { Message } from "../protocol.js";
import type { ContextCheckpoint, ContextEntry } from "./projection.js";

export class ContextStore {
  constructor(private readonly database: Client) {}

  async initialize(): Promise<void> {
    await this.database.batch(
      [
        `CREATE TABLE IF NOT EXISTS context_checkpoints (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          through_sequence INTEGER NOT NULL,
          created_after_sequence INTEGER NOT NULL,
          summary TEXT NOT NULL,
          source_characters INTEGER NOT NULL,
          summary_characters INTEGER NOT NULL,
          model TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          applied_at INTEGER,
          injected_characters INTEGER,
          applied_through_sequence INTEGER,
          UNIQUE(thread_id, through_sequence)
        )`,
        `CREATE INDEX IF NOT EXISTS context_checkpoints_thread_created
          ON context_checkpoints(thread_id, created_at DESC)`,
      ],
      "write",
    );
  }

  async entries(threadId: string, checkpoint: ContextCheckpoint | null): Promise<ContextEntry[]> {
    const result = await this.database.execute({
      sql: checkpoint
        ? `SELECT sequence, data FROM entries
            WHERE thread_id = ? AND (role = 'system' OR sequence > ?)
            ORDER BY sequence`
        : "SELECT sequence, data FROM entries WHERE thread_id = ? ORDER BY sequence",
      args: checkpoint ? [threadId, checkpoint.throughSequence] : [threadId],
    });
    return result.rows.map(entryFromRow);
  }

  async entriesBetween(threadId: string, after: number, through: number): Promise<ContextEntry[]> {
    const result = await this.database.execute({
      sql: `SELECT sequence, data FROM entries
        WHERE thread_id = ? AND sequence > ? AND sequence <= ? AND role != 'system'
        ORDER BY sequence`,
      args: [threadId, after, through],
    });
    return result.rows.map(entryFromRow);
  }

  async latest(threadId: string | null): Promise<ContextCheckpoint | null> {
    if (!threadId) return null;
    const result = await this.database.execute({
      sql: "SELECT * FROM context_checkpoints WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1",
      args: [threadId],
    });
    return result.rows[0] ? checkpointFromRow(result.rows[0]) : null;
  }

  async checkpoints(threadId: string | null): Promise<ContextCheckpoint[]> {
    if (!threadId) return [];
    const result = await this.database.execute({
      sql: "SELECT * FROM context_checkpoints WHERE thread_id = ? ORDER BY created_at",
      args: [threadId],
    });
    return result.rows.map(checkpointFromRow);
  }

  async save(input: {
    threadId: string;
    throughSequence: number;
    createdAfterSequence: number;
    summary: string;
    sourceCharacters: number;
    model: string;
  }): Promise<ContextCheckpoint> {
    const id = randomUUID();
    const createdAt = Date.now();
    await this.database.execute({
      sql: `INSERT INTO context_checkpoints(
          id, thread_id, through_sequence, created_after_sequence, summary,
          source_characters, summary_characters, model, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id, through_sequence) DO UPDATE SET
          summary = excluded.summary,
          source_characters = excluded.source_characters,
          summary_characters = excluded.summary_characters,
          model = excluded.model,
          created_after_sequence = excluded.created_after_sequence,
          created_at = excluded.created_at`,
      args: [
        id,
        input.threadId,
        input.throughSequence,
        input.createdAfterSequence,
        input.summary,
        input.sourceCharacters,
        input.summary.length,
        input.model,
        createdAt,
      ],
    });
    return (await this.latest(input.threadId))!;
  }

  async markApplied(id: string, injectedCharacters: number, appliedThroughSequence: number): Promise<void> {
    await this.database.execute({
      sql: `UPDATE context_checkpoints
        SET applied_at = COALESCE(applied_at, ?),
            injected_characters = COALESCE(injected_characters, ?),
            applied_through_sequence = COALESCE(applied_through_sequence, ?)
        WHERE id = ?`,
      args: [Date.now(), injectedCharacters, appliedThroughSequence, id],
    });
  }
}

function entryFromRow(row: Row): ContextEntry {
  return {
    sequence: rowNumber(row, "sequence"),
    message: JSON.parse(rowText(row, "data")) as Message,
  };
}

function checkpointFromRow(row: Row): ContextCheckpoint {
  return {
    id: rowText(row, "id"),
    threadId: rowText(row, "thread_id"),
    throughSequence: rowNumber(row, "through_sequence"),
    createdAfterSequence: rowNumber(row, "created_after_sequence"),
    summary: rowText(row, "summary"),
    sourceCharacters: rowNumber(row, "source_characters"),
    summaryCharacters: rowNumber(row, "summary_characters"),
    model: rowText(row, "model"),
    createdAt: rowNumber(row, "created_at"),
    appliedAt: rowOptionalNumber(row, "applied_at"),
    injectedCharacters: rowOptionalNumber(row, "injected_characters"),
    appliedThroughSequence: rowOptionalNumber(row, "applied_through_sequence"),
  };
}

function rowText(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Invalid database value: ${key}`);
  return value;
}

function rowNumber(row: Row, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`Invalid database value: ${key}`);
}

function rowOptionalNumber(row: Row, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`Invalid database value: ${key}`);
}
