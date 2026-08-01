import type { RunEvent, ToolCall } from "../../protocol.js";

export type TimelineItem =
  | { id: string; kind: "user" | "assistant" | "notice" | "error"; text: string }
  | {
      id: string;
      kind: "tool";
      call: ToolCall;
      phase: "running" | "completed";
      content?: string;
      isError?: boolean;
      exitCode?: number | null;
    };

let itemNumber = 0;

export function TimelineEntry({
  item,
  selected,
  onSelect,
}: {
  item: TimelineItem;
  selected: boolean;
  onSelect: (id: string) => void;
}): JSX.Element {
  if (item.kind === "tool") {
    const status = toolStatus(item);
    return (
      <button
        className={selected ? "tool-card selected" : "tool-card"}
        type="button"
        onClick={() => onSelect(item.id)}
      >
        <span className={`tool-marker ${status.className}`} aria-hidden="true">
          {status.marker}
        </span>
        <span className="tool-card-body">
          <span className="tool-card-title">
            <strong>{item.call.name}</strong>
            <span>{status.label}</span>
          </span>
          <span className="tool-summary">{toolSummary(item)}</span>
        </span>
      </button>
    );
  }

  return (
    <article className={`message ${item.kind}`}>
      <span className="message-label">{labelFor(item.kind)}</span>
      <p>{item.text}</p>
    </article>
  );
}

export function Inspector({ item }: { item: TimelineItem }): JSX.Element {
  if (item.kind !== "tool") {
    return (
      <div className="inspector-card">
        <p className="eyebrow">{labelFor(item.kind)}</p>
        <p>{item.text}</p>
      </div>
    );
  }

  const status = toolStatus(item);
  return (
    <div className="inspector-card">
      <p className="eyebrow">Tool call</p>
      <h3>{item.call.name}</h3>
      <p className={`inspector-status ${status.className}`}>
        {status.marker} {status.label}
      </p>
      <h4>Input</h4>
      <pre>{formatJson(item.call.input)}</pre>
      {item.phase === "completed" ? (
        <>
          <h4>Output</h4>
          <pre>{item.content || "No output"}</pre>
        </>
      ) : (
        <p className="muted">Waiting for the tool result.</p>
      )}
    </div>
  );
}

export function addRunEvent(
  event: RunEvent,
  setTimeline: (update: (items: TimelineItem[]) => TimelineItem[]) => void,
): void {
  if (event.type === "model.completed" && event.response.text.trim()) {
    setTimeline((items) => [
      ...items,
      { id: newTimelineId(), kind: "assistant", text: event.response.text },
    ]);
    return;
  }

  if (event.type === "tool.started") {
    setTimeline((items) => [
      ...items,
      { id: event.call.id, kind: "tool", call: event.call, phase: "running" },
    ]);
    return;
  }

  if (event.type === "tool.completed") {
    setTimeline((items) => {
      const completed: TimelineItem = {
        id: event.call.id,
        kind: "tool",
        call: event.call,
        phase: "completed",
        content: event.content,
        isError: event.isError,
        ...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }),
      };
      const existing = items.findIndex((item) => item.id === event.call.id);
      if (existing === -1) return [...items, completed];
      return items.map((item, index) => (index === existing ? completed : item));
    });
    return;
  }

  if (event.type === "run.failed") {
    setTimeline((items) => [
      ...items,
      { id: newTimelineId(), kind: "error", text: event.message },
    ]);
    return;
  }

  if (event.type === "run.completed") {
    setTimeline((items) => [
      ...items,
      { id: newTimelineId(), kind: "notice", text: `Run completed in ${event.steps} step(s).` },
    ]);
  }
}

export function newTimelineId(): string {
  itemNumber += 1;
  return `event-${itemNumber}`;
}

function toolStatus(item: Extract<TimelineItem, { kind: "tool" }>): {
  marker: string;
  label: string;
  className: string;
} {
  if (item.phase === "running") return { marker: "…", label: "Running", className: "running" };
  if (item.isError) return { marker: "×", label: "Tool error", className: "tool-error" };
  if (typeof item.exitCode === "number" && item.exitCode !== 0) {
    return { marker: "!", label: `Command exited ${item.exitCode}`, className: "command-error" };
  }
  return { marker: "✓", label: "Completed", className: "success" };
}

function toolSummary(item: Extract<TimelineItem, { kind: "tool" }>): string {
  if (item.phase === "running") return compactJson(item.call.input);
  return firstLine(item.content || "No output");
}

function labelFor(kind: Exclude<TimelineItem["kind"], "tool">): string {
  if (kind === "user") return "You";
  if (kind === "assistant") return "Assistant";
  if (kind === "error") return "Run failed";
  return "Run status";
}

function compactJson(value: unknown): string {
  return formatJson(value).replaceAll("\n", " ").slice(0, 240);
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function firstLine(value: string): string {
  return value.split("\n", 1)[0] || "No output";
}
