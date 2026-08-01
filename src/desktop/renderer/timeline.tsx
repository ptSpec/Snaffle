import {
  Children,
  isValidElement,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js/lib/common";
import type { RunEvent, ToolCall } from "../../protocol.js";

export type TimelineItem =
  | { id: string; kind: "user" | "error"; text: string }
  | { id: string; kind: "assistant"; text: string; streaming: boolean }
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

  if (item.kind === "assistant") {
    return (
      <article className="message assistant">
        <div className={item.streaming ? "markdown-content streaming" : "markdown-content"}>
          <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]} skipHtml>
            {item.text}
          </ReactMarkdown>
          {item.streaming ? <span className="streaming-cursor" aria-hidden="true" /> : null}
        </div>
      </article>
    );
  }

  return (
    <article className={`message ${item.kind}`}>
      {item.kind === "error" ? <span className="message-label">Run failed</span> : null}
      <p>{item.text}</p>
    </article>
  );
}

const markdownComponents: Components = {
  a({ href, children }) {
    const external = href?.startsWith("https://") || href?.startsWith("http://");
    return (
      <a
        href={external ? href : undefined}
        onClick={(event) => {
          event.preventDefault();
          if (external && href) void window.desktop.openExternal(href);
        }}
      >
        {children}
      </a>
    );
  },
  pre: CodeBlock,
};

function CodeBlock({ children }: ComponentProps<"pre">): JSX.Element {
  const [copied, setCopied] = useState(false);
  const child = Children.toArray(children)[0];
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    return <pre>{children}</pre>;
  }

  const code = String(child.props.children).replace(/\n$/, "");
  const language = /language-([\w-]+)/.exec(child.props.className ?? "")?.[1] ?? "text";
  const highlighted = hljs.getLanguage(language)
    ? hljs.highlight(code, { language, ignoreIllegals: true }).value
    : null;

  async function copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{language}</span>
        <button type="button" onClick={() => void copyCode()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        {highlighted ? (
          <code
            className={child.props.className}
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        ) : (
          <code>{code}</code>
        )}
      </pre>
    </div>
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
  if (event.type === "model.delta" && event.text) {
    setTimeline((items) => {
      const existing = streamingAssistantIndex(items);
      if (existing === -1) {
        return [
          ...items,
          { id: newTimelineId(), kind: "assistant", text: event.text, streaming: true },
        ];
      }
      return items.map((item, index) =>
        index === existing && item.kind === "assistant"
          ? { ...item, text: item.text + event.text }
          : item,
      );
    });
    return;
  }

  if (event.type === "model.completed") {
    setTimeline((items) => {
      const existing = streamingAssistantIndex(items);
      if (existing !== -1) {
        return items.map((item, index) =>
          index === existing && item.kind === "assistant"
            ? { ...item, text: event.response.text, streaming: false }
            : item,
        );
      }
      if (!event.response.text.trim()) return items;
      return [
        ...items,
        { id: newTimelineId(), kind: "assistant", text: event.response.text, streaming: false },
      ];
    });
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
      ...stopStreaming(items),
      { id: newTimelineId(), kind: "error", text: event.message },
    ]);
    return;
  }

}

function streamingAssistantIndex(items: TimelineItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "assistant" && item.streaming) return index;
  }
  return -1;
}

function stopStreaming(items: TimelineItem[]): TimelineItem[] {
  return items.map((item) =>
    item.kind === "assistant" && item.streaming ? { ...item, streaming: false } : item,
  );
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
  return "Run failed";
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
