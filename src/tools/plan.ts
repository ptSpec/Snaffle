import { objectInput, stringField, ToolInputError, type Tool } from "./tool.js";

const STATUSES = ["pending", "in_progress", "completed", "blocked"] as const;
type PlanStatus = typeof STATUSES[number];

export function updatePlanTool(): Tool {
  return {
    name: "update_plan",
    description:
      "Create or replace a short task plan when work has several meaningful steps. Keep it current as work progresses. Do not finish while actionable items remain; mark an item blocked when progress requires user input or an external change.",
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

      const completed = items.filter((item) => item.status === "completed").length;
      const actionable = items.some((item) => item.status === "pending" || item.status === "in_progress");
      const rows = items.map((item, index) => `${index + 1}. ${marker(item.status)} ${item.step}`);
      return {
        content: `Plan updated: ${completed}/${items.length} completed.\n${rows.join("\n")}${actionable ? "\n\nContinue with the current or next pending item." : ""}`,
      };
    },
  };
}

function marker(status: PlanStatus): string {
  if (status === "completed") return "[completed]";
  if (status === "in_progress") return "[in progress]";
  if (status === "blocked") return "[blocked]";
  return "[pending]";
}
