import type { AttachmentRef } from "../../../../attachments/types.js";
import type { CommandApprovalDecision, RunEvent, SourceReference, ToolCall, ToolPresentation, Usage } from "../../../../protocol.js";
import type { ContextCheckpoint } from "../../../../context/projection.js";
import type { DesktopEntry } from "../../../api.js";
import { applySubagentUpdate, type SubagentActivity } from "../../../../agent/subagents/activity.js";

export type TimelineItem =
  | { id: string; kind: "user"; text: string; attachments?: AttachmentRef[]; sequence: number; entryId?: string }
  | { id: string; kind: "error"; text: string; restoreSequence?: number }
  | { id: string; kind: "assistant"; text: string; streaming: boolean; intermediate?: boolean; reasoning?: string; toolCalls?: ToolCall[]; toolNames?: string[]; finishReason?: string; model?: string; providerId?: string; providerConnectionId?: string; usage?: Usage; durationMs?: number; sources?: SourceReference[]; sequence?: number; entryId?: string }
  | { id: string; kind: "activity-group"; items: TimelineItem[] }
  | { id: string; kind: "reasoning"; step: number; text: string; streaming: boolean; status?: string | undefined; retryAt?: number | undefined }
  | { id: string; kind: "tool-preparing"; step: number; index: number; name: string; argumentChars: number; startedAt: number }
  | { id: string; kind: "retry"; step: number; attempt: number; maxRetries: number; text: string }
  | {
      id: string;
      kind: "image-understanding";
      text: string;
      imageName: string;
      activity: "description" | "inspection";
      cached: boolean;
      model: string;
      providerId: string;
      providerConnectionId: string;
      usage?: Usage;
      durationMs?: number;
      question?: string;
    }
  | {
      id: string;
      kind: "context";
      status: "prepared" | "applied" | "failed";
      sourceCharacters?: number;
      summaryCharacters?: number;
      injectedCharacters?: number;
      estimatedTokens?: number;
      model?: string;
      summary?: string;
      text?: string;
    }
  | { id: string; kind: "approval"; command: string; cwd: string; reason: string; suggestedPaths?: string[]; decision?: CommandApprovalDecision }
  | {
      id: string;
      kind: "tool";
      call: ToolCall;
      phase: "running" | "completed";
      content?: string;
      isError?: boolean;
      exitCode?: number | null;
      sequence?: number;
      details?: SubagentActivity;
      durationMs?: number;
      presentation?: ToolPresentation;
    };

export type KeepableTimelineItem = Extract<TimelineItem, { kind: "assistant" }>;

let itemNumber = 0;

export function addRunEvent(
  event: RunEvent,
  setTimeline: (update: (items: TimelineItem[]) => TimelineItem[]) => void,
): void {
  if (event.type === "image.understanding.completed") {
    const action = event.kind === "description" ? "Image description" : "Focused image inspection";
    setTimeline((items) => [
      ...items,
      {
        id: newTimelineId(),
        kind: "image-understanding",
        text: event.cached
          ? `${action} reused from local cache for ${event.imageName}`
          : `${action} completed for ${event.imageName} by ${event.model}`,
        imageName: event.imageName,
        activity: event.kind,
        cached: event.cached,
        model: event.model,
        providerId: event.providerId,
        providerConnectionId: event.providerConnectionId,
        ...(event.usage ? { usage: event.usage } : {}),
        ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
        ...(event.question ? { question: event.question } : {}),
      },
    ]);
    return;
  }

  if (event.type === "context.compaction.started") {
    setTimeline((items) => [
      ...items,
      { id: `context-pending-${event.afterSequence}`, kind: "context", status: "prepared", text: "Preparing compact context…" },
    ]);
    return;
  }

  if (event.type === "context.compaction.completed") {
    setTimeline((items) => [
      ...items.filter((item) => item.id !== `context-pending-${event.afterSequence}`),
      {
        id: `context-${event.id}`,
        kind: "context",
        status: "prepared",
        sourceCharacters: event.sourceCharacters,
        summaryCharacters: event.summaryCharacters,
        summary: event.summary,
        model: event.model,
      },
    ]);
    return;
  }

  if (event.type === "context.compaction.failed") {
    setTimeline((items) => [
      ...items.filter((item) => item.kind !== "context" || item.text !== "Preparing compact context…"),
      { id: newTimelineId(), kind: "context", status: "failed", text: event.message },
    ]);
    return;
  }

  if (event.type === "context.applied") {
    setTimeline((items) => items.map((item) =>
      item.id === `context-${event.id}` && item.kind === "context"
        ? { ...item, status: "applied", injectedCharacters: event.injectedCharacters, estimatedTokens: event.estimatedTokens }
        : item,
    ));
    return;
  }

  if (event.type === "permission.requested") {
    setTimeline((items) => [
      ...items,
      {
        id: event.id,
        kind: "approval",
        command: event.command,
        cwd: event.cwd,
        reason: event.reason,
        ...(event.suggestedPaths?.length ? { suggestedPaths: event.suggestedPaths } : {}),
      },
    ]);
    return;
  }

  if (event.type === "permission.resolved") {
    setTimeline((items) => items.map((item) =>
      item.kind === "approval" && item.id === event.id
        ? { ...item, decision: event.decision }
        : item,
    ));
    return;
  }

  if (event.type === "model.started") {
    setTimeline((items) => [
      ...items,
      { id: newTimelineId(), kind: "reasoning", step: event.step, text: "", streaming: true },
    ]);
    return;
  }

  if (event.type === "model.reasoning.delta" && event.text) {
    setTimeline((items) =>
      items.map((item) =>
        item.kind === "reasoning" && item.step === event.step && item.streaming
          ? { ...item, text: item.text + event.text, status: undefined, retryAt: undefined }
          : item,
      ),
    );
    return;
  }

  if (event.type === "model.retry") {
    setTimeline((items) => {
      const ready = finishReasoning(
        items.filter(
          (item) =>
            !(item.kind === "assistant" && item.streaming) &&
            !(item.kind === "tool-preparing" && item.step === event.step),
        ),
        event.step,
        "",
      );
      return [
        ...ready,
        {
          id: newTimelineId(),
          kind: "retry",
          step: event.step,
          attempt: event.attempt,
          maxRetries: event.maxRetries,
          text: event.message,
        },
        {
          id: newTimelineId(),
          kind: "reasoning",
          step: event.step,
          text: "",
          streaming: true,
          retryAt: Date.now() + event.delayMs,
        },
      ];
    });
    return;
  }

  if (event.type === "model.tool.delta") {
    setTimeline((items) => {
      const ready = finishReasoning(items, event.step, "");
      const existing = ready.findIndex(
        (item) =>
          item.kind === "tool-preparing" &&
          item.step === event.step &&
          item.index === event.index,
      );
      if (existing === -1) {
        return [
          ...ready,
          {
            id: newTimelineId(),
            kind: "tool-preparing",
            step: event.step,
            index: event.index,
            name: event.name,
            argumentChars: event.argumentChars,
            startedAt: Date.now(),
          },
        ];
      }
      return ready.map((item, index) =>
        index === existing && item.kind === "tool-preparing"
          ? { ...item, name: event.name, argumentChars: event.argumentChars }
          : item,
      );
    });
    return;
  }

  if (event.type === "model.delta" && event.text) {
    setTimeline((items) => {
      const ready = finishReasoning(items, event.step, "");
      const existing = streamingAssistantIndex(ready);
      if (existing === -1) {
        return [
          ...ready,
          { id: newTimelineId(), kind: "assistant", text: event.text, streaming: true },
        ];
      }
      return ready.map((item, index) =>
        index === existing && item.kind === "assistant"
          ? { ...item, text: item.text + event.text }
          : item,
      );
    });
    return;
  }

  if (event.type === "model.completed") {
    setTimeline((items) => {
      const completedReasoning = finishReasoning(
        items.filter((item) => item.kind !== "tool-preparing" || item.step !== event.step),
        event.step,
        event.response.reasoning ?? "",
      );
      const existing = streamingAssistantIndex(completedReasoning);
      const intermediate = event.response.toolCalls.length > 0;
      const metadata = {
        model: event.model,
        providerId: event.providerId,
        providerConnectionId: event.providerConnectionId,
        ...(event.response.usage ? { usage: event.response.usage } : {}),
        durationMs: event.durationMs,
        ...(event.response.sources?.length ? { sources: event.response.sources } : {}),
        ...(event.response.reasoning ? { reasoning: event.response.reasoning } : {}),
        ...(event.response.toolCalls.length ? { toolCalls: event.response.toolCalls } : {}),
        ...(event.response.finishReason ? { finishReason: event.response.finishReason } : {}),
      };
      let completed = completedReasoning;
      if (existing !== -1) {
        completed = completedReasoning.map((item, index) =>
          index === existing && item.kind === "assistant"
            ? { ...item, text: event.response.text, streaming: false, intermediate, sequence: event.sequence, ...metadata }
            : item,
        );
      } else if (event.response.text.trim() || intermediate) {
        completed = [
          ...completedReasoning,
          { id: newTimelineId(), kind: "assistant", text: event.response.text, streaming: false, intermediate, sequence: event.sequence, ...metadata },
        ];
      }
      return intermediate ? completed : collapseCompletedRuns(completed);
    });
    return;
  }

  if (event.type === "run.completed") {
    setTimeline((items) => collapseCompletedRuns(stopActivity(items)));
    return;
  }

  if (event.type === "run.persisted") {
    const entryIds = new Map(event.entries.map((entry) => [entry.sequence, entry.entryId]));
    setTimeline((items) => items.map((item) => {
      if ((item.kind !== "user" && item.kind !== "assistant") || item.sequence === undefined) return item;
      const entryId = entryIds.get(item.sequence);
      return entryId ? { ...item, entryId } : item;
    }));
    return;
  }

  if (event.type === "tool.started") {
    setTimeline((items) => [
      ...items.filter(
        (item) =>
          item.kind !== "tool-preparing" ||
          item.step !== event.step ||
          item.index !== event.index,
      ),
      { id: event.call.id, kind: "tool", call: event.call, phase: "running" },
    ]);
    return;
  }

  if (event.type === "tool.updated") {
    setTimeline((items) => items.map((item) => {
      if (item.kind !== "tool" || item.id !== event.callId) return item;
      const details = applySubagentUpdate(item.details, event.update);
      return details ? { ...item, details } : item;
    }));
    return;
  }

  if (event.type === "tool.completed") {
    setTimeline((items) => {
      const existing = items.findIndex((item) => item.id === event.call.id);
      const runningCall = existing === -1 ? undefined : items[existing];
      const completed: TimelineItem = {
        id: event.call.id,
        kind: "tool",
        call: runningCall?.kind === "tool" ? runningCall.call : event.call,
        phase: "completed",
        content: event.content,
        isError: event.isError,
        sequence: event.sequence,
        ...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }),
        ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
        ...(event.presentation ? { presentation: event.presentation } : {}),
        ...(event.details
          ? { details: event.details }
          : runningCall?.kind === "tool" && runningCall.details
            ? { details: runningCall.details }
            : {}),
      };
      if (existing === -1) return [...items, completed];
      return items.map((item, index) => (index === existing ? completed : item));
    });
    return;
  }

  if (event.type === "run.failed") {
    setTimeline((items) => {
      const restoreSequence = [...items].reverse().find((item) => item.kind === "user")?.sequence;
      return [
        ...stopActivity(items),
        {
          id: newTimelineId(),
          kind: "error",
          text: event.message,
          ...(restoreSequence === undefined ? {} : { restoreSequence }),
        },
      ];
    });
    return;
  }

}

export function timelineFromEntries(entries: DesktopEntry[], checkpoints: ContextCheckpoint[] = []): TimelineItem[] {
  const items: TimelineItem[] = [];
  const calls = new Map<string, ToolCall>();

  entries.forEach(({ id: entryId, sequence, message }, index) => {
    if (message.role === "system") return;
    if (message.role === "user") {
      if (message.internal) return;
      items.push({
        id: `entry-${entryId}`,
        kind: "user",
        text: message.content,
        sequence,
        entryId,
        ...(message.attachments?.length ? { attachments: message.attachments } : {}),
      });
      return;
    }
    if (message.role === "assistant") {
      const intermediate = Boolean(message.toolCalls?.length);
      if (message.reasoning?.trim()) {
        items.push({
          id: `history-reasoning-${index}`,
          kind: "reasoning",
          step: index,
          text: message.reasoning,
          streaming: false,
        });
      }
      if (message.content.trim() || intermediate) {
        items.push({
          id: `entry-${entryId}`,
          kind: "assistant",
          text: message.content,
          streaming: false,
          intermediate,
          sequence,
          entryId,
          ...(message.model ? { model: message.model } : {}),
          ...(message.providerId ? { providerId: message.providerId } : {}),
          ...(message.providerConnectionId ? { providerConnectionId: message.providerConnectionId } : {}),
          ...(message.usage ? { usage: message.usage } : {}),
          ...(message.durationMs === undefined ? {} : { durationMs: message.durationMs }),
          ...(message.sources?.length ? { sources: message.sources } : {}),
          ...(message.reasoning ? { reasoning: message.reasoning } : {}),
          ...(message.toolCalls?.length ? { toolCalls: message.toolCalls } : {}),
          ...(message.toolNames?.length ? { toolNames: message.toolNames } : {}),
          ...(message.finishReason ? { finishReason: message.finishReason } : {}),
        });
      }
      for (const call of message.toolCalls ?? []) calls.set(call.id, call);
      return;
    }

    if (message.role !== "tool") return;
    const call = calls.get(message.toolCallId);
    if (!call) return;
    items.push({
      id: call.id,
      kind: "tool",
      call,
      phase: "completed",
      content: message.content,
      sequence,
      ...(message.isError === undefined ? {} : { isError: message.isError }),
      ...(message.exitCode === undefined ? {} : { exitCode: message.exitCode }),
      ...(message.details ? { details: message.details } : {}),
      ...(message.durationMs === undefined ? {} : { durationMs: message.durationMs }),
      ...(message.presentation ? { presentation: message.presentation } : {}),
    });
  });

  for (const checkpoint of checkpoints) {
    const contextItem: TimelineItem = {
      id: `context-${checkpoint.id}`,
      kind: "context",
      status: checkpoint.appliedAt ? "applied" : "prepared",
      sourceCharacters: checkpoint.sourceCharacters,
      summaryCharacters: checkpoint.summaryCharacters,
      ...(checkpoint.injectedCharacters === null ? {} : { injectedCharacters: checkpoint.injectedCharacters }),
      model: checkpoint.model,
      summary: checkpoint.summary,
    };
    const index = items.findIndex((item) => "sequence" in item &&
      typeof item.sequence === "number" && item.sequence > checkpoint.createdAfterSequence);
    if (index === -1) items.push(contextItem);
    else items.splice(index, 0, contextItem);
  }

  return collapseCompletedRuns(items);
}

export function findTimelineItem(items: TimelineItem[], id: string | null): TimelineItem | null {
  if (!id) return null;
  for (const item of items) {
    if (item.id === id) return item;
    if (item.kind === "activity-group") {
      const child = findTimelineItem(item.items, id);
      if (child) return child;
    }
  }
  return null;
}

export function modelCallsForReasoning(
  items: TimelineItem[],
): Map<string, Extract<TimelineItem, { kind: "assistant" }>> {
  const calls = new Map<string, Extract<TimelineItem, { kind: "assistant" }>>();
  const pendingReasoning: string[] = [];

  function visit(entries: TimelineItem[]): void {
    for (const item of entries) {
      if (item.kind === "activity-group") {
        visit(item.items);
      } else if (item.kind === "reasoning") {
        pendingReasoning.push(item.id);
      } else if (item.kind === "assistant") {
        for (const reasoningId of pendingReasoning.splice(0)) calls.set(reasoningId, item);
      } else if (item.kind === "user") {
        pendingReasoning.length = 0;
      }
    }
  }

  visit(items);
  return calls;
}

function collapseCompletedRuns(items: TimelineItem[]): TimelineItem[] {
  const collapsed: TimelineItem[] = [];
  let run: TimelineItem[] = [];

  function flush(): void {
    if (!run.length) return;
    if (run.some((item) => item.kind === "activity-group")) {
      collapsed.push(...run);
      run = [];
      return;
    }

    let finalIndex = -1;
    for (let index = run.length - 1; index >= 0; index -= 1) {
      const item = run[index];
      if (item?.kind === "assistant" && !item.intermediate && !item.streaming) {
        finalIndex = index;
        break;
      }
    }
    if (finalIndex > 0) {
      collapsed.push(
        { id: newTimelineId(), kind: "activity-group", items: run.slice(0, finalIndex) },
        ...run.slice(finalIndex),
      );
    } else {
      collapsed.push(...run);
    }
    run = [];
  }

  for (const item of items) {
    if (item.kind === "user") {
      flush();
      collapsed.push(item);
    } else {
      run.push(item);
    }
  }
  flush();
  return collapsed;
}

function streamingAssistantIndex(items: TimelineItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "assistant" && item.streaming) return index;
  }
  return -1;
}

function finishReasoning(items: TimelineItem[], step: number, finalText: string): TimelineItem[] {
  return items.flatMap((item) => {
    if (item.kind !== "reasoning" || item.step !== step || !item.streaming) return [item];
    const text = finalText || item.text;
    return text.trim() ? [{ ...item, text, streaming: false }] : [];
  });
}

function stopActivity(items: TimelineItem[]): TimelineItem[] {
  return items.flatMap((item) => {
    if (item.kind === "tool-preparing") return [];
    if (item.kind === "reasoning" && item.streaming) {
      return item.text.trim() ? [{ ...item, streaming: false }] : [];
    }
    if (item.kind === "assistant" && item.streaming) return [{ ...item, streaming: false }];
    return [item];
  });
}

export function newTimelineId(): string {
  itemNumber += 1;
  return `event-${itemNumber}`;
}

export type SaveableTimelineItem = Extract<TimelineItem, { kind: "assistant" }>;

export function toolGeneratingLabel(name: string): string {
  if (name === "run_command") return "Generating command…";
  if (name === "delegate_task") return "Preparing delegation…";
  return name ? `Generating ${name} call…` : "Generating tool call…";
}


export function toolStatus(item: Extract<TimelineItem, { kind: "tool" }>): {
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

export function labelFor(kind: Exclude<TimelineItem["kind"], "tool">): string {
  if (kind === "user") return "You";
  if (kind === "assistant") return "Assistant";
  if (kind === "reasoning") return "Thinking";
  if (kind === "tool-preparing") return "Tool call";
  if (kind === "retry") return "Model retry";
  if (kind === "image-understanding") return "Image understanding";
  if (kind === "activity-group") return "Work details";
  if (kind === "context") return "Context";
  return "Run failed";
}
