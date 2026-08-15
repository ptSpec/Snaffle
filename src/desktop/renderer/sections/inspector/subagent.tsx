import type {
  SubagentActivity,
  SubagentProfileName,
  SubagentRunActivity,
  SubagentStep,
} from "../../../../agent/subagents/activity.js";
import { CopyableOutput, JsonInspector } from "./json-inspector.js";

export function SubagentInspector({ activity }: { activity: SubagentActivity }): JSX.Element {
  const runs = activityRuns(activity);
  const profile = activity.profile ?? (activity.access === "write" ? "implement" : "explore");
  return (
    <div className="subagent-inspector">
      <div className="subagent-heading">
        <div>
          <p className="eyebrow">Delegation</p>
          <h3>{delegationLabel(profile, runs.length)}</h3>
        </div>
        <div className="subagent-heading-badges">
          <span className={`subagent-profile-badge ${profile}`}>{profileLabel(profile)}</span>
          <span className={`subagent-status ${activity.status}`}>{activity.status}</span>
        </div>
      </div>

      <div className="subagent-runs">
        {runs.map((run, index) => (
          <details
            className={`subagent-run ${run.status}`}
            key={run.id}
            open={runs.length === 1 || run.status === "running"}
          >
            <summary>
              <span>{profileLabel(profile)} agent {index + 1}</span>
              <small>{run.status}</small>
            </summary>
            <div className="subagent-run-body">
              {run.model ? (
                <p className="subagent-provider">
                  {run.model} · {run.providerConnectionName ?? run.providerConnectionId}
                  {run.fallbackFromConnectionName ? ` · fallback from ${run.fallbackFromConnectionName}` : ""}
                </p>
              ) : null}
              <h4>Task</h4>
              <pre>{run.task}</pre>

              {run.steps.map((step) => (
                <SubagentTurn current={run.steps.at(-1)?.step === step.step} key={step.step} run={run} step={step} />
              ))}

              {run.result ? <><h4>Result</h4><CopyableOutput>{run.result}</CopyableOutput></> : null}
              {run.error ? <p className="settings-error">{run.error}</p> : null}
            </div>
          </details>
        ))}
      </div>

      {activity.result ? (
        <details className="subagent-return">
          <summary>Returned to parent</summary>
          <CopyableOutput>{activity.result}</CopyableOutput>
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
          {tool.content !== undefined ? <><h4>Output</h4><CopyableOutput>{tool.content}</CopyableOutput></> : null}
        </details>
      ))}
      {step.response ? <><h4>Response</h4><CopyableOutput>{step.response}</CopyableOutput></> : null}
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
    providerConnectionName?: string;
    fallbackFromConnectionName?: string;
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
    ...(legacy.providerConnectionName ? { providerConnectionName: legacy.providerConnectionName } : {}),
    ...(legacy.fallbackFromConnectionName ? { fallbackFromConnectionName: legacy.fallbackFromConnectionName } : {}),
    steps: legacy.steps ?? [],
    ...(legacy.result ? { result: legacy.result } : {}),
    ...(legacy.error ? { error: legacy.error } : {}),
  }];
}

function delegationLabel(profile: SubagentProfileName, count: number): string {
  return `${count} ${profileLabel(profile)} agent${count === 1 ? "" : "s"}`;
}

function profileLabel(profile: SubagentProfileName): string {
  return profile[0]!.toUpperCase() + profile.slice(1);
}

function stepMetadata(step: SubagentStep): string {
  const parts: string[] = [];
  if (step.usage?.totalTokens) parts.push(`${step.usage.totalTokens.toLocaleString()} tokens`);
  if (step.durationMs) parts.push(`${(step.durationMs / 1000).toFixed(1)}s`);
  return parts.join(" · ");
}
