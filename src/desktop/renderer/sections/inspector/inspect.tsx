import { JsonInspector } from "./json-inspector.js";
import { labelFor, toolGeneratingLabel, toolStatus, type TimelineItem } from "../conversation/timeline-state.js";
import { SubagentInspector } from "./subagent.js";
import { ModelCallInspector } from "./model.js";
import type { ToolSpec } from "../../../../protocol.js";

export function Inspector({
  item,
  timeline,
  instructions,
  tools,
}: {
  item: TimelineItem;
  timeline: TimelineItem[];
  instructions: string[];
  tools: ToolSpec[];
}): JSX.Element {
  if (item.kind === "assistant") {
    return <ModelCallInspector item={item} timeline={timeline} instructions={instructions} tools={tools} />;
  }
  if (item.kind === "image-understanding") {
    return (
      <div className="inspector-card">
        <p className="eyebrow">Image understanding</p>
        <h3>{item.activity === "description" ? "Image description" : "Focused image inspection"}</h3>
        <p className="muted">
          {item.cached
            ? "Reused from local image cache"
            : [item.model, item.providerConnectionId, item.durationMs ? formatDuration(item.durationMs) : null]
              .filter(Boolean).join(" · ")}
        </p>
        <JsonInspector value={{
          image: item.imageName,
          activity: item.activity,
          cached: item.cached,
          ...(item.question ? { question: item.question } : {}),
          model: item.model,
          provider: item.providerId,
          connection: item.providerConnectionId,
          durationMs: item.durationMs,
          usage: item.usage,
        }} />
      </div>
    );
  }
  if (item.kind === "activity-group") {
    return <div className="inspector-card">Work details</div>;
  }
  if (item.kind === "tool-preparing") {
    return <div className="inspector-card">{toolGeneratingLabel(item.name)}</div>;
  }
  if (item.kind === "approval") {
    return (
      <div className="inspector-card">
        <p className="eyebrow">Command approval</p>
        <JsonInspector value={{ command: item.command, cwd: item.cwd, reason: item.reason }} />
      </div>
    );
  }
  if (item.kind !== "tool") {
    return (
      <div className="inspector-card">
        <p className="eyebrow">{labelFor(item.kind)}</p>
        <p>{item.text}</p>
      </div>
    );
  }

  const status = toolStatus(item);
  if (item.call.name === "delegate_task" && item.details) {
    return <SubagentInspector activity={item.details} />;
  }
  if (item.call.name === "mcp") {
    return <McpToolInspector item={item} />;
  }
  return (
    <div className="inspector-card">
      <p className="eyebrow">Tool call</p>
      <h3>{item.call.name}</h3>
      {item.durationMs ? <p className="inspector-duration">{formatDuration(item.durationMs)}</p> : null}
      <p className={`inspector-status ${status.className}`}>
        {status.marker} {status.label}
      </p>
      {item.call.inputRepair ? (
        <p className="inspector-repair"><strong>Input healed</strong> · {item.call.inputRepair}</p>
      ) : null}
      <h4>Input</h4>
      <JsonInspector value={item.call.input} />
      {item.phase === "completed" ? (
        <>
          <h4>Output</h4>
          <pre className={item.isError ? "inspector-tool-output failed" : "inspector-tool-output"}>
            {item.content || "No output"}
          </pre>
        </>
      ) : (
        <p className="muted">Waiting for the tool result.</p>
      )}
    </div>
  );
}

function McpToolInspector({ item }: { item: Extract<TimelineItem, { kind: "tool" }> }): JSX.Element {
  const input = recordValue(item.call.input);
  const action = input?.action === "search" ? "search" : "call";
  const title = item.presentation?.title ?? stringValue(input?.tool) ?? "MCP";
  const server = item.presentation?.subtitle ?? stringValue(input?.server) ?? "All configured servers";
  const shownInput = action === "call"
    ? input?.arguments ?? {}
    : { query: input?.query ?? "", server };
  const status = toolStatus(item);

  return (
    <div className="inspector-card mcp-tool-inspector">
      <p className="eyebrow">{action === "search" ? "MCP catalog" : "MCP tool"}</p>
      <h3>{title}</h3>
      <div className="inspector-tool-meta">
        <span><small>Server</small><strong>{server}</strong></span>
        <span><small>Duration</small><strong>{item.durationMs ? formatDuration(item.durationMs) : "Running"}</strong></span>
      </div>
      <p className={`inspector-status ${status.className}`}>
        {status.marker} {status.label}
      </p>
      {item.call.inputRepair ? (
        <p className="inspector-repair"><strong>Input healed</strong> · {item.call.inputRepair}</p>
      ) : null}
      <h4>Input</h4>
      <JsonInspector value={shownInput} />
      {item.phase === "completed" ? (
        <>
          <h4>{item.isError ? "Error" : "Output"}</h4>
          <pre className={item.isError ? "inspector-tool-output failed" : "inspector-tool-output"}>
            {item.content || "No output"}
          </pre>
        </>
      ) : (
        <p className="muted">Waiting for the MCP server.</p>
      )}
    </div>
  );
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function formatDuration(milliseconds: number): string {
  return milliseconds < 1_000 ? `${milliseconds}ms` : `${(milliseconds / 1_000).toFixed(1)}s`;
}
