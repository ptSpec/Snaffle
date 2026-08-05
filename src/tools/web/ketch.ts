import { constants, accessSync } from "node:fs";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { KetchSearchBackend } from "./types.js";

type KetchSearchResult = { title?: unknown; url?: unknown; description?: unknown; content?: unknown };
type KetchExtractResult = { title?: unknown; markdown?: unknown };

const executableName = process.platform === "win32" ? "ketch.exe" : "ketch";

export function findKetch(): string | undefined {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    process.env.KETCH_PATH,
    resources ? join(resources, "bin", executableName) : undefined,
    join(process.cwd(), "resources", "bin", executableName),
    ...((process.env.PATH ?? "").split(delimiter).filter(Boolean).map((part) => join(part, executableName))),
  ];
  return candidates.find((candidate) => {
    if (!candidate) return false;
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export async function searchWithKetch(
  executable: string,
  backend: KetchSearchBackend,
  apiKey: string | undefined,
  query: string,
  maxResults: number,
): Promise<{ title: string; url: string; content: string }[]> {
  const output = await runKetch(executable, [
    "search", query, "--backend", backend, "--limit", String(maxResults), "--json",
  ], undefined, 15_000, apiKey ? { [keyEnvironment[backend]]: apiKey } : {});
  const results = JSON.parse(output) as KetchSearchResult[];
  if (!Array.isArray(results)) throw new Error("Ketch returned invalid search results");
  return results.flatMap((result) =>
    typeof result.title === "string" && typeof result.url === "string"
      ? [{
          title: result.title,
          url: result.url,
          content: typeof result.content === "string" && result.content
            ? result.content
            : typeof result.description === "string" ? result.description : "",
        }]
      : [],
  );
}

export async function extractWithKetch(
  executable: string,
  html: string,
  url: string,
  maxChars: number,
): Promise<{ title?: string; content: string }> {
  const output = await runKetch(
    executable,
    ["extract", "--url", url, "--max-chars", String(maxChars), "--json"],
    html,
    10_000,
    {},
  );
  const result = JSON.parse(output) as KetchExtractResult;
  if (typeof result.markdown !== "string") throw new Error("Ketch returned invalid extracted content");
  return {
    ...(typeof result.title === "string" && result.title ? { title: result.title } : {}),
    content: result.markdown.trim(),
  };
}

function runKetch(
  executable: string,
  args: string[],
  input: string | undefined,
  timeoutMs: number,
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: { ...safeEnvironment(), ...environment },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let bytes = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Ketch timed out"));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 2_000_000) child.kill();
      else output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.stdin.on("error", () => {});
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (bytes > 2_000_000) reject(new Error("Ketch output exceeded 2 MB"));
      else if (code === 0) resolve(Buffer.concat(output).toString("utf8"));
      else reject(new Error(Buffer.concat(errors).toString("utf8").trim() || `Ketch exited ${code}`));
    });
    child.stdin.end(input);
  });
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const keep = [
    "PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR", "LANG",
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
  ];
  return {
    ...Object.fromEntries(keep.flatMap((key) => process.env[key] ? [[key, process.env[key]]] : [])),
    KETCH_CONFIG: join(tmpdir(), "esch-ketch-no-config.json"),
  };
}

const keyEnvironment: Record<KetchSearchBackend, string> = {
  ddg: "",
  exa: "KETCH_EXA_API_KEY",
  tavily: "KETCH_TAVILY_API_KEY",
  brave: "KETCH_BRAVE_API_KEY",
  firecrawl: "KETCH_FIRECRAWL_API_KEY",
};
