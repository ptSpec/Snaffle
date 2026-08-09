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
      "Delegate focused work to separate agents. Use read access to investigate up to four independent tasks in parallel. Use write access for exactly one coding task that may edit and test the shared workspace. Continue using the returned structured results.",
    exampleInput: {
      access: "read",
      tasks: [
        "Find where provider settings are stored.",
        "Review the provider UI for relevant components.",
      ],
    },
    inputSchema: {
      type: "object",
      properties: {
        access: {
          type: "string",
          enum: ["read", "write"],
          description: "Required. read runs tasks concurrently without modifying files; write runs one task with coding tools.",
        },
        tasks: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          description: "Required. One to four complete, independent tasks. write access requires exactly one task.",
          items: { type: "string", minLength: 1 },
        },
      },
      required: ["access", "tasks"],
      additionalProperties: false,
    },
    async execute(_workspace, rawInput, context) {
      const input = objectInput(rawInput);
      const access = stringField(input, "access") as string;
      if (access !== "read" && access !== "write") {
        throw new ToolInputError("access must be read or write");
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
      if (access === "write" && tasks.length !== 1) {
        throw new ToolInputError("write access requires exactly one task");
      }
      return { content: await run({ access, tasks }, context?.report) };
    },
  };
}
