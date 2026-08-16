import { objectInput, stringField, ToolInputError, type Tool } from "./tool.js";
import type { Message } from "../protocol.js";

const STATUSES = ["pending", "in_progress", "completed", "blocked"] as const;
export type PlanStatus = typeof STATUSES[number];
export type PlanItem = { step: string; status: PlanStatus };

export function updatePlanTool(): Tool {
  return {
    name: "update_plan",
    description:
      "Create or replace a short task plan when work has several meaningful steps. Keep it current as work progresses. An active plan persists until every item is completed or blocked; mark an item blocked when progress requires user input or an external change.",
    exampleInput: {
      items: [
        { step: "Inspect the current implementation", status: "completed" },
        { step: "Implement the focused change", status: "in_progress" },
        { step: "Run relevant verification", status: "pending" },
      ],
    },
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          description: "Required. Complete current plan with one to ten concise items.",
          items: {
            type: "object",
            properties: {
              step: { type: "string", description: "Required. Concise outcome or task step." },
              status: { type: "string", enum: STATUSES, description: "Required. Current state of this item." },
            },
            required: ["step", "status"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
    presentation() {
      return { title: "Update plan" };
    },
    async execute(_workspace, rawInput) {
      const items = parsePlanItems(rawInput);
      const completed = items.filter((item) => item.status === "completed").length;
      return {
        content:
          `Plan updated: ${completed}/${items.length} completed.\n${formatPlan(items)}` +
          (hasActionablePlan(items) ? "\n\nContinue with the current or next pending item." : ""),
      };
    },
  };
}

export function parsePlanItems(rawInput: unknown): PlanItem[] {
  const input = objectInput(rawInput);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 10) {
    throw new ToolInputError("items must contain one to ten plan items");
  }
  const items = input.items.map((rawItem, index) => {
    const item = objectInput(rawItem);
    const step = stringField(item, "step")!.trim();
    const status = stringField(item, "status") as PlanStatus;
    if (!step) throw new ToolInputError(`items item ${index + 1} step must not be blank`);
    if (!STATUSES.includes(status)) {
      throw new ToolInputError(`items item ${index + 1} status must be pending, in_progress, completed, or blocked`);
    }
    return { step, status };
  });
  if (items.filter((item) => item.status === "in_progress").length > 1) {
    throw new ToolInputError("only one plan item may be in progress");
  }
  return items;
}

export function hasActionablePlan(items: PlanItem[]): boolean {
  return items.some((item) => item.status === "pending" || item.status === "in_progress");
}

export function formatPlan(items: PlanItem[]): string {
  return items.map((item, index) => `${index + 1}. ${marker(item.status)} ${item.step}`).join("\n");
}

export function planContinuationMessage(items: PlanItem[]): Message {
  return {
    role: "user",
    internal: true,
    content:
      "Snaffle plan continuation notice, not a new user request: The active plan still has actionable items. " +
      "Continue the current or next pending step, update the plan as progress changes, or mark genuinely blocked work as blocked.\n\n" +
      formatPlan(items),
  };
}

export function withRecoveredPlan(task: string, items: PlanItem[]): string {
  return (
    "Unfinished plan from an earlier run. Use it as context when it remains relevant; the current user request takes priority.\n\n" +
    `${formatPlan(items)}\n\nCurrent user request:\n${task}`
  );
}

function marker(status: PlanStatus): string {
  if (status === "completed") return "[completed]";
  if (status === "in_progress") return "[in progress]";
  if (status === "blocked") return "[blocked]";
  return "[pending]";
}
