import type { Tool } from "../../tools/tool.js";
import { objectInput, stringField, ToolInputError } from "../../tools/tool.js";
import type { SkillRegistry } from "./registry.js";

export function skillTool(registry: SkillRegistry): Tool {
  return {
    name: "use_skill",
    description:
      "Search for and load reusable skill instructions installed for this project or user. " +
      "Search when a task may benefit from a specialized workflow, then load the best match before acting. " +
      "Load referenced text resources only when the skill instructions require them.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["search", "load"], description: "Required. Search skill metadata or load one skill/resource." },
        query: { type: "string", description: "Required for search. Describe the workflow or expertise needed." },
        name: { type: "string", description: "Required for load. Exact skill name returned by search." },
        resource: { type: "string", description: "Optional for load. Skill-relative text file referenced by SKILL.md." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    presentation(raw) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
      const input = raw as Record<string, unknown>;
      if (input.action === "search") return { title: "Search skills" };
      if (input.action === "load" && typeof input.name === "string") {
        return { title: input.name, subtitle: typeof input.resource === "string" ? input.resource : "Skill instructions" };
      }
      return undefined;
    },
    async execute(_workspace, raw) {
      const input = objectInput(raw);
      const action = stringField(input, "action");
      if (action === "search") {
        const query = stringField(input, "query");
        const skills = registry.search(query!);
        return { content: skills.length ? JSON.stringify(skills, null, 2) : "No matching skills found." };
      }
      if (action !== "load") throw new ToolInputError("action must be search or load");
      const name = stringField(input, "name");
      const resource = stringField(input, "resource", { optional: true });
      return {
        content: registry.read(name!, resource),
        presentation: { title: name!, ...(resource ? { subtitle: resource } : { subtitle: "Skill instructions" }) },
      };
    },
  };
}
