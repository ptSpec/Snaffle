import type {
  SubagentActivity,
  SubagentRunActivity,
  SubagentStep,
} from "../../../../agent/subagents/activity.js";
import { JsonInspector } from "./json-inspector.js";

export function SubagentInspector({ activity }: { activity: SubagentActivity }): JSX.Element {
  const runs = activityRuns(activity);
  const access = activity.access ?? "read";
  return (
    <div className="subagent-inspector">
      <div className="subagent-heading">
        <div>
          <p className="eyebrow">Delegation</p>
          <h3>{delegationLabel(access, runs.length)}</h3>
        </div>
        <span className={`subagent-status ${activity.status}`}>{activity.status}</span>
      </div>

      <div className="subagent-runs">
        {runs.map((run, index) => (
          <details
            className={`subagent-run ${run.status}`}
            key={run.id}
            open={runs.length === 1 || run.status === "running"}
          >
            <summary>
              <span>Agent {index + 1}</span>
              <small>{run.status}</small>
            </summary>
            <div className="subagent-run-body">
              {run.model ? <p className="subagent-provider">{run.model} · {run.providerConnectionId}</p> : null}
              <h4>Task</h4>
              <pre>{run.task}</pre>

              {run.steps.map((step) => (
                <SubagentTurn current={run.steps.at(-1)?.step === step.step} key={step.step} run={run} step={step} />
              ))}

              {run.result ? <><h4>Result</h4><pre>{run.result}</pre></> : null}
              {run.error ? <p className="settings-error">{run.error}</p> : null}
            </div>
          </details>
        ))}
      </div>

      {activity.result ? (
        <details className="subagent-return">
          <summary>Returned to parent</summary>
          <pre>{activity.result}</pre>
        </details>
      ) : null}
      {activity.error ? <p className="settings-error">{activity.error}</p> : null}
    </div>
  );
}

function SubagentTurn({
  current,
  run,
  step,
}: {
  current: boolean;
  run: SubagentRunActivity;
  step: SubagentStep;
}): JSX.Element {
  return (
    <section className="subagent-step">
      <div className="subagent-step-heading">
        <strong>Turn {step.step}</strong>
        <span>{stepMetadata(step)}</span>
      </div>
      {step.reasoning ? (
        <details open={run.status === "running" && current}>
          <summary>Reasoning</summary>
          <pre>{step.reasoning}</pre>
        </details>
      ) : null}
      {step.tools.map((tool) => (
        <details className={tool.isError ? "subagent-tool failed" : "subagent-tool"} key={tool.call.id}>
          <summary>{tool.call.name} · {tool.content === undefined ? "running" : tool.isError ? "failed" : "completed"}</summary>
          <h4>Input</h4>
          <JsonInspector value={tool.call.input} />
          {tool.content !== undefined ? <><h4>Output</h4><pre>{tool.content}</pre></> : null}
        </details>
      ))}
      {step.response ? <><h4>Response</h4><pre>{step.response}</pre></> : null}
    </section>
  );
}

function activityRuns(activity: SubagentActivity): SubagentRunActivity[] {
  if (Array.isArray(activity.runs)) return activity.runs;

  // Activity saved by the first single-agent prototype remains inspectable.
  const legacy = activity as unknown as {
    task?: string;
    model?: string;
    providerId?: string;
    providerConnectionId?: string;
    status?: SubagentRunActivity["status"];
    steps?: SubagentStep[];
    result?: string;
    error?: string;
  };
  return [{
    id: "legacy-subagent",
    task: legacy.task ?? "Delegated task",
    status: legacy.status ?? "completed",
    ...(legacy.model ? { model: legacy.model } : {}),
    ...(legacy.providerId ? { providerId: legacy.providerId } : {}),
    ...(legacy.providerConnectionId ? { providerConnectionId: legacy.providerConnectionId } : {}),
    steps: legacy.steps ?? [],
    ...(legacy.result ? { result: legacy.result } : {}),
    ...(legacy.error ? { error: legacy.error } : {}),
  }];
}

function delegationLabel(access: "read" | "write", count: number): string {
  if (access === "write") return "Coding agent";
  return `${count} read agent${count === 1 ? "" : "s"}`;
}

function stepMetadata(step: SubagentStep): string {
  const parts: string[] = [];
  if (step.usage?.totalTokens) parts.push(`${step.usage.totalTokens.toLocaleString()} tokens`);
  if (step.durationMs) parts.push(`${(step.durationMs / 1000).toFixed(1)}s`);
  return parts.join(" · ");
}
