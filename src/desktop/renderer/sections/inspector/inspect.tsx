import { CopyableOutput, JsonInspector } from "./json-inspector.js";
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
  let eyebrow = "Tool call";
  let title = item.presentation?.title ?? readableToolName(item.call.name);
  let subtitle = item.presentation?.subtitle;
  let shownInput = item.call.input;
  let waitingMessage = "Waiting for the tool result.";

  if (item.call.name === "mcp") {
    const input = recordValue(item.call.input);
    const action = input?.action === "search" ? "search" : "call";
    const server = item.presentation?.subtitle ?? stringValue(input?.server) ?? "All configured servers";
    eyebrow = action === "search" ? "MCP catalog" : "MCP tool";
    title = item.presentation?.title ?? stringValue(input?.tool) ?? "MCP";
    subtitle = server;
    shownInput = action === "call" ? input?.arguments ?? {} : { query: input?.query ?? "", server };
    waitingMessage = "Waiting for the MCP server.";
  }

  const duration = item.durationMs ? formatDuration(item.durationMs) : null;
  const structuredOutput = item.phase === "completed" && !item.isError
    ? parseJsonOutput(item.content)
    : undefined;
  return (
    <div className="tool-call-inspector">
      <header className="inspector-detail-header">
        <p className="eyebrow">{eyebrow}</p>
        <div className="inspector-detail-title">
          <span className={`inspector-detail-dot ${status.className}`} aria-hidden="true" />
          <h3>{title}</h3>
          {duration ? <time>{duration}</time> : null}
        </div>
        <p className="inspector-detail-meta">
          {[status.label, subtitle].filter(Boolean).join(" · ")}
        </p>
      </header>
      {item.call.inputRepair ? (
        <p className="inspector-repair"><strong>Input healed</strong> · {item.call.inputRepair}</p>
      ) : null}

      <details className="inspector-section" open>
        <summary>{item.isError ? "Error" : "Output"}</summary>
        {item.phase === "completed" ? (
          structuredOutput !== undefined ? (
            <JsonInspector value={structuredOutput} />
          ) : (
            <CopyableOutput className={item.isError ? "inspector-tool-output failed" : "inspector-tool-output"}>
              {item.content || "No output"}
            </CopyableOutput>
          )
        ) : <p className="muted">{waitingMessage}</p>}
      </details>

      <details className="inspector-section">
        <summary>Input</summary>
        <JsonInspector value={shownInput} />
      </details>

      <details className="inspector-section">
        <summary>Metadata</summary>
        <JsonInspector value={{
          tool: item.call.name,
          status: status.label,
          durationMs: item.durationMs,
          exitCode: item.exitCode,
          isError: item.isError,
          sequence: item.sequence,
        }} />
      </details>
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

function parseJsonOutput(value: string | undefined): Record<string, unknown> | unknown[] | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : recordValue(parsed);
  } catch {
    return undefined;
  }
}

function readableToolName(name: string): string {
  const label = name.replaceAll("_", " ");
  return label[0]!.toUpperCase() + label.slice(1);
}

function formatDuration(milliseconds: number): string {
  return milliseconds < 1_000 ? `${milliseconds}ms` : `${(milliseconds / 1_000).toFixed(1)}s`;
}
