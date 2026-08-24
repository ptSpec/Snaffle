import { execFile } from "node:child_process";
import { readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { Sandbox, setRuntimeLibkrunfwPath } from "microsandbox";
import type { SandboxAccess } from "../access.js";
import { findGitMetadata } from "../native/sandbox.js";
import { prepareScratchDirectory } from "../scratch.js";
import {
  LocalWorkspace,
  type CommandApproval,
  type CommandResult,
} from "../workspace.js";

const runFile = promisify(execFile);
const IMAGE = "node:24.19.0-bookworm";
const MEMORY_MIB = 2048;
const GUEST_WORKSPACE = "/workspace";
const GUEST_TEMPORARY = "/tmp/snaffle";
const MAX_OUTPUT_BYTES = 512 * 1024;

let statusProbe: Promise<MicrosandboxStatus> | undefined;

export type MicrosandboxStatus = {
  available: boolean;
  detail: string;
};

export function probeMicrosandbox(): Promise<MicrosandboxStatus> {
  statusProbe ??= probe();
  return statusProbe;
}

export class MicrosandboxWorkspace extends LocalWorkspace {
  readonly environment: string;
  private closed = false;

  private constructor(
    root: string,
    private readonly sandbox: Sandbox,
    mountedTemporary: string,
    networkEnabled: boolean,
    private readonly mountedAccess: SandboxAccess[],
    approve?: CommandApproval,
  ) {
    super(root, "disabled", approve, mountedAccess, mountedTemporary);
    const additionalAccess = mountedAccess.length
      ? ` Additional locations: ${mountedAccess.map((entry, index) => {
          const guestPath = guestAccessPath(entry.path, index);
          const location = guestPath === entry.path ? guestPath : `${guestPath} (host: ${entry.path})`;
          return `${entry.writable ? "read and write" : "read only"} ${location}`;
        }).join("; ")}.`
      : "";
    this.environment = `Linux ${process.arch}, /bin/sh. Commands start in ${GUEST_WORKSPACE}; relative paths use the workspace. $TMPDIR is writable temporary storage shared by file tools and commands and persists across responses in this thread. Only ${GUEST_WORKSPACE}, $TMPDIR, and listed additional locations are host-backed.${additionalAccess} Commands ${networkEnabled ? "can use the network" : "cannot use the network"}. Provider credentials are not available.`;
  }

  static async create(
    root: string,
    temporaryDirectory: string,
    networkEnabled: boolean,
    sandboxAccess: SandboxAccess[],
    approve?: CommandApproval,
  ): Promise<MicrosandboxWorkspace> {
    const workspace = await realpath(root);
    const temporary = await realpath(await prepareScratchDirectory(temporaryDirectory));
    const resolvedAccess = await Promise.all(sandboxAccess.map(async (access) => ({
      ...access,
      path: await realpath(access.path),
    })));
    let builder = Sandbox.builder(`snaffle-${randomUUID()}`)
      .image(IMAGE)
      .memory(MEMORY_MIB)
      .workdir(GUEST_WORKSPACE)
      .env("TMPDIR", GUEST_TEMPORARY)
      .ephemeral(true)
      .volume(GUEST_WORKSPACE, (mount) => mount.bind(workspace))
      .volume(GUEST_TEMPORARY, (mount) => mount.bind(temporary));

    for (const [index, access] of resolvedAccess.entries()) {
      builder = builder.volume(
        guestAccessPath(access.path, index),
        (mount) => access.writable ? mount.bind(access.path) : mount.bind(access.path).readonly(),
      );
    }

    for (const gitMetadata of await findGitMetadata(workspace)) {
      const relative = path.relative(workspace, gitMetadata).split(path.sep);
      builder = builder.volume(
        path.posix.join(GUEST_WORKSPACE, ...relative),
        (mount) => mount.bind(gitMetadata).readonly(),
      );
    }
    if (!networkEnabled) builder = builder.disableNetwork();
    await configureMicrosandboxRuntime();

    return new MicrosandboxWorkspace(
      workspace,
      await builder.create(),
      temporary,
      networkEnabled,
      resolvedAccess,
      approve,
    );
  }

  override async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.sandbox.stop();
  }

  override async run(
    command: string,
    cwd: string | undefined,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    signal?.throwIfAborted();
    const commandCwd = await this.guestPath(cwd ?? ".");
    const execution = await this.sandbox.execStreamWith(
      "/bin/sh",
      (options) => options.args(["-lc", command]).cwd(commandCwd).stdinNull(),
    );

    let exitCode: number | null = null;
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let outputExceeded = false;
    let timedOut = false;
    const kill = (): void => {
      void execution.kill().catch(() => undefined);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    signal?.addEventListener("abort", kill, { once: true });

    try {
      for await (const event of execution) {
        if (event.kind === "exited") {
          exitCode = event.code;
          continue;
        }
        if (event.kind !== "stdout" && event.kind !== "stderr") continue;

        const chunk = Buffer.from(event.data);
        const remaining = MAX_OUTPUT_BYTES - outputBytes;
        if (remaining > 0) {
          const content = chunk.subarray(0, remaining).toString("utf8");
          if (event.kind === "stdout") stdout += content;
          else stderr += content;
        }
        outputBytes += chunk.byteLength;
        if (outputBytes > MAX_OUTPUT_BYTES) {
          outputExceeded = true;
          kill();
          break;
        }
      }
      signal?.throwIfAborted();
      if (timedOut) stderr = `Command timed out after ${timeoutMs}ms`;
      if (outputExceeded) stderr += `${stderr ? "\n" : ""}Command output exceeded 512 KiB`;
      if (!timedOut && !outputExceeded && (exitCode === 137 || exitCode === -1)) {
        stderr += `${stderr ? "\n" : ""}The command was killed inside the isolated environment. It may have exceeded the ${MEMORY_MIB / 1024} GiB memory limit.`;
      }
      return {
        exitCode,
        stdout,
        stderr,
        ...(timedOut ? { timedOut: true } : {}),
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
    }
  }

  private async guestPath(input: string): Promise<string> {
    const resolved = await this.resolveExisting(input);
    const guestRoot = resolved.kind === "temporary"
      ? GUEST_TEMPORARY
      : resolved.kind === "external"
        ? this.mountedGuestPath(resolved.base)
        : GUEST_WORKSPACE;
    return resolved.relative
      ? path.posix.join(guestRoot, ...resolved.relative.split(path.sep))
      : guestRoot;
  }

  private mountedGuestPath(hostPath: string): string {
    const index = this.mountedAccess.findIndex((entry) => entry.path === hostPath);
    if (index === -1) {
      throw new Error("This folder was added during the current run and will be available to shell commands on the next run");
    }
    return guestAccessPath(hostPath, index);
  }
}

function guestAccessPath(hostPath: string, index: number): string {
  if (process.platform !== "win32") return hostPath;
  const root = path.parse(hostPath).root;
  const rootName = root.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "root";
  const relative = path.relative(root, hostPath).split(path.sep);
  return path.posix.join("/mnt/snaffle", `${index + 1}-${rootName}`, ...relative);
}

async function probe(): Promise<MicrosandboxStatus> {
  try {
    await runFile(microsandboxExecutable(), ["doctor"], {
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 256 * 1024,
    });
    return { available: true, detail: "Microsandbox (experimental)" };
  } catch (error) {
    return {
      available: false,
      detail: microsandboxUnavailableDetail(error),
    };
  }
}

function microsandboxUnavailableDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (process.platform === "win32" && /Windows Hypervisor Platform|Hypervisor unavailable|hypervisor is not active/i.test(message)) {
    return "Enable Windows Hypervisor Platform in ‘Turn Windows features on or off,’ then restart Windows. Hardware virtualization must also be enabled in UEFI/BIOS. To continue without isolation, turn on ‘Allow unrestricted shell commands.’";
  }
  return `Microsandbox is unavailable: ${message}`;
}

function microsandboxExecutable(): string {
  return path.join(
    microsandboxPackageRoot(),
    "bin",
    process.platform === "win32" ? "msb.exe" : "msb",
  );
}

async function configureMicrosandboxRuntime(): Promise<void> {
  const libraryDirectory = path.join(microsandboxPackageRoot(), "lib");
  const library = (await readdir(libraryDirectory)).find((name) => name.startsWith("libkrunfw."));
  if (!library) throw new Error(`libkrunfw is missing from ${libraryDirectory}`);
  setRuntimeLibkrunfwPath(path.join(libraryDirectory, library));
}

function microsandboxPackageRoot(): string {
  const packageName = process.platform === "darwin" && process.arch === "arm64"
    ? "@superradcompany/microsandbox-darwin-arm64"
    : process.platform === "linux" && process.arch === "x64"
      ? "@superradcompany/microsandbox-linux-x64-gnu"
      : process.platform === "linux" && process.arch === "arm64"
        ? "@superradcompany/microsandbox-linux-arm64-gnu"
        : process.platform === "win32" && process.arch === "x64"
          ? "@superradcompany/microsandbox-win32-x64-msvc"
          : process.platform === "win32" && process.arch === "arm64"
            ? "@superradcompany/microsandbox-win32-arm64-msvc"
            : "";
  if (!packageName) throw new Error(`${process.platform} ${process.arch} is not supported`);

  const require = createRequire(import.meta.url);
  const binding = require.resolve(packageName).replace(
    /([\\/])app\.asar([\\/])/,
    "$1app.asar.unpacked$2",
  );
  return path.dirname(binding);
}
