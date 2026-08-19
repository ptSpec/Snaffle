import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type SandboxAccess = {
  path: string;
  writable: boolean;
};

export type SandboxAccessScope = "thread" | "workspace" | "global";

export type SandboxAccessGrant = SandboxAccess & {
  id: string;
  scope: SandboxAccessScope;
};

export type SandboxAccessInput = Pick<SandboxAccessGrant, "path" | "writable" | "scope">;

type GlobalAccessConfig = {
  version: 1;
  folders: Array<{
    path: string;
    access: "read-only" | "read-write";
  }>;
};

export function personalSnaffleDirectory(): string {
  return path.join(homedir(), ".snaffle");
}

export function globalSandboxAccessFile(): string {
  return path.join(personalSnaffleDirectory(), "sandbox-access.json");
}

export async function globalSandboxAccess(): Promise<SandboxAccessGrant[]> {
  await mkdir(personalSnaffleDirectory(), { recursive: true });
  let value: unknown;
  try {
    value = JSON.parse(await readFile(globalSandboxAccessFile(), "utf8"));
  } catch (error) {
    if (isMissing(error)) return [];
    console.warn(`Ignoring invalid sandbox access config: ${errorMessage(error)}`);
    return [];
  }
  if (!isGlobalAccessConfig(value)) {
    console.warn(`Ignoring invalid sandbox access config at ${globalSandboxAccessFile()}`);
    return [];
  }

  const grants: SandboxAccessGrant[] = [];
  for (const folder of value.folders) {
    try {
      const canonical = await realpath(folder.path);
      if (!(await stat(canonical)).isDirectory()) continue;
      grants.push({
        id: `global:${canonical}`,
        scope: "global",
        path: canonical,
        writable: folder.access === "read-write",
      });
    } catch {
      // Missing folders are not granted.
    }
  }
  return grants;
}

export async function addGlobalSandboxAccess(access: SandboxAccess): Promise<void> {
  const current = await globalSandboxAccess();
  const next = current.filter((entry) => entry.path !== access.path);
  next.push({ id: `global:${access.path}`, scope: "global", ...access });
  await writeGlobalSandboxAccess(next);
}

export async function removeGlobalSandboxAccess(folderPath: string): Promise<void> {
  await writeGlobalSandboxAccess(
    (await globalSandboxAccess()).filter((entry) => entry.path !== folderPath),
  );
}

export function mergeSandboxAccess(
  global: SandboxAccessGrant[],
  scoped: SandboxAccessGrant[],
): SandboxAccessGrant[] {
  const merged = new Map<string, SandboxAccessGrant>();
  for (const grant of [...global, ...scoped]) merged.set(grant.path, grant);
  return [...merged.values()];
}

async function writeGlobalSandboxAccess(grants: SandboxAccessGrant[]): Promise<void> {
  const directory = personalSnaffleDirectory();
  await mkdir(directory, { recursive: true });
  const config: GlobalAccessConfig = {
    version: 1,
    folders: grants.map((grant) => ({
      path: grant.path,
      access: grant.writable ? "read-write" : "read-only",
    })),
  };
  const temporary = path.join(directory, `.sandbox-access-${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, globalSandboxAccessFile());
}

function isGlobalAccessConfig(value: unknown): value is GlobalAccessConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  return config.version === 1 && Array.isArray(config.folders) && config.folders.every((folder) => {
    if (!folder || typeof folder !== "object" || Array.isArray(folder)) return false;
    const entry = folder as Record<string, unknown>;
    return typeof entry.path === "string" && path.isAbsolute(entry.path) &&
      (entry.access === "read-only" || entry.access === "read-write");
  });
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
