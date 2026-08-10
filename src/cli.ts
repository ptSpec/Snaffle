#!/usr/bin/env node

import path from "node:path";
import { runAgent } from "./agent/loop.js";
import { builtInCapabilities } from "./capabilities/active.js";
import { ENV_PREFIX, LOCAL_STATE_DIRECTORY, PROJECT, projectEnvironment } from "./identity.js";
import { createProvider, providerDefinition } from "./providers/registry.js";
import type { ResolvedProviderConnection } from "./providers/provider.js";
import type { RunEvent } from "./protocol.js";
import { probeNativeSandbox } from "./execution/native/sandbox.js";
import { defaultTools } from "./tools/built-ins.js";
import { WEB_SEARCH_BACKENDS, type WebSearchBackend } from "./tools/web/types.js";
import { JsonlTrace } from "./agent/trace.js";
import { LocalWorkspace } from "./execution/workspace.js";
import { SkillRegistry, skillTool } from "./extensions/skills/index.js";

type CliOptions = {
  task: string;
  provider: string;
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
    const definition = providerDefinition(options.provider);
    if (!definition.listModels) throw new Error(`${definition.name} does not support model discovery`);
    const models = await definition.listModels(cliConnection(options));
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

  const tools = defaultTools(webSearchOptions(options));
  const skills = new SkillRegistry(options.workspace);
  if (skills.summaries().length) tools.push(skillTool(skills));

  const result = await runAgent({
    task: options.task,
    provider: createCliProvider(options),
    capabilities: builtInCapabilities(tools),
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
  providerDefinition(provider);
  const modelEnvironmentVariable = `${ENV_PREFIX}_MODEL`;
  const model = values.get("--model") ?? projectEnvironment("MODEL", process.env);
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
      projectEnvironment("BASE_URL", process.env) ??
      "http://localhost:11434/v1",
    apiKey:
      values.get("--api-key") ??
      (provider === "openrouter" ? process.env.OPENROUTER_API_KEY : undefined) ??
      projectEnvironment("API_KEY", process.env),
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

function createCliProvider(options: CliOptions) {
  return createProvider(cliConnection(options), options.model, {});
}

function cliConnection(options: CliOptions): ResolvedProviderConnection {
  const definition = providerDefinition(options.provider);
  if (definition.apiKey === "required" && !options.apiKey) {
    throw new Error(`Set --api-key for ${definition.name}`);
  }
  return {
    id: "cli",
    providerId: definition.id,
    name: definition.name,
    baseUrl: options.provider === "openai-compatible" ? options.baseUrl : definition.defaultBaseUrl,
    enabled: true,
    requestLimit: 1,
    fallbackProviderConnectionId: "",
    fallbackModel: "",
    hasApiKey: Boolean(options.apiKey),
    manualModels: [],
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
  };
}

function webSearchOptions(options: CliOptions) {
  const requested = projectEnvironment("WEB_SEARCH_BACKEND", process.env);
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
  console.log(`Usage: ${PROJECT.slug} [options] "task"

Options:
  --workspace <path>  Workspace directory (default: current directory)
  --provider <name>   openai-compatible (default) or openrouter
  --base-url <url>    OpenAI-compatible base URL (default: http://localhost:11434/v1)
  --model <name>      Model name; may also use ${ENV_PREFIX}_MODEL
  --api-key <key>     API key; prefer OPENROUTER_API_KEY or ${ENV_PREFIX}_API_KEY
  --list-models       List models exposed by the selected provider, then exit
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
