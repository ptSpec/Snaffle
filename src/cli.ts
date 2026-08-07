#!/usr/bin/env node

import path from "node:path";
import { runAgent } from "./agent/loop.js";
import { builtInCapabilities } from "./capabilities/active.js";
import { ENV_PREFIX, LOCAL_STATE_DIRECTORY, PRODUCT } from "./identity.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";
import { listOpenRouterModels, OpenRouterProvider } from "./providers/openrouter.js";
import type { ModelProvider } from "./providers/provider.js";
import type { RunEvent } from "./protocol.js";
import { probeNativeSandbox } from "./execution/native/sandbox.js";
import { defaultTools } from "./tools/built-ins.js";
import { WEB_SEARCH_BACKENDS, type WebSearchBackend } from "./tools/web/types.js";
import { JsonlTrace } from "./agent/trace.js";
import { LocalWorkspace } from "./execution/workspace.js";

type CliOptions = {
  task: string;
  provider: "openai-compatible" | "openrouter";
  workspace: string;
  baseUrl: string;
  model: string;
  apiKey: string | undefined;
  tracePath: string;
  maxSteps: number;
  listModels: boolean;
  unsafeHost: boolean;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.listModels) {
    if (options.provider !== "openrouter") {
      throw new Error("--list-models currently requires --provider openrouter");
    }
    if (!options.apiKey) throw new Error("Set --api-key or OPENROUTER_API_KEY");

    const models = await listOpenRouterModels(options.apiKey);
    for (const model of models) {
      console.log(`${model.id}\t${model.contextLength ?? "-"}\t${model.name}`);
    }
    return;
  }

  if (options.unsafeHost) {
    console.error("Warning: model-generated commands are running without sandbox restrictions.");
  } else {
    const sandbox = await probeNativeSandbox();
    if (!sandbox.available) throw new Error(sandbox.detail);
    console.error(`Restricted execution: ${sandbox.detail}`);
  }

  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());

  const result = await runAgent({
    task: options.task,
    provider: createProvider(options),
    capabilities: builtInCapabilities(defaultTools(webSearchOptions(options))),
    workspace: new LocalWorkspace(options.workspace, options.unsafeHost ? "unsafe" : "restricted"),
    trace: new JsonlTrace(options.tracePath),
    signal: controller.signal,
    maxSteps: options.maxSteps,
    onEvent: printEvent,
  });

  process.stdout.write(`${result.text}\n`);
}

function parseArgs(args: string[]): CliOptions {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  const values = new Map<string, string>();
  const taskParts: string[] = [];
  let listModels = false;
  let unsafeHost = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] as string;
    if (argument === "--unsafe-host") {
      unsafeHost = true;
      continue;
    }
    if (argument === "--list-models") {
      listModels = true;
      continue;
    }
    if (argument.startsWith("--")) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
      values.set(argument, value);
      index += 1;
      continue;
    }
    taskParts.push(argument);
  }

  const task = taskParts.join(" ").trim();
  const provider = values.get("--provider") ?? "openai-compatible";
  if (provider !== "openai-compatible" && provider !== "openrouter") {
    throw new Error("--provider must be openai-compatible or openrouter");
  }
  const modelEnvironmentVariable = `${ENV_PREFIX}_MODEL`;
  const baseUrlEnvironmentVariable = `${ENV_PREFIX}_BASE_URL`;
  const apiKeyEnvironmentVariable = `${ENV_PREFIX}_API_KEY`;
  const model = values.get("--model") ?? process.env[modelEnvironmentVariable];
  if (!listModels && !task) throw new Error("A task is required");
  if (!listModels && !model) throw new Error(`Set --model or ${modelEnvironmentVariable}`);

  const workspace = path.resolve(values.get("--workspace") ?? process.cwd());
  const maxSteps = Number(values.get("--max-steps") ?? "20");
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new Error("--max-steps must be a positive integer");
  }

  return {
    task,
    provider,
    workspace,
    model: model ?? "",
    baseUrl:
      values.get("--base-url") ??
      process.env[baseUrlEnvironmentVariable] ??
      "http://localhost:11434/v1",
    apiKey:
      values.get("--api-key") ??
      (provider === "openrouter" ? process.env.OPENROUTER_API_KEY : undefined) ??
      process.env[apiKeyEnvironmentVariable],
    tracePath:
      values.get("--trace") ??
      path.join(
        workspace,
        LOCAL_STATE_DIRECTORY,
        "traces",
        `${new Date().toISOString().replaceAll(":", "-")}.jsonl`,
      ),
    maxSteps,
    listModels,
    unsafeHost,
  };
}

function createProvider(options: CliOptions): ModelProvider {
  if (options.provider === "openrouter") {
    if (!options.apiKey) throw new Error("Set --api-key or OPENROUTER_API_KEY");
    return new OpenRouterProvider({
      model: options.model,
      apiKey: options.apiKey,
    });
  }

  return new OpenAICompatibleProvider({
    baseUrl: options.baseUrl,
    model: options.model,
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
  });
}

function webSearchOptions(options: CliOptions) {
  const requested = process.env[`${ENV_PREFIX}_WEB_SEARCH_BACKEND`];
  const backend: WebSearchBackend = requested && WEB_SEARCH_BACKENDS.includes(requested as WebSearchBackend)
    ? requested as WebSearchBackend
    : "ddg";
  const keys: Partial<Record<WebSearchBackend, string | undefined>> = {
    exa: process.env.EXA_API_KEY || process.env.KETCH_EXA_API_KEY,
    tavily: process.env.TAVILY_API_KEY || process.env.KETCH_TAVILY_API_KEY,
    brave: process.env.BRAVE_API_KEY || process.env.KETCH_BRAVE_API_KEY,
    firecrawl: process.env.FIRECRAWL_API_KEY || process.env.KETCH_FIRECRAWL_API_KEY,
  };
  return {
    webSearchEnabled: true,
    backend,
    apiKey: keys[backend],
    ...(options.provider === "openrouter" ? { openRouterApiKey: options.apiKey } : {}),
  };
}

function printEvent(event: RunEvent): void {
  if (event.type === "tool.started") {
    console.error(`→ ${event.call.name}`);
  }
  if (event.type === "tool.completed") {
    let marker = "✓";
    if (event.isError) marker = "×";
    else if (event.exitCode !== undefined && event.exitCode !== 0) marker = "!";
    console.error(`${marker} ${event.call.name}: ${firstLine(event.content)}`);
  }
}

function firstLine(value: string): string {
  return value.split("\n", 1)[0] ?? "";
}

function printHelp(): void {
  console.log(`Usage: ${PRODUCT.slug} [options] "task"

Options:
  --workspace <path>  Workspace directory (default: current directory)
  --provider <name>   openai-compatible (default) or openrouter
  --base-url <url>    OpenAI-compatible base URL (default: http://localhost:11434/v1)
  --model <name>      Model name; may also use ${ENV_PREFIX}_MODEL
  --api-key <key>     API key; prefer OPENROUTER_API_KEY or ${ENV_PREFIX}_API_KEY
  --list-models       List tool-capable OpenRouter models, then exit
  --max-steps <n>     Maximum model turns (default: 20)
  --trace <path>      JSONL trace path (default: ${LOCAL_STATE_DIRECTORY}/traces/...)
  --unsafe-host       Run commands without native sandbox restrictions
  --help              Show this help
`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
