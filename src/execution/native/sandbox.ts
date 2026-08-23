import { spawn } from "node:child_process";
import { constants, accessSync, existsSync, type Dirent } from "node:fs";
import { mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { personalSnaffleDirectory, type SandboxAccess } from "../access.js";

const MACOS_PROFILE = `(version 1)
(deny default)
(import "system.sb")
(allow process-exec)
(allow process-fork)
(allow signal (target same-sandbox))
(allow process-info* (target same-sandbox))
(allow file-read* file-test-existence
  (subpath (param "WORKSPACE"))
  (subpath (param "TEMP"))
  __EXTRA_READ__
  (literal "/opt")
  (literal "/usr/local")
  (literal "/Library")
  (literal "/Applications")
  (subpath "/bin")
  (subpath "/sbin")
  (subpath "/usr/bin")
  (subpath "/usr/sbin")
  (subpath "/usr/local/bin")
  (subpath "/usr/local/sbin")
  (subpath "/usr/local/lib")
  (subpath "/usr/local/Cellar")
  (subpath "/usr/local/opt")
  (subpath "/usr/local/share")
  (subpath "/usr/local/Frameworks")
  (subpath "/opt/homebrew")
  (subpath "/opt/local")
  (subpath "/Library/Developer")
  (subpath "/Library/Frameworks")
  (subpath "/Applications/Xcode.app")
  (subpath "/private/etc")
  (subpath "/private/var/select"))
(allow file-read-metadata
  __WORKSPACE_ANCESTORS__)
(allow file-write* (subpath (param "WORKSPACE")) (subpath (param "TEMP"))
  __EXTRA_WRITE__)
__GIT_METADATA__
(deny file-write* (subpath __PERSONAL_STATE__))
__NETWORK__`;

const RESOURCE_LIMITS = `cpu="$1"
command="$2"
ulimit -c 0
ulimit -t "$cpu"
ulimit -f 2097152
ulimit -n 512
ulimit -v 8388608 2>/dev/null || true
exec /bin/sh -c "$command"`;

let sandboxProbe: Promise<SandboxStatus> | undefined;

export type SandboxStatus = {
  available: boolean;
  detail: string;
};

export type SandboxResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  permissionDenied?: boolean;
};

export function nativeSandboxStatus(): SandboxStatus {
  if (process.platform === "darwin") {
    return existsSync("/usr/bin/sandbox-exec")
      ? { available: true, detail: "macOS Seatbelt" }
      : { available: false, detail: "macOS Seatbelt is unavailable" };
  }

  if (process.platform === "linux") {
    return findExecutable("bwrap")
      ? { available: true, detail: "Linux Bubblewrap" }
      : { available: false, detail: "Install Bubblewrap (bwrap) for restricted execution" };
  }

  return {
    available: false,
    detail: "Restricted host execution is not implemented for native Windows yet",
  };
}

export function probeNativeSandbox(): Promise<SandboxStatus> {
  sandboxProbe ??= probe();
  return sandboxProbe;
}

export function hostEnvironmentDescription(): string {
  const platform =
    process.platform === "darwin"
      ? "macOS"
      : process.platform === "win32"
        ? "Windows"
        : "Linux";
  const shell = process.platform === "win32" ? "PowerShell" : "POSIX shell";
  return `${platform} ${process.arch}, ${shell}. Commands start in the workspace root; relative paths use the workspace.`;
}

export async function runRestrictedCommand(
  command: string,
  workspace: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
  access: SandboxAccess[] = [],
  runTemporary?: string,
  networkEnabled = true,
): Promise<SandboxResult> {
  const status = nativeSandboxStatus();
  if (!status.available) throw new Error(status.detail);

  const temporary = await realpath(runTemporary ?? await mkdtemp(path.join(tmpdir(), "snaffle-sandbox-")));
  await mkdir(path.join(temporary, "home"), { recursive: true });

  try {
    if (process.platform === "darwin") {
      return await runMacos(command, workspace, cwd, timeoutMs, temporary, signal, access, networkEnabled);
    }

    const bubblewrap = findExecutable("bwrap");
    if (!bubblewrap) throw new Error("Install Bubblewrap (bwrap) for restricted execution");
    return await runLinux(bubblewrap, command, workspace, cwd, timeoutMs, temporary, signal, access, networkEnabled);
  } finally {
    if (!runTemporary) await rm(temporary, { recursive: true, force: true });
  }
}

async function runMacos(
  command: string,
  workspace: string,
  cwd: string,
  timeoutMs: number,
  temporary: string,
  signal?: AbortSignal,
  access: SandboxAccess[] = [],
  networkEnabled = true,
): Promise<SandboxResult> {
  const home = path.join(temporary, "home");
  const gitMetadata = await findGitMetadata(workspace);
  return runProcess(
    "/usr/bin/sandbox-exec",
    [
      "-D", `WORKSPACE=${workspace}`,
      "-D", `TEMP=${temporary}`,
      "-p", macosProfile(workspace, temporary, access, networkEnabled, gitMetadata),
      ...restrictedShell(command, timeoutMs),
    ],
    cwd,
    timeoutMs,
    commandEnvironment(workspace, home, temporary),
    signal,
  );
}

function macosProfile(
  workspace: string,
  temporary: string,
  access: SandboxAccess[],
  networkEnabled: boolean,
  gitMetadata: string[],
): string {
  const ancestors: string[] = [];
  for (const location of [workspace, temporary, ...access.map((entry) => entry.path)]) {
    for (let current = path.dirname(location);; current = path.dirname(current)) {
      ancestors.push(`(literal ${JSON.stringify(current)})`);
      if (current === path.dirname(current)) break;
    }
  }
  const read = access.map((entry) => `(subpath ${JSON.stringify(entry.path)})`).join("\n  ");
  const write = access
    .filter((entry) => entry.writable)
    .map((entry) => `(subpath ${JSON.stringify(entry.path)})`)
    .join("\n  ");
  return MACOS_PROFILE
    .replace("__WORKSPACE_ANCESTORS__", [...new Set(ancestors)].join("\n  "))
    .replace("__EXTRA_READ__", read)
    .replace("__EXTRA_WRITE__", write)
    .replace("__GIT_METADATA__", gitMetadata
      .map((entry) => `(deny file-write* (subpath ${JSON.stringify(entry)}))`)
      .join("\n"))
    .replace("__NETWORK__", networkEnabled
      ? `(allow network* (local ip))
(allow network-outbound
  (remote tcp)
  (remote udp)
  (literal "/private/var/run/mDNSResponder"))
(allow network-bind
  (local unix-socket (subpath (param "WORKSPACE")))
  (local unix-socket (subpath (param "TEMP"))))
(allow network-outbound
  (remote unix-socket (subpath (param "WORKSPACE")))
  (remote unix-socket (subpath (param "TEMP"))))`
      : "(deny network*)")
    .replace("__PERSONAL_STATE__", JSON.stringify(personalSnaffleDirectory()));
}

async function runLinux(
  bubblewrap: string,
  command: string,
  workspace: string,
  cwd: string,
  timeoutMs: number,
  temporary: string,
  signal?: AbortSignal,
  access: SandboxAccess[] = [],
  networkEnabled = true,
): Promise<SandboxResult> {
  const gitMetadata = await findGitMetadata(workspace);
  const personalState = personalSnaffleDirectory();
  const sandboxCwd = inside(temporary, cwd)
    ? path.posix.join("/tmp", ...path.relative(temporary, cwd).split(path.sep))
    : cwd;
  await mkdir(personalState, { recursive: true });
  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-all",
    ...(networkEnabled ? ["--share-net"] : []),
    ...linuxSystemMounts(),
    "--dev", "/dev",
    "--proc", "/proc",
    "--bind", temporary, "/tmp",
    ...access.flatMap((entry) => [entry.writable ? "--bind" : "--ro-bind", entry.path, entry.path]),
    "--bind", workspace, workspace,
    ...gitMetadata.flatMap((entry) => ["--ro-bind", entry, entry]),
    "--ro-bind", personalState, personalState,
    "--chdir", sandboxCwd,
    ...restrictedShell(command, timeoutMs),
  ];

  return runProcess(
    bubblewrap,
    args,
    cwd,
    timeoutMs,
    commandEnvironment(workspace, "/tmp/home", "/tmp"),
    signal,
  );
}

function linuxSystemMounts(): string[] {
  const args: string[] = [];
  for (const source of ["/bin", "/sbin", "/usr", "/etc", "/lib", "/lib64", "/opt", "/nix"]) {
    if (existsSync(source)) args.push("--ro-bind", source, source);
  }
  return args;
}

async function runProcess(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<SandboxResult> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let timedOut = false;
    let outputExceeded = false;
    let outputSize = 0;
    let stdout = "";
    let stderr = "";
    const child = spawn(executable, args, {
      cwd,
      env,
      detached: true,
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const capture = (target: "stdout" | "stderr", chunk: Buffer): void => {
      const remaining = 512 * 1024 - outputSize;
      if (remaining <= 0) {
        outputExceeded = true;
        killProcessGroup(child.pid);
        return;
      }
      const content = chunk.subarray(0, remaining).toString("utf8");
      outputSize += chunk.length;
      if (target === "stdout") stdout += content;
      else stderr += content;
      if (outputSize > 512 * 1024) {
        outputExceeded = true;
        killProcessGroup(child.pid);
      }
    };
    child.stdout.on("data", (chunk: Buffer) => capture("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => capture("stderr", chunk));
    child.once("error", reject);
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      if (timedOut) stderr = `Command timed out after ${timeoutMs}ms`;
      if (outputExceeded) stderr += `${stderr ? "\n" : ""}Command output exceeded 512 KiB`;
      resolve({
        exitCode,
        stdout,
        stderr,
        ...(timedOut ? { timedOut: true } : {}),
        ...(sandboxDenied(`${stderr}\n${stdout}`) ? { permissionDenied: true } : {}),
      });
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(child.pid);
    }, timeoutMs);
    child.once("exit", () => killProcessGroup(child.pid));
  });
}

function commandEnvironment(
  workspace: string,
  home: string,
  temporary: string,
): NodeJS.ProcessEnv {
  return {
    PATH: safePath(workspace),
    HOME: home,
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    TERM: "dumb",
    GIT_OPTIONAL_LOCKS: "0",
    ...(process.env.LANG ? { LANG: process.env.LANG } : {}),
    ...(process.env.LC_ALL ? { LC_ALL: process.env.LC_ALL } : {}),
  };
}

function restrictedShell(command: string, timeoutMs: number): string[] {
  const cpuSeconds = Math.max(5, Math.ceil(timeoutMs / 1000) + 5);
  return ["/bin/sh", "-c", RESOURCE_LIMITS, "coding-harness-command", String(cpuSeconds), command];
}

function safePath(workspace: string): string {
  const systemRoots = process.platform === "darwin"
    ? ["/bin", "/sbin", "/usr/bin", "/usr/sbin", "/usr/local", "/opt/homebrew", "/opt/local", "/Library/Frameworks"]
    : process.platform === "linux"
      ? ["/bin", "/sbin", "/usr", "/opt", "/nix"]
      : [];
  const workspaceBins = ["node_modules/.bin", ".venv/bin", "venv/bin"]
    .map((entry) => path.join(workspace, entry))
    .filter(existsSync);
  const systemPath = (process.env.PATH ?? "").split(path.delimiter).filter((entry) =>
    path.isAbsolute(entry) && systemRoots.some((root) => inside(root, entry)),
  );
  return [...workspaceBins, ...systemPath, "/usr/bin", "/bin"].filter(unique).join(path.delimiter);
}

export async function findGitMetadata(workspace: string): Promise<string[]> {
  const found: string[] = [];
  const pending = [workspace];
  const ignored = new Set(["node_modules", ".venv", "venv", "dist", "build"]);

  while (pending.length) {
    const directory = pending.pop() as string;
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.name === ".git") {
        found.push(target);
      } else if (entry.isDirectory() && !ignored.has(entry.name)) {
        pending.push(target);
      }
    }
  }

  return found;
}

async function probe(): Promise<SandboxStatus> {
  const status = nativeSandboxStatus();
  if (!status.available) return status;

  const workspace = await mkdtemp(path.join(tmpdir(), "coding-harness-sandbox-probe-"));
  try {
    const result = await runRestrictedCommand(":", workspace, workspace, 3000);
    return result.exitCode === 0
      ? status
      : { available: false, detail: `${status.detail} could not start: ${oneLine(result.stderr)}` };
  } catch (error) {
    return { available: false, detail: `${status.detail} could not start: ${errorMessage(error)}` };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function killProcessGroup(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The command and its descendants have already exited.
  }
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function unique(value: string, index: number, values: string[]): boolean {
  return values.indexOf(value) === index;
}

function oneLine(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 180) || "unknown error";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sandboxDenied(stderr: string): boolean {
  return /\bEPERM\b|\bEACCES\b|operation not permitted|permission denied|read-only file system|could not resolve host|network is unreachable|temporary failure in name resolution|nodename nor servname provided/i.test(stderr);
}

function findExecutable(name: string): string | undefined {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through PATH.
    }
  }
  return undefined;
}

type ProcessError = Error & {
  code?: number | string;
  stdout?: string;
  stderr?: string;
};

function isProcessError(error: unknown): error is ProcessError {
  return error instanceof Error;
}
