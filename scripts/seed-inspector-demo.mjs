import { createClient } from "@libsql/client/sqlite3";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEMO_TITLE = "[Demo] Inspector usage stress test";
const turns = readTurnCount(process.argv);
const databasePath = process.env.SNAFFLE_DB_PATH || defaultDatabasePath();
const database = createClient({ url: pathToFileURL(databasePath).href });

try {
  if (process.argv.includes("--remove")) {
    const result = await database.execute({
      sql: "DELETE FROM threads WHERE title = ?",
      args: [DEMO_TITLE],
    });
    console.log(`Removed ${Number(result.rowsAffected)} Inspector stress-test thread(s).`);
    process.exitCode = 0;
  } else {
    const workspaceId = await selectedWorkspaceId(database);
    if (!workspaceId) {
      throw new Error("No Snaffle workspace exists yet. Open one in the app, then run this command again.");
    }

    await database.execute("PRAGMA foreign_keys = ON");
    await database.execute({ sql: "DELETE FROM threads WHERE title = ?", args: [DEMO_TITLE] });

    const threadId = randomUUID();
    const now = Date.now();
    const statements = [
      {
        sql: `INSERT INTO threads(
          id, workspace_id, title, draft, model, provider_connection_id,
          bookmarked, subagent_mode, created_at, updated_at
        ) VALUES (?, ?, ?, '', ?, ?, 0, 'inherit', ?, ?)`,
        args: [threadId, workspaceId, DEMO_TITLE, "deepseek-v4-flash", "deepseek", now, now],
      },
      ...demoEntries(threadId, turns, now),
      {
        sql: `INSERT INTO app_state(key, value) VALUES ('active_workspace_id', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [workspaceId],
      },
      {
        sql: `INSERT INTO app_state(key, value) VALUES ('active_thread_id', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [threadId],
      },
      { sql: "UPDATE workspaces SET updated_at = ? WHERE id = ?", args: [now, workspaceId] },
    ];

    await database.batch(statements, "write");
    console.log(`Created "${DEMO_TITLE}" with ${turns} synthetic turns.`);
    console.log("Restart Snaffle to load it, then open Inspect. No provider requests were made.");
    console.log("Remove it later with: npm run demo:inspector -- --remove");
  }
} finally {
  database.close();
}

function demoEntries(threadId, count, now) {
  const entries = [];
  let sequence = 0;
  const startedAt = now - count * 60_000;

  const append = (message, createdAt) => {
    entries.push({
      sql: `INSERT INTO entries(id, thread_id, sequence, role, text, data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        randomUUID(),
        threadId,
        sequence,
        message.role,
        message.content,
        JSON.stringify(message),
        createdAt,
      ],
    });
    sequence += 1;
  };

  for (let index = 0; index < count; index += 1) {
    const turn = index + 1;
    const createdAt = startedAt + index * 60_000;
    append({ role: "user", content: `Inspector stress-test turn ${turn}: review the next synthetic change.` }, createdAt);

    const hasTool = turn % 4 === 0;
    if (hasTool) {
      const callId = `demo-tool-${turn}`;
      append({
        role: "assistant",
        content: "I’ll inspect the relevant file before answering.",
        model: turn % 8 === 0 ? "deepseek-chat" : "deepseek-v4-flash",
        providerId: "deepseek",
        providerConnectionId: "deepseek",
        toolCalls: [{ id: callId, name: "read", input: { path: `src/demo-${turn}.ts` } }],
        toolNames: ["read"],
        finishReason: "tool_calls",
        durationMs: 420 + turn * 9,
        usage: demoUsage(turn, 0),
      }, createdAt + 1_000);
      append({
        role: "tool",
        toolCallId: callId,
        content: turn % 16 === 0 ? "Synthetic file was not found." : "Synthetic file contents for Inspector layout testing.",
        isError: turn % 16 === 0,
        durationMs: 18 + turn,
      }, createdAt + 2_000);
    }

    append({
      role: "assistant",
      content: `Synthetic response ${turn}. This entry exists only to exercise the Inspector with a long thread.`,
      model: turn % 9 === 0 ? "deepseek-reasoner" : "deepseek-v4-flash",
      providerId: "deepseek",
      providerConnectionId: "deepseek",
      finishReason: "stop",
      durationMs: 650 + (turn % 7) * 310,
      usage: demoUsage(turn, hasTool ? 1 : 0),
    }, createdAt + 3_000);
  }
  return entries;
}

function demoUsage(turn, callIndex) {
  const inputTokens = 1_800 + turn * 1_350 + callIndex * 420;
  const outputTokens = 90 + (turn * 73) % 1_100;
  const cacheRatio = turn === 1 ? 0 : turn % 11 === 0 ? 0.2 : 0.82 + (turn % 4) * 0.04;
  const cachedInputTokens = Math.floor(inputTokens * cacheRatio);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cachedInputTokens,
    reasoningTokens: turn % 9 === 0 ? 300 + turn * 7 : 0,
    costUsd: inputTokens * 0.00000014 + outputTokens * 0.00000028,
  };
}

async function selectedWorkspaceId(client) {
  const active = await client.execute({
    sql: "SELECT value FROM app_state WHERE key = 'active_workspace_id'",
    args: [],
  });
  const activeId = active.rows[0]?.value;
  if (typeof activeId === "string") return activeId;
  const recent = await client.execute("SELECT id FROM workspaces ORDER BY updated_at DESC LIMIT 1");
  return typeof recent.rows[0]?.id === "string" ? recent.rows[0].id : null;
}

function readTurnCount(args) {
  const value = args.find((arg) => arg.startsWith("--turns="))?.slice("--turns=".length);
  if (!value) return 72;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error("--turns must be an integer");
  return Math.max(12, Math.min(250, parsed));
}

function defaultDatabasePath() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Snaffle", "snaffle.db");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Snaffle", "snaffle.db");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "Snaffle", "snaffle.db");
}
