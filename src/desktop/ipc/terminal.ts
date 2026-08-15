import { ipcMain, type BrowserWindow } from "electron";
import { existsSync } from "node:fs";
import * as pty from "node-pty";
import type { DesktopStore } from "../store.js";

const MAX_BUFFER_LENGTH = 200_000;

type TerminalSession = {
  process: pty.IPty;
  output: string;
};

export function registerTerminalIpc(options: {
  store: DesktopStore;
  mainWindow: () => BrowserWindow | undefined;
}): { close(workspaceId: string): void; closeAll(): void } {
  const sessions = new Map<string, TerminalSession>();

  ipcMain.handle("desktop:terminal-open", async (
    _event,
    workspaceValue: unknown,
    columnsValue: unknown,
    rowsValue: unknown,
  ): Promise<void> => {
    const workspaceId = id(workspaceValue);
    const columns = dimension(columnsValue, "columns");
    const rows = dimension(rowsValue, "rows");
    const workspace = (await options.store.state()).workspaces.find(
      (candidate) => candidate.id === workspaceId,
    );
    if (!workspace) throw new Error("Workspace no longer exists");

    const existing = sessions.get(workspaceId);
    if (existing) {
      existing.process.resize(columns, rows);
      send(options.mainWindow(), "desktop:terminal-data", {
        workspaceId,
        data: existing.output,
      });
      return;
    }

    const shell = defaultShell();
    const process = pty.spawn(shell.command, shell.arguments, {
      name: "xterm-256color",
      cols: columns,
      rows,
      cwd: workspace.path,
      env: { ...globalThis.process.env, TERM: "xterm-256color" },
    });
    const session: TerminalSession = { process, output: "" };
    sessions.set(workspaceId, session);

    process.onData((data) => {
      session.output = `${session.output}${data}`.slice(-MAX_BUFFER_LENGTH);
      send(options.mainWindow(), "desktop:terminal-data", { workspaceId, data });
    });
    process.onExit(({ exitCode }) => {
      if (sessions.get(workspaceId) !== session) return;
      sessions.delete(workspaceId);
      send(options.mainWindow(), "desktop:terminal-exit", { workspaceId, exitCode });
    });
  });

  ipcMain.handle("desktop:terminal-write", (
    _event,
    workspaceValue: unknown,
    dataValue: unknown,
  ): void => {
    const session = sessions.get(id(workspaceValue));
    if (!session) throw new Error("Terminal is not running");
    if (typeof dataValue !== "string" || dataValue.length > 65_536) {
      throw new Error("Terminal input must be text no longer than 64 KiB");
    }
    session.process.write(dataValue);
  });

  ipcMain.handle("desktop:terminal-resize", (
    _event,
    workspaceValue: unknown,
    columnsValue: unknown,
    rowsValue: unknown,
  ): void => {
    const session = sessions.get(id(workspaceValue));
    if (!session) return;
    session.process.resize(
      dimension(columnsValue, "columns"),
      dimension(rowsValue, "rows"),
    );
  });

  ipcMain.handle("desktop:terminal-close", (_event, workspaceValue: unknown): void => {
    close(id(workspaceValue));
  });

  function close(workspaceId: string): void {
    const session = sessions.get(workspaceId);
    if (!session) return;
    sessions.delete(workspaceId);
    session.process.kill();
  }

  function closeAll(): void {
    for (const workspaceId of sessions.keys()) close(workspaceId);
  }

  return { close, closeAll };
}

function defaultShell(): { command: string; arguments: string[] } {
  if (process.platform === "win32") {
    return { command: process.env.ComSpec || "cmd.exe", arguments: [] };
  }
  const fallback = process.platform === "darwin"
    ? "/bin/zsh"
    : existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh";
  const command = process.env.SHELL && existsSync(process.env.SHELL)
    ? process.env.SHELL
    : fallback;
  return { command, arguments: ["-l"] };
}

function id(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Workspace ID must be text");
  return value;
}

function dimension(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 2 || Number(value) > 500) {
    throw new Error(`Terminal ${label} must be between 2 and 500`);
  }
  return Number(value);
}

function send(window: BrowserWindow | undefined, channel: string, value: unknown): void {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(channel, value);
}
