import { exec, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { rgPath } from "@vscode/ripgrep";
import { PROJECT } from "../identity.js";
import { hostEnvironmentDescription, runRestrictedCommand } from "./native/sandbox.js";
import type { CommandApprovalDecision } from "../protocol.js";
import { personalSnaffleDirectory, type SandboxAccess } from "./access.js";

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
  timedOut?: boolean;
  approval?: Exclude<CommandApprovalDecision, "deny">;
};

export type CommandApprovalRequest = {
  command: string;
  cwd: string;
  reason: string;
  suggestedPaths?: string[];
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
  private sandboxTemporary: Promise<string> | undefined;

  constructor(
    root: string,
    private commandExecution: CommandExecution,
    private readonly approveCommand?: CommandApproval,
    private sandboxAccess: SandboxAccess[] = [],
  ) {
    this.root = realpathSync(path.resolve(root));
    const commandBoundary = commandExecution === "restricted"
      ? "Shell commands can modify the workspace but cannot access personal host files, Git metadata, or the network."
      : commandExecution === "unsafe"
        ? "Shell commands have the host user's normal access."
        : "Shell commands are disabled.";
    const extraAccess = sandboxAccess.length
      ? ` Additional shell access: ${sandboxAccess.map((entry) =>
          `${entry.writable ? "read and write" : "read only"} ${entry.path}`).join("; ")}.`
      : "";
    const temporary = commandExecution === "restricted"
      ? " Use $TMPDIR for temporary work; it persists for this run and is removed afterward."
      : "";
    this.environment = `${hostEnvironmentDescription()} ${commandBoundary}${extraAccess}${temporary}`;
  }

  grantSandboxAccess(access: SandboxAccess): void {
    this.sandboxAccess = [
      ...this.sandboxAccess.filter((entry) => entry.path !== access.path),
      access,
    ];
  }

  async close(): Promise<void> {
    if (!this.sandboxTemporary) return;
    const temporary = await this.sandboxTemporary;
    this.sandboxTemporary = undefined;
    await rm(temporary, { recursive: true, force: true });
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
        : await runRestrictedCommand(
            command,
            this.root,
            commandCwd,
            timeoutMs,
            signal,
            this.sandboxAccess,
            await this.temporaryDirectory(),
          );
      if (!result.permissionDenied || !this.approveCommand) return result;

      signal?.throwIfAborted();
      const decision = await this.approveCommand({
        command,
        cwd: this.relative(commandCwd) || ".",
        reason: result.stderr,
        ...await this.suggestedSandboxPaths(command),
      });
      signal?.throwIfAborted();
      if (decision === "deny") {
        return { ...result, stderr: `${result.stderr}\nUnrestricted retry denied by the user.` };
      }
      if (decision === "sandbox") {
        const retried = await runRestrictedCommand(
          command,
          this.root,
          commandCwd,
          timeoutMs,
          signal,
          this.sandboxAccess,
          await this.temporaryDirectory(),
        );
        return { ...retried, approval: decision };
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
        ...(error.killed ? { timedOut: true } : {}),
      };
    }
  }

  private async suggestedSandboxPaths(command: string): Promise<{ suggestedPaths?: string[] }> {
    const candidates = literalAbsolutePaths(command);
    const folders: Array<{ path: string; canonical: string }> = [];
    for (const candidate of candidates) {
      try {
        const resolved = await realpath(candidate);
        const details = await stat(resolved);
        const canonical = details.isDirectory() ? resolved : path.dirname(resolved);
        if (inside(this.root, canonical) || this.sandboxAccess.some((entry) => inside(entry.path, canonical))) continue;
        if (folders.some((entry) => entry.canonical === canonical)) continue;
        folders.push({
          path: details.isDirectory() ? path.normalize(candidate) : path.dirname(path.normalize(candidate)),
          canonical,
        });
      } catch {
        // Only suggest an existing path that can be confirmed before approval.
      }
    }
    const suggestedPaths = folders
      .filter((folder) => !folders.some((other) => other !== folder && inside(other.canonical, folder.canonical)))
      .slice(0, 8)
      .map((folder) => folder.path);
    return suggestedPaths.length ? { suggestedPaths } : {};
  }

  private temporaryDirectory(): Promise<string> {
    this.sandboxTemporary ??= mkdtemp(path.join(tmpdir(), "snaffle-sandbox-"));
    return this.sandboxTemporary;
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
    this.assertWritable(target, input);

    try {
      const actual = await realpath(target);
      this.assertInside(actual, input);
      this.assertWritable(actual, input);
      return target;
    } catch (error) {
      if (!isMissingPath(error)) throw error;
    }

    let existing = path.dirname(target);
    while (true) {
      try {
        const actual = await realpath(existing);
        this.assertInside(actual, input);
        this.assertWritable(actual, input);
        break;
      } catch (error) {
        if (!isMissingPath(error)) throw error;
        const parent = path.dirname(existing);
        if (parent === existing) throw error;
        existing = parent;
      }
    }

    await mkdir(path.dirname(target), { recursive: true });
    const parent = await realpath(path.dirname(target));
    this.assertInside(parent, input);
    this.assertWritable(parent, input);
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

  private assertWritable(resolved: string, input: string): void {
    const relative = path.relative(personalSnaffleDirectory(), resolved);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
      throw new Error(`Personal ${PROJECT.name} configuration cannot be changed through file tools: ${input}`);
    }
  }

  private relative(input: string): string {
    return path.relative(this.root, input);
  }
}

function literalAbsolutePaths(command: string): string[] {
  return (command.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [])
    .map((token) => token.replace(/^["'(<]+|["'),;>]+$/g, ""))
    .filter((token) => path.isAbsolute(token));
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

type ProcessError = Error & {
  code?: number | string;
  killed?: boolean;
  stdout?: string;
  stderr?: string;
};

function isProcessError(error: unknown): error is ProcessError {
  return error instanceof Error;
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
