import type { ToolSpec } from "../../../../protocol.js";
import type { TimelineItem } from "../conversation/timeline-state.js";
import { CopyableOutput, JsonInspector } from "./json-inspector.js";

type AssistantItem = Extract<TimelineItem, { kind: "assistant" }>;

export function ModelCallInspector({
  item,
  timeline,
  instructions,
  tools,
}: {
  item: AssistantItem;
  timeline: TimelineItem[];
  instructions: string[];
  tools: ToolSpec[];
}): JSX.Element {
  const messages = requestMessages(timeline, item.id, instructions);
  const availableTools = item.toolNames?.length
    ? tools.filter((tool) => item.toolNames!.includes(tool.name))
    : tools;

  return (
    <div className="model-call-inspector">
      <div className="inspector-card">
        <p className="eyebrow">Model call</p>
        <h3>{item.model ?? "Model"}</h3>
        <p className="muted">
          {[item.providerConnectionId, item.durationMs ? formatDuration(item.durationMs) : null]
            .filter(Boolean).join(" · ")}
        </p>
      </div>

      <details className="inspector-section" open>
        <summary>Input</summary>
        <h4>Instructions</h4>
        {instructions.length ? instructions.map((instruction, index) => (
          <pre key={index}>{instruction}</pre>
        )) : <p className="muted">No stored system instruction is available for this call.</p>}
        <h4>Request messages</h4>
        <JsonInspector value={messages} />
        <h4>Available tools · {availableTools.length}</h4>
        <JsonInspector value={availableTools} />
      </details>

      <details className="inspector-section" open>
        <summary>Output</summary>
        {item.reasoning ? <><h4>Reasoning</h4><CopyableOutput>{item.reasoning}</CopyableOutput></> : null}
        <h4>Response</h4>
        <CopyableOutput>{item.text || "No text response"}</CopyableOutput>
        {item.toolCalls?.length ? <><h4>Tool calls</h4><JsonInspector value={item.toolCalls} /></> : null}
      </details>

      <details className="inspector-section">
        <summary>Metadata</summary>
        <JsonInspector value={{
          model: item.model,
          provider: item.providerId,
          connection: item.providerConnectionId,
          finishReason: item.finishReason,
          durationMs: item.durationMs,
          usage: item.usage,
          sequence: item.sequence,
          requestMessages: messages.length,
          availableTools: availableTools.length,
        }} />
      </details>
    </div>
  );
}

function requestMessages(timeline: TimelineItem[], targetId: string, instructions: string[]): unknown[] {
  const items = flatten(timeline);
  const target = items.findIndex((item) => item.id === targetId);
  const before = items.slice(0, target < 0 ? items.length : target);
  const checkpoint = lastIndex(before, (item) => item.kind === "context" && item.status === "applied");
  const visible = checkpoint < 0 ? before : before.slice(checkpoint + 1);
  const lastUser = lastIndex(visible, (item) => item.kind === "user");
  const messages: unknown[] = instructions.map((content) => ({ role: "system", content }));
  const context = checkpoint < 0 ? undefined : before[checkpoint];
  if (context?.kind === "context" && context.summary) {
    messages.push({ role: "system", content: context.summary, source: "context summary" });
  }

  visible.forEach((entry, index) => {
    if (entry.kind === "user") {
      messages.push({ role: "user", content: entry.text, attachments: entry.attachments });
    } else if (entry.kind === "assistant") {
      messages.push({
        role: "assistant",
        content: entry.text,
        ...(index >= lastUser && entry.reasoning ? { reasoning: entry.reasoning } : {}),
        ...(entry.toolCalls?.length ? { toolCalls: entry.toolCalls } : {}),
      });
    } else if (entry.kind === "tool") {
      messages.push({
        role: "tool",
        toolCallId: entry.call.id,
        content: entry.content,
        ...(entry.isError ? { isError: true } : {}),
      });
    }
  });
  return messages;
}

function flatten(items: TimelineItem[]): TimelineItem[] {
  return items.flatMap((item) => item.kind === "activity-group" ? flatten(item.items) : [item]);
}

function lastIndex(items: TimelineItem[], matches: (item: TimelineItem) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (matches(items[index]!)) return index;
  }
  return -1;
}

function formatDuration(milliseconds: number): string {
  return milliseconds < 1000 ? `${milliseconds}ms` : `${(milliseconds / 1000).toFixed(1)}s`;
}
