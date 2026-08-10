import type { SubagentActivityUpdate } from "./activity.js";
import type { SubagentRequest } from "./runner.js";
import { objectInput, stringField, ToolInputError, type Tool } from "../../tools/tool.js";

export function delegateTaskTool(
  run: (
    request: SubagentRequest,
    onUpdate?: (update: SubagentActivityUpdate) => Promise<void>,
  ) => Promise<string>,
): Tool {
  return {
    name: "delegate_task",
    description:
      "Delegate focused work to separate agents. Profiles: explore locates and understands using read and search only—no commands or edits; review critiques known code or diffs using read, search, and read-only Git inspection—no tests or edits; test reproduces and diagnoses using read, search, and approved test, lint, typecheck, and Git inspection commands—no edits; implement changes and verifies using the full coding tools. Explore, review, and test accept one to four independent tasks in parallel; implement accepts exactly one task. Continue using the returned structured results.",
    exampleInput: {
      profile: "explore",
      tasks: [
        "Find where provider settings are stored.",
        "Review the provider UI for relevant components.",
      ],
    },
    inputSchema: {
      type: "object",
      properties: {
        profile: {
          type: "string",
          enum: ["explore", "review", "test", "implement"],
          description: "Required. Choose by the capabilities needed; each profile's restrictions in the tool description are enforced.",
        },
        tasks: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          description: "Required. One to four complete, independent tasks. Implement requires exactly one task.",
          items: { type: "string", minLength: 1 },
        },
      },
      required: ["profile", "tasks"],
      additionalProperties: false,
    },
    async execute(_workspace, rawInput, context) {
      const input = objectInput(rawInput);
      const profile = stringField(input, "profile") as SubagentRequest["profile"];
      if (!["explore", "review", "test", "implement"].includes(profile)) {
        throw new ToolInputError("profile must be explore, review, test, or implement");
      }
      if (!Array.isArray(input.tasks) || input.tasks.length === 0 || input.tasks.length > 4) {
        throw new ToolInputError("tasks must be an array containing one to four task strings");
      }
      const tasks = input.tasks.map((task, index) => {
        if (typeof task !== "string" || !task.trim()) {
          throw new ToolInputError(`tasks item ${index + 1} must be a non-empty string`);
        }
        return task.trim();
      });
      if (profile === "implement" && tasks.length !== 1) {
        throw new ToolInputError("implement requires exactly one task");
      }
      return { content: await run({ profile, tasks }, context?.report) };
    },
  };
}
