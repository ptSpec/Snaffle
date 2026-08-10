import { randomUUID } from "node:crypto";
import { runAgent } from "../loop.js";
import type { Trace } from "../trace.js";
import { builtInCapabilities } from "../../capabilities/active.js";
import type { Workspace } from "../../execution/workspace.js";
import type { ModelProvider } from "../../providers/provider.js";
import { editTool } from "../../tools/edit.js";
import { truncateMiddle } from "../../tools/output.js";
import { readTool } from "../../tools/read.js";
import { runTool } from "../../tools/run.js";
import { searchTool } from "../../tools/search.js";
import { writeTool } from "../../tools/write.js";
import type { SubagentActivityUpdate, SubagentProfileName } from "./activity.js";
import { checkCommandTool } from "./check-tool.js";

const silentTrace: Trace = { async write(): Promise<void> {} };
const RETURN_TEMPLATE = `Return your final result using exactly this concise Markdown structure:
## Status
- Completed, Partial, or Blocked — one-sentence outcome

## Findings
- Key facts the parent agent needs, including exact paths or symbols when relevant

## Changes
- path: what changed and why, or "None"

## Verification
- command or check: result, or "Not run"

## Follow-up
- Remaining issue or recommended next action, or "None"

Do not include private reasoning or long tool output in the final result.`;

export type SubagentRequest = {
  profile: SubagentProfileName;
  tasks: string[];
};

export type SubagentProviderRoute = {
  provider: ModelProvider;
  connectionName: string;
  fallbackFromConnectionName?: string;
  release(): void;
};

export async function runSubagents(options: SubagentRequest & {
  provider: (signal: AbortSignal) => Promise<SubagentProviderRoute>;
  workspace: Workspace;
  signal: AbortSignal;
  maxSteps: number;
  onUpdate?: (update: SubagentActivityUpdate) => void | Promise<void>;
}): Promise<string> {
  const runs = options.tasks.map((task) => ({ id: randomUUID(), task }));
  await options.onUpdate?.({ type: "batch.started", profile: options.profile, runs });

  const settled = await Promise.allSettled(runs.map((run) => runChild({ ...options, ...run })));
  const sections = settled.map((outcome, index) => {
    const run = runs[index]!;
    const result = outcome.status === "fulfilled"
      ? outcome.value
      : `## Status\n- Blocked — ${errorMessage(outcome.reason)}`;
    return `### ${profileLabel(options.profile)} agent ${index + 1}: ${run.task}\n\n${truncateMiddle(result, 2_500)}`;
  });
  const result = truncateMiddle(sections.join("\n\n---\n\n"), 12_000);

  if (settled.every((outcome) => outcome.status === "rejected")) {
    const message = options.profile === "implement"
      ? errorMessage(settled[0]!.reason)
      : `All delegated ${options.profile} tasks failed`;
    await options.onUpdate?.({ type: "batch.failed", message });
    throw new Error(message);
  }

  await options.onUpdate?.({ type: "batch.completed", result });
  return result;
}

async function runChild(options: {
  id: string;
  task: string;
  profile: SubagentProfileName;
  provider: (signal: AbortSignal) => Promise<SubagentProviderRoute>;
  workspace: Workspace;
  signal: AbortSignal;
  maxSteps: number;
  onUpdate?: (update: SubagentActivityUpdate) => void | Promise<void>;
}): Promise<string> {
  const route = await options.provider(options.signal);
  try {
    const result = await runAgent({
      task: options.task,
      provider: route.provider,
      capabilities: profileCapabilities(options.profile),
      workspace: options.workspace,
      trace: silentTrace,
      signal: options.signal,
      maxSteps: options.maxSteps,
      history: [{
        role: "system",
        content: `${profilePrompt(options.profile)}\n\n${RETURN_TEMPLATE}`,
      }],
      onEvent: async (event) => {
        if (event.type === "run.started") {
          await options.onUpdate?.({
            type: "run.started",
            runId: options.id,
            model: event.model,
            providerId: event.providerId,
            providerConnectionId: event.providerConnectionId,
            providerConnectionName: route.connectionName,
            ...(route.fallbackFromConnectionName
              ? { fallbackFromConnectionName: route.fallbackFromConnectionName }
              : {}),
          });
        }
        if (event.type === "model.reasoning.delta") {
          await options.onUpdate?.({ type: "reasoning.delta", runId: options.id, step: event.step, text: event.text });
        }
        if (event.type === "model.delta") {
          await options.onUpdate?.({ type: "response.delta", runId: options.id, step: event.step, text: event.text });
        }
        if (event.type === "model.completed") {
          await options.onUpdate?.({
            type: "model.completed",
            runId: options.id,
            step: event.step,
            reasoning: event.response.reasoning ?? "",
            response: event.response.text,
            ...(event.response.usage ? { usage: event.response.usage } : {}),
            durationMs: event.durationMs,
          });
        }
        if (event.type === "tool.started") {
          await options.onUpdate?.({ type: "tool.started", runId: options.id, step: event.step, call: event.call });
        }
        if (event.type === "tool.completed") {
          await options.onUpdate?.({
            type: "tool.completed",
            runId: options.id,
            step: event.step,
            call: event.call,
            content: event.content,
            isError: event.isError,
          });
        }
        if (event.type === "run.failed") {
          await options.onUpdate?.({ type: "run.failed", runId: options.id, message: event.message });
        }
      },
    });
    await options.onUpdate?.({ type: "run.completed", runId: options.id, result: result.text });
    return result.text;
  } finally {
    route.release();
  }
}

function profileCapabilities(profile: SubagentProfileName) {
  if (profile === "implement") {
    return builtInCapabilities([runTool, readTool, searchTool, editTool, writeTool]);
  }
  if (profile === "review" || profile === "test") {
    return builtInCapabilities([readTool, searchTool, checkCommandTool(profile)]);
  }
  return builtInCapabilities([readTool, searchTool]);
}

function profilePrompt(profile: SubagentProfileName): string {
  if (profile === "implement") {
    return "You are a focused implementation agent. Complete only the delegated task. Inspect the workspace, make requested changes, and verify them.";
  }
  if (profile === "review") {
    return "You are a focused read-only review agent. Inspect code and Git changes. You may run only the read-only Git commands exposed by check_command. Do not modify files.";
  }
  if (profile === "test") {
    return "You are a focused read-only test agent. Inspect the workspace and run only the verification commands exposed by check_command. Diagnose failures, but do not modify files.";
  }
  return "You are a focused read-only exploration agent. Investigate only the delegated task using read_file and search_files. Do not run commands or modify files.";
}

function profileLabel(profile: SubagentProfileName): string {
  return profile[0]!.toUpperCase() + profile.slice(1);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
