import { createClient, type Client, type Row, type InStatement } from "@libsql/client/sqlite3";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Message } from "../protocol.js";
import type { ThreadSubagentMode } from "../agent/subagents/profile.js";
import type { PlanItem } from "../tools/plan.js";
import type { ReasoningEffort } from "../providers/provider.js";
import { ContextStore } from "../context/store.js";
import type {
  DesktopEntry,
  DesktopSearchResult,
  DesktopThread,
  DesktopWorkspace,
  GitWalkthroughResult,
} from "./api.js";
import { AsideStore } from "./aside-store.js";
import { SavedMessageStore } from "./saved-messages-store.js";
import type { SandboxAccessGrant, SandboxAccessInput } from "../execution/access.js";

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
  readonly asides: AsideStore;
  readonly savedMessages: SavedMessageStore;
  readonly context: ContextStore;

  constructor(private readonly database: Client) {
    this.asides = new AsideStore(database);
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
          model TEXT,
          provider_connection_id TEXT NOT NULL DEFAULT 'openrouter',
          reasoning_effort TEXT NOT NULL DEFAULT '',
          bookmarked INTEGER NOT NULL DEFAULT 0,
          source_thread_id TEXT,
          source_entry_id TEXT,
          branch_label TEXT,
          subagent_mode TEXT NOT NULL DEFAULT 'inherit',
          active_plan TEXT,
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
        `CREATE TRIGGER IF NOT EXISTS entries_search_update AFTER UPDATE OF text ON entries BEGIN
          INSERT INTO entries_search(entries_search, rowid, text)
          VALUES ('delete', old.rowid, old.text);
          INSERT INTO entries_search(rowid, text) VALUES (new.rowid, new.text);
        END`,
        `CREATE TABLE IF NOT EXISTS app_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS sandbox_access (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL,
          target_id TEXT NOT NULL,
          path TEXT NOT NULL,
          writable INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(scope, target_id, path)
        )`,
        `CREATE TABLE IF NOT EXISTS git_walkthroughs (
          workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
          data TEXT NOT NULL
        )`,
      ],
      "write",
    );
    const threadColumns = new Set(
      (await this.database.execute("PRAGMA table_info(threads)"))
        .rows.map((row) => rowText(row, "name")),
    );
    if (!threadColumns.has("draft")) {
      await this.database.execute("ALTER TABLE threads ADD COLUMN draft TEXT NOT NULL DEFAULT ''");
    }
    if (!threadColumns.has("model")) {
      await this.database.execute("ALTER TABLE threads ADD COLUMN model TEXT");
    }
    if (!threadColumns.has("provider_connection_id")) {
      await this.database.execute(
        "ALTER TABLE threads ADD COLUMN provider_connection_id TEXT NOT NULL DEFAULT 'openrouter'",
      );
    }
    if (!threadColumns.has("reasoning_effort")) {
      await this.database.execute(
        "ALTER TABLE threads ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT ''",
      );
    }
    if (!threadColumns.has("source_thread_id")) {
      await this.database.execute("ALTER TABLE threads ADD COLUMN source_thread_id TEXT");
    }
    if (!threadColumns.has("source_entry_id")) {
      await this.database.execute("ALTER TABLE threads ADD COLUMN source_entry_id TEXT");
    }
    if (!threadColumns.has("branch_label")) {
      await this.database.execute("ALTER TABLE threads ADD COLUMN branch_label TEXT");
    }
    if (!threadColumns.has("subagent_mode")) {
      await this.database.execute(
        "ALTER TABLE threads ADD COLUMN subagent_mode TEXT NOT NULL DEFAULT 'inherit'",
      );
    }
    if (!threadColumns.has("active_plan")) {
      await this.database.execute("ALTER TABLE threads ADD COLUMN active_plan TEXT");
    }
    await this.database.execute("PRAGMA foreign_keys = ON");
    await this.asides.initialize();
    const searchVersion = await this.database.execute({
      sql: "SELECT value FROM app_state WHERE key = ?",
      args: ["search_index_version"],
    });
    if (rowOptionalText(searchVersion.rows[0], "value") !== "1") {
      await this.database.batch(
        [
          "INSERT INTO entries_search(entries_search) VALUES ('rebuild')",
          stateStatement("search_index_version", "1"),
        ],
        "write",
      );
    }
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

  async gitWalkthrough(workspaceId: string): Promise<GitWalkthroughResult | null> {
    const result = await this.database.execute({
      sql: "SELECT data FROM git_walkthroughs WHERE workspace_id = ?",
      args: [workspaceId],
    });
    return result.rows[0]
      ? JSON.parse(rowText(result.rows[0], "data")) as GitWalkthroughResult
      : null;
  }

  async saveGitWalkthrough(workspaceId: string, result: GitWalkthroughResult): Promise<void> {
    await this.database.execute({
      sql: `INSERT INTO git_walkthroughs(workspace_id, data) VALUES (?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET data = excluded.data`,
      args: [workspaceId, JSON.stringify(result)],
    });
  }

  async sandboxAccess(workspaceId: string, threadId: string): Promise<SandboxAccessGrant[]> {
    const result = await this.database.execute({
      sql: `SELECT id, scope, path, writable FROM sandbox_access
        WHERE (scope = 'workspace' AND target_id = ?)
          OR (scope = 'thread' AND target_id = ?)
        ORDER BY created_at`,
      args: [workspaceId, threadId],
    });
    return result.rows.map((row) => ({
      id: rowText(row, "id"),
      scope: rowText(row, "scope") === "thread" ? "thread" : "workspace",
      path: rowText(row, "path"),
      writable: rowNumber(row, "writable") === 1,
    }));
  }

  async addSandboxAccess(
    workspaceId: string,
    threadId: string,
    input: SandboxAccessInput,
  ): Promise<void> {
    const targetId = input.scope === "thread" ? threadId : workspaceId;
    await this.database.execute({
      sql: `INSERT INTO sandbox_access(id, scope, target_id, path, writable, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(scope, target_id, path) DO UPDATE SET writable = excluded.writable`,
      args: [randomUUID(), input.scope, targetId, input.path, input.writable ? 1 : 0, Date.now()],
    });
  }

  async removeSandboxAccess(workspaceId: string, threadId: string, grantId: string): Promise<void> {
    await this.database.execute({
      sql: `DELETE FROM sandbox_access WHERE id = ? AND (
        (scope = 'workspace' AND target_id = ?) OR
        (scope = 'thread' AND target_id = ?)
      )`,
      args: [grantId, workspaceId, threadId],
    });
  }

  async repairLegacyBlankThreadProviders(model: string, providerConnectionId: string): Promise<void> {
    if (!model || providerConnectionId === "openrouter") return;
    const migration = await this.database.execute({
      sql: "SELECT value FROM app_state WHERE key = ?",
      args: ["blank_thread_provider_v1"],
    });
    if (migration.rows[0]) return;
    await this.database.batch(
      [
        {
          sql: `UPDATE threads SET provider_connection_id = ?
            WHERE provider_connection_id = 'openrouter' AND model = ? AND draft = ''
              AND NOT EXISTS (SELECT 1 FROM entries WHERE entries.thread_id = threads.id)`,
          args: [providerConnectionId, model],
        },
        stateStatement("blank_thread_provider_v1", "1"),
      ],
      "write",
    );
  }

  async addWorkspace(
    workspacePath: string,
    name: string,
    model?: string,
    providerConnectionId = "openrouter",
  ): Promise<void> {
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

    const threadId = await this.ensureThread(workspaceId, model, providerConnectionId);
    await this.setActive(workspaceId, threadId);
  }

  async selectWorkspace(
    workspaceId: string,
    model?: string,
    providerConnectionId = "openrouter",
  ): Promise<void> {
    await this.requireWorkspace(workspaceId);
    const threadId = await this.ensureThread(workspaceId, model, providerConnectionId);
    await this.setActive(workspaceId, threadId);
  }

  async createThread(
    workspaceId: string,
    model?: string,
    providerConnectionId = "openrouter",
  ): Promise<void> {
    await this.requireWorkspace(workspaceId);
    const count = await this.database.execute({
      sql: "SELECT COUNT(*) AS count FROM threads WHERE workspace_id = ?",
      args: [workspaceId],
    });
    const threadId = randomUUID();
    const now = Date.now();
    const number = rowNumber(count.rows[0], "count") + 1;
    await this.database.execute({
      sql: `INSERT INTO threads(
          id, workspace_id, title, model, provider_connection_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [threadId, workspaceId, `Thread ${number}`, model ?? null, providerConnectionId, now, now],
    });
    await this.setActive(workspaceId, threadId);
  }

  async forkThread(
    sourceThreadId: string,
    throughSequence: number,
    branchLabel?: string,
    fallbackModel?: string,
    fallbackProviderConnectionId = "openrouter",
  ): Promise<void> {
    const source = await this.database.execute({
      sql: `SELECT t.workspace_id, t.title, t.model, t.provider_connection_id, t.reasoning_effort,
          t.subagent_mode,
          e.id AS source_entry_id
        FROM threads t
        JOIN entries e ON e.thread_id = t.id
        WHERE t.id = ? AND e.sequence = ? AND e.role IN ('user', 'assistant')`,
      args: [sourceThreadId, throughSequence],
    });
    const sourceRow = source.rows[0];
    if (!sourceRow) throw new Error("The message is no longer available to fork");

    const entries = await this.database.execute({
      sql: `SELECT sequence, role, text, data, created_at
        FROM entries WHERE thread_id = ? AND sequence <= ? ORDER BY sequence`,
      args: [sourceThreadId, throughSequence],
    });
    const threadId = randomUUID();
    const workspaceId = rowText(sourceRow, "workspace_id");
    const label = branchLabel?.trim() || null;
    const title = label || forkTitle(rowText(sourceRow, "title"));
    const now = Date.now();
    await this.database.batch(
      [
        {
          sql: `INSERT INTO threads(
              id, workspace_id, title, model, provider_connection_id, reasoning_effort,
              source_thread_id, source_entry_id, branch_label,
              subagent_mode,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            threadId,
            workspaceId,
            title,
            rowOptionalText(sourceRow, "model") ?? fallbackModel ?? null,
            rowOptionalText(sourceRow, "provider_connection_id") ?? fallbackProviderConnectionId,
            rowOptionalText(sourceRow, "reasoning_effort") ?? "",
            sourceThreadId,
            rowText(sourceRow, "source_entry_id"),
            label,
            rowText(sourceRow, "subagent_mode"),
            now,
            now,
          ],
        },
        ...entries.rows.map((entry) => ({
          sql: `INSERT INTO entries(id, thread_id, sequence, role, text, data, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            randomUUID(),
            threadId,
            rowNumber(entry, "sequence"),
            rowText(entry, "role"),
            rowText(entry, "text"),
            rowText(entry, "data"),
            rowNumber(entry, "created_at"),
          ],
        })),
      ],
      "write",
    );
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

  async setThreadBranchLabel(threadId: string, label: string): Promise<void> {
    const result = await this.database.execute({
      sql: `UPDATE threads SET title = ?, branch_label = ?
        WHERE id = ? AND source_thread_id IS NOT NULL`,
      args: [label, label, threadId],
    });
    if (result.rowsAffected === 0) throw new Error("Fork no longer exists");
  }

  async setDraft(threadId: string, draft: string): Promise<void> {
    const result = await this.database.execute({
      sql: "UPDATE threads SET draft = ? WHERE id = ?",
      args: [draft, threadId],
    });
    if (result.rowsAffected === 0) throw new Error("Thread no longer exists");
  }

  async setThreadSubagentMode(threadId: string, mode: ThreadSubagentMode): Promise<void> {
    const result = await this.database.execute({
      sql: "UPDATE threads SET subagent_mode = ? WHERE id = ?",
      args: [mode, threadId],
    });
    if (result.rowsAffected === 0) throw new Error("Thread no longer exists");
  }

  async threadSubagentMode(threadId: string): Promise<ThreadSubagentMode> {
    const result = await this.database.execute({
      sql: "SELECT subagent_mode FROM threads WHERE id = ?",
      args: [threadId],
    });
    const row = result.rows[0];
    if (!row) throw new Error("Thread no longer exists");
    const mode = rowText(row, "subagent_mode");
    return mode === "enabled" || mode === "disabled" ? mode : "inherit";
  }

  async setThreadModel(
    threadId: string,
    providerConnectionId: string,
    model: string,
    reasoningEffort: ReasoningEffort | "" = "",
  ): Promise<void> {
    const result = await this.database.execute({
      sql: `UPDATE threads SET provider_connection_id = ?, model = ?, reasoning_effort = ?
        WHERE id = ?`,
      args: [providerConnectionId, model, reasoningEffort, threadId],
    });
    if (result.rowsAffected === 0) throw new Error("Thread no longer exists");
  }

  async activePlan(threadId: string): Promise<PlanItem[] | null> {
    const result = await this.database.execute({
      sql: "SELECT active_plan FROM threads WHERE id = ?",
      args: [threadId],
    });
    const value = rowOptionalText(result.rows[0], "active_plan");
    return value ? JSON.parse(value) as PlanItem[] : null;
  }

  async setActivePlan(threadId: string, items: PlanItem[] | null): Promise<void> {
    const result = await this.database.execute({
      sql: "UPDATE threads SET active_plan = ? WHERE id = ?",
      args: [items ? JSON.stringify(items) : null, threadId],
    });
    if (result.rowsAffected === 0) throw new Error("Thread no longer exists");
  }

  async deleteThreads(threadIds: string[]): Promise<void> {
    if (threadIds.length === 0) return;
    const current = await this.state();
    const placeholders = threadIds.map(() => "?").join(", ");
    await this.database.batch([
      {
        sql: `DELETE FROM sandbox_access WHERE scope = 'thread' AND target_id IN (${placeholders})`,
        args: threadIds,
      },
      {
        sql: `DELETE FROM threads WHERE id IN (${placeholders})`,
        args: threadIds,
      },
    ], "write");

    if (!current.activeThreadId || !threadIds.includes(current.activeThreadId)) return;
    if (!current.activeWorkspaceId) return;
    const nextThreadId = await this.ensureThread(current.activeWorkspaceId);
    await this.setActive(current.activeWorkspaceId, nextThreadId);
  }

  async removeWorkspace(workspaceId: string): Promise<void> {
    const current = await this.state();
    await this.database.batch([
      {
        sql: `DELETE FROM sandbox_access WHERE scope = 'thread'
          AND target_id IN (SELECT id FROM threads WHERE workspace_id = ?)`,
        args: [workspaceId],
      },
      {
        sql: "DELETE FROM sandbox_access WHERE scope = 'workspace' AND target_id = ?",
        args: [workspaceId],
      },
      { sql: "DELETE FROM workspaces WHERE id = ?", args: [workspaceId] },
    ], "write");
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

  async searchConversations(query: string, limit = 50): Promise<DesktopSearchResult[]> {
    const expression = searchExpression(query);
    if (!expression) return [];
    const result = await this.database.execute({
      sql: `SELECT e.id AS entry_id, e.sequence, e.role,
          snippet(entries_search, 0, '', '', ' … ', 32) AS excerpt,
          t.id AS thread_id, t.title AS thread_title,
          w.id AS workspace_id, w.name AS workspace_name
        FROM entries_search
        JOIN entries e ON e.rowid = entries_search.rowid
        JOIN threads t ON t.id = e.thread_id
        JOIN workspaces w ON w.id = t.workspace_id
        WHERE entries_search MATCH ? AND e.role IN ('user', 'assistant')
        ORDER BY bm25(entries_search), e.created_at DESC
        LIMIT ?`,
      args: [expression, limit],
    });
    return result.rows.map((row) => ({
      entryId: rowText(row, "entry_id"),
      workspaceId: rowText(row, "workspace_id"),
      workspaceName: rowText(row, "workspace_name"),
      threadId: rowText(row, "thread_id"),
      threadTitle: rowText(row, "thread_title"),
      sequence: rowNumber(row, "sequence"),
      role: rowText(row, "role") as "user" | "assistant",
      excerpt: rowText(row, "excerpt"),
    }));
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
    const firstTask = message.role === "user" && !message.internal
      ? message.content.trim().replace(/\s+/g, " ")
      : "";
    const title = firstTask && firstTask.length > 48 ? `${firstTask.slice(0, 47)}…` : firstTask;
    await this.database.batch(
      [
        {
          sql: `INSERT INTO entries(id, thread_id, sequence, role, text, data, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(thread_id, sequence) DO UPDATE SET
              role = excluded.role, text = excluded.text, data = excluded.data`,
          args: [
            randomUUID(),
            threadId,
            sequence,
            message.role === "user" && message.internal ? "internal" : message.role,
            message.content,
            JSON.stringify(message),
            now,
          ],
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

  async setGeneratedThreadTitle(threadId: string, currentTitle: string, title: string): Promise<boolean> {
    const result = await this.database.execute({
      sql: "UPDATE threads SET title = ? WHERE id = ? AND title = ? AND branch_label IS NULL",
      args: [title, threadId, currentTitle],
    });
    return result.rowsAffected > 0;
  }

  async restoreThread(threadId: string, sequence: number): Promise<void> {
    const result = await this.database.execute({
      sql: "SELECT data FROM entries WHERE thread_id = ? AND sequence = ?",
      args: [threadId, sequence],
    });
    const message = result.rows[0]
      ? JSON.parse(rowText(result.rows[0], "data")) as Message
      : null;
    if (message?.role !== "user" || message.internal) {
      throw new Error("The restore point is no longer available");
    }

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
          sql: "UPDATE threads SET draft = ?, active_plan = NULL, updated_at = ? WHERE id = ?",
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

  async systemInstructions(threadId: string | null): Promise<string[]> {
    if (!threadId) return [];
    const result = await this.database.execute({
      sql: "SELECT data FROM entries WHERE thread_id = ? AND role = 'system' ORDER BY sequence",
      args: [threadId],
    });
    return result.rows.flatMap((row) => {
      const message = JSON.parse(rowText(row, "data")) as Message;
      return message.role === "system" ? [message.content] : [];
    });
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
    const firstTask = messages.find((message) => message.role === "user" && !message.internal)?.content
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
          message.role === "user" && message.internal ? "internal" : message.role,
          message.content,
          JSON.stringify(message),
          now,
        ],
      })),
      {
        sql: `UPDATE threads
          SET title = CASE WHEN title GLOB 'Thread [0-9]*' AND ? IS NOT NULL THEN ? ELSE title END,
              draft = '',
              active_plan = NULL,
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

  private async ensureThread(
    workspaceId: string,
    model?: string,
    providerConnectionId = "openrouter",
  ): Promise<string> {
    const existing = await this.database.execute({
      sql: "SELECT id FROM threads WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 1",
      args: [workspaceId],
    });
    if (existing.rows[0]) return rowText(existing.rows[0], "id");

    const threadId = randomUUID();
    const now = Date.now();
    await this.database.execute({
      sql: `INSERT INTO threads(
          id, workspace_id, title, model, provider_connection_id, created_at, updated_at
        ) VALUES (?, ?, 'Thread 1', ?, ?, ?, ?)`,
      args: [threadId, workspaceId, model ?? null, providerConnectionId, now, now],
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
    model: rowOptionalText(row, "model"),
    providerConnectionId: rowText(row, "provider_connection_id"),
    reasoningEffort: reasoningEffort(rowOptionalText(row, "reasoning_effort")),
    bookmarked: rowNumber(row, "bookmarked") === 1,
    sourceThreadId: rowOptionalText(row, "source_thread_id"),
    sourceEntryId: rowOptionalText(row, "source_entry_id"),
    branchLabel: rowOptionalText(row, "branch_label"),
    subagentMode: threadMode(rowText(row, "subagent_mode")),
    updatedAt: rowNumber(row, "updated_at"),
  };
}

function reasoningEffort(value: string | null): ReasoningEffort | "" {
  return value === "none" || value === "minimal" || value === "low" || value === "medium" ||
    value === "high" || value === "xhigh" || value === "max" ? value : "";
}

function threadMode(value: string): ThreadSubagentMode {
  return value === "enabled" || value === "disabled" ? value : "inherit";
}

function forkTitle(title: string): string {
  const suffix = " · fork";
  return `${title.slice(0, 48 - suffix.length)}${suffix}`;
}

function searchExpression(query: string): string {
  return (query.match(/[\p{L}\p{N}_]+/gu) ?? [])
    .slice(0, 12)
    .map((token) => `${token}*`)
    .join(" AND ");
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

function rowOptionalText(row: Row | undefined, key: string): string | null {
  const value = row?.[key];
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  throw new Error(`Invalid database value: ${key}`);
}
