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
import { prepareScratchDirectory } from "./scratch.js";

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
  run(command: string, cwd: string | undefined, timeoutMs: number, signal?: AbortSignal): Promise<CommandResult>;
}

export type CommandExecution = "disabled" | "restricted" | "unsafe";
export type RestrictedEngine = "native" | "microsandbox";

type ResolvedWorkspacePath = {
  kind: "workspace" | "temporary";
  base: string;
  path: string;
  relative: string;
};

type SearchLine = {
  path: string;
  line: number;
  text: string;
  match: boolean;
};

export class LocalWorkspace implements Workspace {
  readonly root: string;
  readonly environment: string;
  private sandboxTemporary: Promise<string> | undefined;

  constructor(
    root: string,
    private commandExecution: CommandExecution,
    private readonly approveCommand?: CommandApproval,
    private sandboxAccess: SandboxAccess[] = [],
    private readonly persistentTemporary?: string,
    private readonly sandboxNetworkEnabled = true,
  ) {
    this.root = realpathSync(path.resolve(root));
    const commandBoundary = commandExecution === "restricted"
      ? `Shell commands can modify the workspace and ${sandboxNetworkEnabled ? "use the network" : "cannot use the network"}, but cannot access personal host files or Git metadata.`
      : commandExecution === "unsafe"
        ? "Shell commands have the host user's normal access."
        : "Shell commands are disabled.";
    const extraAccess = sandboxAccess.length
      ? ` Additional shell access: ${sandboxAccess.map((entry) =>
          `${entry.writable ? "read and write" : "read only"} ${entry.path}`).join("; ")}.`
      : "";
    const temporary = persistentTemporary
      ? " $TMPDIR is writable temporary storage for file tools and enabled shell commands. Its contents persist across responses in this thread and may be removed after five days of inactivity; keep anything durable in the workspace."
      : " $TMPDIR is writable temporary storage for file tools and enabled shell commands. Its contents are removed after this run; keep anything durable in the workspace.";
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
    if (this.persistentTemporary) return;
    await rm(temporary, { recursive: true, force: true });
  }

  async read(filePath: string): Promise<string> {
    return readFile((await this.resolveExisting(filePath)).path, "utf8");
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
    const locations = options.path === undefined
      ? await Promise.all([this.resolveExisting("."), this.resolveExisting("$TMPDIR")])
      : [await this.resolveExisting(options.path)];
    const matches = await Promise.all(locations.map((location) =>
      this.searchLocation(query, location, options, signal)));
    return matches.flat().slice(0, options.maxResults);
  }

  private searchLocation(
    query: string,
    location: ResolvedWorkspacePath,
    options: SearchOptions,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const args = [
      "--json", "--context", "2", "--color", "never",
      "--path-separator=/",
      "--max-columns", "1000", "--max-columns-preview",
    ];

    if (options.glob) args.push("--glob", options.glob);
    args.push(query, location.relative || ".");

    return new Promise((resolve, reject) => {
      const child = spawn(ripgrepExecutable, args, { cwd: location.base, signal });
      const matches: Array<{ lines: string[]; after: number }> = [];
      let previous: SearchLine[] = [];
      let previousPath: string | undefined;
      let pending = "";
      let errorOutput = "";
      let parseError: unknown;
      let stopped = false;

      const consume = (output: string): void => {
        const line = parseSearchLine(output);
        if (!line) return;
        if (line.path !== previousPath) {
          previous = [];
          for (const match of matches) match.after = 0;
          previousPath = line.path;
        }

        const context = this.searchResult(location, line, false);
        for (const match of matches) {
          if (match.after > 0) {
            match.lines.push(context);
            match.after -= 1;
          }
        }
        if (line.match && matches.length < options.maxResults) {
          matches.push({
            lines: [
              ...previous.map((entry) => this.searchResult(location, entry, false)),
              this.searchResult(location, line, true),
            ],
            after: 2,
          });
        }

        previous = [...previous.slice(-1), line];
        if (matches.length >= options.maxResults && matches.at(-1)?.after === 0) {
          stopped = true;
          child.kill();
        }
      };

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        const lines = `${pending}${chunk}`.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          try {
            if (line) consume(line);
          } catch (error) {
            parseError = error;
            child.kill();
          }
          if (stopped || parseError) break;
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => { errorOutput += chunk; });
      child.once("error", reject);
      child.once("close", (code) => {
        if (!parseError && pending) {
          try {
            consume(pending);
          } catch (error) {
            parseError = error;
          }
        }
        if (parseError) reject(parseError);
        else if (stopped || code === 0 || code === 1) resolve(matches.map((match) => match.lines.join("\n")));
        else reject(new Error(errorOutput.trim() || `ripgrep exited ${code}`));
      });
    });
  }

  async run(
    command: string,
    cwd: string | undefined,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    signal?.throwIfAborted();
    if (this.commandExecution === "disabled") {
      throw new Error("Host command execution is disabled");
    }

    const commandCwd = await this.resolveExisting(cwd ?? ".");

    if (this.commandExecution === "restricted") {
      const result = await runRestrictedCommand(
        command,
        this.root,
        commandCwd.path,
        timeoutMs,
        signal,
        this.sandboxAccess,
        await this.temporaryDirectory(),
        this.sandboxNetworkEnabled,
      );
      if (!result.permissionDenied || !this.approveCommand) return result;

      signal?.throwIfAborted();
      const decision = await this.approveCommand({
        command,
        cwd: this.logicalPath(commandCwd),
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
          commandCwd.path,
          timeoutMs,
          signal,
          this.sandboxAccess,
          await this.temporaryDirectory(),
          this.sandboxNetworkEnabled,
        );
        return { ...retried, approval: decision };
      }
      if (decision === "response" || decision === "thread") this.commandExecution = "unsafe";
      const retried = await this.runUnsafe(command, commandCwd.path, timeoutMs, signal);
      return { ...retried, approval: decision };
    }

    return this.runUnsafe(command, commandCwd.path, timeoutMs, signal);
  }

  private async runUnsafe(
    command: string,
    commandCwd: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    const temporary = await this.temporaryDirectory();
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: commandCwd,
        env: { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary },
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
    this.sandboxTemporary ??= (this.persistentTemporary
      ? prepareScratchDirectory(this.persistentTemporary)
      : mkdtemp(path.join(tmpdir(), "snaffle-sandbox-")))
      .then((directory) => realpath(directory));
    return this.sandboxTemporary;
  }

  private async resolve(input: string): Promise<ResolvedWorkspacePath> {
    let kind: ResolvedWorkspacePath["kind"] = "workspace";
    let base = this.root;
    let requested = input;
    if (input === "$TMPDIR" || input.startsWith("$TMPDIR/")) {
      kind = "temporary";
      base = await this.temporaryDirectory();
      requested = input === "$TMPDIR" ? "." : input.slice("$TMPDIR/".length);
    } else if (input.startsWith("$") || input.startsWith("~")) {
      throw new Error(`Only $TMPDIR is supported as a logical path prefix: ${input}`);
    }

    const resolved = path.resolve(base, requested);
    if ((kind === "temporary" || !path.isAbsolute(requested)) && !inside(base, resolved)) {
      throw new Error(`Path leaves the ${kind === "temporary" ? "temporary storage" : "workspace"}: ${input}`);
    }
    return { kind, base, path: resolved, relative: path.relative(base, resolved) };
  }

  protected async resolveExisting(input: string): Promise<ResolvedWorkspacePath> {
    const resolved = await this.resolve(input);
    const actual = await realpath(resolved.path);
    this.assertInside(resolved, actual, input);
    return { ...resolved, path: actual, relative: path.relative(resolved.base, actual) };
  }

  private async resolveWrite(input: string): Promise<string> {
    const resolved = await this.resolve(input);
    const target = resolved.path;
    this.assertWritable(resolved, target, input);

    try {
      const actual = await realpath(target);
      this.assertInside(resolved, actual, input);
      this.assertWritable(resolved, actual, input);
      return target;
    } catch (error) {
      if (!isMissingPath(error)) throw error;
    }

    let existing = path.dirname(target);
    while (true) {
      try {
        const actual = await realpath(existing);
        this.assertInside(resolved, actual, input);
        this.assertWritable(resolved, actual, input);
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
    this.assertInside(resolved, parent, input);
    this.assertWritable(resolved, parent, input);
    return target;
  }

  private assertInside(location: ResolvedWorkspacePath, resolved: string, input: string): void {
    const relative = path.relative(location.base, resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Path leaves the ${location.kind === "temporary" ? "temporary storage" : "workspace"}: ${input}`);
    }
    if (location.kind === "workspace" && relative.split(path.sep).includes(".git")) {
      throw new Error(`Git metadata is managed by ${PROJECT.name} and cannot be accessed through file tools`);
    }
  }

  private assertWritable(location: ResolvedWorkspacePath, resolved: string, input: string): void {
    if (location.kind === "temporary") return;
    const relative = path.relative(personalSnaffleDirectory(), resolved);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
      throw new Error(`Personal ${PROJECT.name} configuration cannot be changed through file tools: ${input}`);
    }
  }

  private logicalPath(location: ResolvedWorkspacePath): string {
    const relative = location.relative.split(path.sep).join("/");
    if (location.kind === "temporary") return relative ? `$TMPDIR/${relative}` : "$TMPDIR";
    return relative || ".";
  }

  private searchResult(location: ResolvedWorkspacePath, line: SearchLine, match: boolean): string {
    const relative = line.path.startsWith("./") ? line.path.slice(2) : line.path;
    const logicalPath = location.kind === "temporary" ? `$TMPDIR/${relative}` : relative;
    const separator = match ? ":" : "-";
    return `${logicalPath}${separator}${line.line}${separator}${line.text}`;
  }
}

function parseSearchLine(output: string): SearchLine | undefined {
  const event = JSON.parse(output) as {
    type?: unknown;
    data?: {
      path?: { text?: unknown };
      lines?: { text?: unknown };
      line_number?: unknown;
    };
  };
  if (event.type !== "match" && event.type !== "context") return undefined;
  const filePath = event.data?.path?.text;
  const text = event.data?.lines?.text;
  const line = event.data?.line_number;
  if (typeof filePath !== "string" || typeof text !== "string" || typeof line !== "number") return undefined;
  return {
    path: filePath,
    line,
    text: text.replace(/\r?\n$/, ""),
    match: event.type === "match",
  };
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
