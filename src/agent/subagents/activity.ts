import type { ToolCall, Usage } from "../../protocol.js";

export type SubagentAccess = "read" | "write";
export type SubagentStatus = "queued" | "running" | "completed" | "failed";

export type SubagentStep = {
  step: number;
  reasoning: string;
  response: string;
  usage?: Usage;
  durationMs?: number;
  tools: Array<{
    call: ToolCall;
    content?: string;
    isError?: boolean;
  }>;
};

export type SubagentRunActivity = {
  id: string;
  task: string;
  status: SubagentStatus;
  model?: string;
  providerId?: string;
  providerConnectionId?: string;
  steps: SubagentStep[];
  result?: string;
  error?: string;
};

export type SubagentActivity = {
  kind: "subagent";
  access: SubagentAccess;
  status: Exclude<SubagentStatus, "queued">;
  runs: SubagentRunActivity[];
  result?: string;
  error?: string;
};

type ChildUpdate = { runId: string } & (
  | { type: "run.started"; model: string; providerId: string; providerConnectionId: string }
  | { type: "reasoning.delta"; step: number; text: string }
  | { type: "response.delta"; step: number; text: string }
  | { type: "model.completed"; step: number; reasoning: string; response: string; usage?: Usage; durationMs: number }
  | { type: "tool.started"; step: number; call: ToolCall }
  | { type: "tool.completed"; step: number; call: ToolCall; content: string; isError: boolean }
  | { type: "run.completed"; result: string }
  | { type: "run.failed"; message: string }
);

export type SubagentActivityUpdate =
  | {
      type: "batch.started";
      access: SubagentAccess;
      runs: Array<{ id: string; task: string }>;
    }
  | ChildUpdate
  | { type: "batch.completed"; result: string }
  | { type: "batch.failed"; message: string };

export function applySubagentUpdate(
  activity: SubagentActivity | undefined,
  update: SubagentActivityUpdate,
): SubagentActivity | undefined {
  if (update.type === "batch.started") {
    return {
      kind: "subagent",
      access: update.access,
      status: "running",
      runs: update.runs.map((run) => ({ ...run, status: "queued", steps: [] })),
    };
  }
  if (!activity) return undefined;
  if (update.type === "batch.completed") {
    return { ...activity, status: "completed", result: update.result };
  }
  if (update.type === "batch.failed") {
    return { ...activity, status: "failed", error: update.message };
  }

  const runs = [...activity.runs];
  const index = runs.findIndex((run) => run.id === update.runId);
  if (index === -1) return activity;
  const run = { ...runs[index]!, steps: [...runs[index]!.steps] };

  if (update.type === "run.started") {
    Object.assign(run, {
      status: "running",
      model: update.model,
      providerId: update.providerId,
      providerConnectionId: update.providerConnectionId,
    });
  } else if (update.type === "run.completed") {
    run.status = "completed";
    run.result = update.result;
  } else if (update.type === "run.failed") {
    run.status = "failed";
    run.error = update.message;
  } else {
    updateStep(run, update);
  }

  runs[index] = run;
  return { ...activity, runs };
}

function updateStep(
  run: SubagentRunActivity,
  update: Exclude<ChildUpdate, { type: "run.started" | "run.completed" | "run.failed" }>,
): void {
  const index = run.steps.findIndex((step) => step.step === update.step);
  const step: SubagentStep = index === -1
    ? { step: update.step, reasoning: "", response: "", tools: [] }
    : { ...run.steps[index]!, tools: [...run.steps[index]!.tools] };

  if (update.type === "reasoning.delta") step.reasoning += update.text;
  if (update.type === "response.delta") step.response += update.text;
  if (update.type === "model.completed") {
    step.reasoning = update.reasoning || step.reasoning;
    step.response = update.response || step.response;
    if (update.usage) step.usage = update.usage;
    step.durationMs = update.durationMs;
  }
  if (update.type === "tool.started") step.tools.push({ call: update.call });
  if (update.type === "tool.completed") {
    const toolIndex = step.tools.findIndex((tool) => tool.call.id === update.call.id);
    const tool = { call: update.call, content: update.content, isError: update.isError };
    if (toolIndex === -1) step.tools.push(tool);
    else step.tools[toolIndex] = tool;
  }

  if (index === -1) run.steps.push(step);
  else run.steps[index] = step;
}
