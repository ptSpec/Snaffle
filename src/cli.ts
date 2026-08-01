#!/usr/bin/env node

import path from "node:path";
import { runAgent } from "./agent-loop.js";
import { ENV_PREFIX, LOCAL_STATE_DIRECTORY, PRODUCT } from "./identity.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";
import type { RunEvent } from "./protocol.js";
import { defaultTools } from "./tools/default-tools.js";
import { JsonlTrace } from "./trace.js";
import { LocalWorkspace } from "./workspace.js";

type CliOptions = {
  task: string;
  workspace: string;
  baseUrl: string;
  model: string;
  apiKey: string | undefined;
  tracePath: string;
  maxSteps: number;
  unsafeHost: boolean;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (!options.unsafeHost) {
    throw new Error(
      "Container execution is not implemented yet. Pass --unsafe-host only inside a disposable or trusted workspace.",
    );
  }

  console.error("Warning: this prototype can execute model-generated commands on the host.");

  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());

  const result = await runAgent({
    task: options.task,
    provider: new OpenAICompatibleProvider({
      baseUrl: options.baseUrl,
      model: options.model,
      ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    }),
    tools: defaultTools(),
    workspace: new LocalWorkspace(options.workspace, true),
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
  let unsafeHost = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] as string;
    if (argument === "--unsafe-host") {
      unsafeHost = true;
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
  const modelEnvironmentVariable = `${ENV_PREFIX}_MODEL`;
  const baseUrlEnvironmentVariable = `${ENV_PREFIX}_BASE_URL`;
  const apiKeyEnvironmentVariable = `${ENV_PREFIX}_API_KEY`;
  const model = values.get("--model") ?? process.env[modelEnvironmentVariable];
  if (!task) throw new Error("A task is required");
  if (!model) throw new Error(`Set --model or ${modelEnvironmentVariable}`);

  const workspace = path.resolve(values.get("--workspace") ?? process.cwd());
  const maxSteps = Number(values.get("--max-steps") ?? "20");
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new Error("--max-steps must be a positive integer");
  }

  return {
    task,
    workspace,
    model,
    baseUrl:
      values.get("--base-url") ??
      process.env[baseUrlEnvironmentVariable] ??
      "http://localhost:11434/v1",
    apiKey: values.get("--api-key") ?? process.env[apiKeyEnvironmentVariable],
    tracePath:
      values.get("--trace") ??
      path.join(
        workspace,
        LOCAL_STATE_DIRECTORY,
        "traces",
        `${new Date().toISOString().replaceAll(":", "-")}.jsonl`,
      ),
    maxSteps,
    unsafeHost,
  };
}

function printEvent(event: RunEvent): void {
  if (event.type === "tool.started") {
    console.error(`→ ${event.call.name}`);
  }
  if (event.type === "tool.completed") {
    console.error(`${event.isError ? "×" : "✓"} ${event.call.name}: ${firstLine(event.content)}`);
  }
}

function firstLine(value: string): string {
  return value.split("\n", 1)[0] ?? "";
}

function printHelp(): void {
  console.log(`Usage: ${PRODUCT.slug} [options] "task"

Options:
  --workspace <path>  Workspace directory (default: current directory)
  --base-url <url>    OpenAI-compatible base URL (default: http://localhost:11434/v1)
  --model <name>      Model name; may also use ${ENV_PREFIX}_MODEL
  --api-key <key>     API key; prefer ${ENV_PREFIX}_API_KEY
  --max-steps <n>     Maximum model turns (default: 20)
  --trace <path>      JSONL trace path (default: ${LOCAL_STATE_DIRECTORY}/traces/...)
  --unsafe-host       Explicitly allow this prototype to modify and run on the host
  --help              Show this help
`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
