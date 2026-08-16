import { exec, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { chmod, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { rgPath } from "@vscode/ripgrep";
import { PROJECT } from "../identity.js";
import { hostEnvironmentDescription, runRestrictedCommand } from "./native/sandbox.js";
import type { CommandApprovalDecision } from "../protocol.js";

const execAsync = promisify(exec);
const ripgrepExecutable = rgPath.replace(
  /([\\/])app\.asar([\\/])/,
  "$1app.asar.unpacked$2",
);

export type SearchOptions = {
  path?: string;
  glob?: string;
  maxResults: number;
};

export type CommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  approval?: Exclude<CommandApprovalDecision, "deny">;
};

export type CommandApprovalRequest = {
  command: string;
  cwd: string;
  reason: string;
};

export type CommandApproval = (
  request: CommandApprovalRequest,
) => Promise<CommandApprovalDecision>;

export interface Workspace {
  readonly root?: string;
  readonly environment: string;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  search(query: string, options: SearchOptions, signal?: AbortSignal): Promise<string[]>;
  run(command: string, cwd: string | undefined, timeoutMs: number, network?: boolean, signal?: AbortSignal): Promise<CommandResult>;
}

export type CommandExecution = "disabled" | "restricted" | "unsafe";

export class LocalWorkspace implements Workspace {
  readonly root: string;
  readonly environment: string;

  constructor(
    root: string,
    private commandExecution: CommandExecution,
    private readonly approveCommand?: CommandApproval,
  ) {
    this.root = realpathSync(path.resolve(root));
    const commandBoundary = commandExecution === "restricted"
      ? "Shell commands can modify the workspace but cannot access personal host files, Git metadata, or the network."
      : commandExecution === "unsafe"
        ? "Shell commands have the host user's normal access."
        : "Shell commands are disabled.";
    this.environment = `${hostEnvironmentDescription()} ${commandBoundary}`;
  }

  async read(filePath: string): Promise<string> {
    return readFile(await this.resolveExisting(filePath), "utf8");
  }

  async write(filePath: string, content: string): Promise<void> {
    const target = await this.resolveWrite(filePath);

    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, content, "utf8");

    try {
      const mode = (await stat(target)).mode;
      await chmod(temporary, mode);
    } catch {
      // New files have no mode to preserve.
    }

    await rename(temporary, target);
  }

  async search(query: string, options: SearchOptions, signal?: AbortSignal): Promise<string[]> {
    const searchPath = this.relative(await this.resolveExisting(options.path ?? "."));
    const args = [
      "--line-number", "--no-heading", "--color", "never",
      "--max-columns", "1000", "--max-columns-preview",
    ];

    if (options.glob) args.push("--glob", options.glob);
    args.push(query, searchPath || ".");

    return new Promise((resolve, reject) => {
      const child = spawn(ripgrepExecutable, args, { cwd: this.root, signal });
      const matches: string[] = [];
      let pending = "";
      let errorOutput = "";
      let stopped = false;

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        const lines = `${pending}${chunk}`.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (line) matches.push(line);
          if (matches.length >= options.maxResults) {
            stopped = true;
            child.kill();
            break;
          }
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => { errorOutput += chunk; });
      child.once("error", reject);
      child.once("close", (code) => {
        if (!stopped && pending && matches.length < options.maxResults) matches.push(pending);
        if (stopped || code === 0 || code === 1) resolve(matches);
        else reject(new Error(errorOutput.trim() || `ripgrep exited ${code}`));
      });
    });
  }

  async run(
    command: string,
    cwd: string | undefined,
    timeoutMs: number,
    network = false,
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    signal?.throwIfAborted();
    if (this.commandExecution === "disabled") {
      throw new Error("Host command execution is disabled");
    }

    const commandCwd = await this.resolveExisting(cwd ?? ".");

    if (this.commandExecution === "restricted") {
      const result = network
        ? {
            exitCode: null,
            stdout: "",
            stderr: "This command requests network access, which is unavailable in restricted execution.",
            permissionDenied: true,
          }
        : await runRestrictedCommand(command, this.root, commandCwd, timeoutMs, signal);
      if (!result.permissionDenied || !this.approveCommand) return result;

      signal?.throwIfAborted();
      const decision = await this.approveCommand({
        command,
        cwd: this.relative(commandCwd) || ".",
        reason: result.stderr,
      });
      signal?.throwIfAborted();
      if (decision === "deny") {
        return { ...result, stderr: `${result.stderr}\nUnrestricted retry denied by the user.` };
      }
      if (decision === "thread") this.commandExecution = "unsafe";
      const retried = await this.runUnsafe(command, commandCwd, timeoutMs, signal);
      return { ...retried, approval: decision };
    }

    return this.runUnsafe(command, commandCwd, timeoutMs, signal);
  }

  private async runUnsafe(
    command: string,
    commandCwd: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: commandCwd,
        timeout: timeoutMs,
        maxBuffer: 512 * 1024,
        signal,
      });
      return { exitCode: 0, stdout, stderr };
    } catch (error) {
      if (!isProcessError(error)) throw error;
      return {
        exitCode: typeof error.code === "number" ? error.code : null,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? error.message,
      };
    }
  }

  private resolve(input: string): string {
    const resolved = path.resolve(this.root, input);
    if (!path.isAbsolute(input)) {
      const relative = path.relative(this.root, resolved);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Path leaves the workspace: ${input}`);
      }
    }

    // Canonical checks in resolveExisting and resolveWrite handle absolute path aliases and symlinks.
    return resolved;
  }

  private async resolveExisting(input: string): Promise<string> {
    const resolved = this.resolve(input);
    const actual = await realpath(resolved);
    this.assertInside(actual, input);
    return actual;
  }

  private async resolveWrite(input: string): Promise<string> {
    const target = this.resolve(input);

    try {
      this.assertInside(await realpath(target), input);
      return target;
    } catch (error) {
      if (!isMissingPath(error)) throw error;
    }

    let existing = path.dirname(target);
    while (true) {
      try {
        this.assertInside(await realpath(existing), input);
        break;
      } catch (error) {
        if (!isMissingPath(error)) throw error;
        const parent = path.dirname(existing);
        if (parent === existing) throw error;
        existing = parent;
      }
    }

    await mkdir(path.dirname(target), { recursive: true });
    this.assertInside(await realpath(path.dirname(target)), input);
    return target;
  }

  private assertInside(resolved: string, input: string): void {
    const relative = path.relative(this.root, resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Path leaves the workspace: ${input}`);
    }
    if (relative.split(path.sep).includes(".git")) {
      throw new Error(`Git metadata is managed by ${PROJECT.name} and cannot be accessed through file tools`);
    }
  }

  private relative(input: string): string {
    return path.relative(this.root, input);
  }
}

type ProcessError = Error & {
  code?: number | string;
  stdout?: string;
  stderr?: string;
};

function isProcessError(error: unknown): error is ProcessError {
  return error instanceof Error;
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
