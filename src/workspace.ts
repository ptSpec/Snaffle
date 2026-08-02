import { exec, execFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { rgPath } from "@vscode/ripgrep";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export type SearchOptions = {
  path?: string;
  glob?: string;
  maxResults: number;
};

export type CommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export interface Workspace {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  search(query: string, options: SearchOptions): Promise<string[]>;
  run(command: string, cwd: string | undefined, timeoutMs: number): Promise<CommandResult>;
}

export class LocalWorkspace implements Workspace {
  readonly root: string;

  constructor(root: string, private readonly allowCommands: boolean) {
    this.root = path.resolve(root);
  }

  async read(filePath: string): Promise<string> {
    return readFile(this.resolve(filePath), "utf8");
  }

  async write(filePath: string, content: string): Promise<void> {
    const target = this.resolve(filePath);
    await mkdir(path.dirname(target), { recursive: true });

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

  async search(query: string, options: SearchOptions): Promise<string[]> {
    const searchPath = this.relative(this.resolve(options.path ?? "."));
    const args = ["--line-number", "--no-heading", "--color", "never"];

    if (options.glob) args.push("--glob", options.glob);
    args.push(query, searchPath || ".");

    try {
      const { stdout } = await execFileAsync(rgPath, args, {
        cwd: this.root,
        maxBuffer: 512 * 1024,
      });
      return stdout.split("\n").filter(Boolean).slice(0, options.maxResults);
    } catch (error) {
      if (isProcessError(error) && error.code === 1) return [];
      throw error;
    }
  }

  async run(
    command: string,
    cwd: string | undefined,
    timeoutMs: number,
  ): Promise<CommandResult> {
    if (!this.allowCommands) {
      throw new Error("Host command execution is disabled");
    }

    const commandCwd = this.resolve(cwd ?? ".");

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: commandCwd,
        timeout: timeoutMs,
        maxBuffer: 512 * 1024,
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
    if (path.isAbsolute(input)) throw new Error("Workspace paths must be relative");

    const resolved = path.resolve(this.root, input);
    const relative = path.relative(this.root, resolved);

    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Path leaves the workspace: ${input}`);
    }

    return resolved;
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
