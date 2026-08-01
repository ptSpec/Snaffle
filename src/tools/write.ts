import { objectInput, stringField, type Tool } from "./tool.js";

export const writeTool: Tool = {
  name: "write_file",
  description: "Create a file or replace its complete contents. Use edit_file for targeted changes.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative file path" },
      content: { type: "string", description: "Complete new file contents" },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  async execute(workspace, rawInput) {
    const input = objectInput(rawInput);
    const filePath = stringField(input, "path") as string;
    const content = stringField(input, "content", { allowEmpty: true }) as string;

    await workspace.write(filePath, content);
    return { content: `Wrote ${filePath}.` };
  },
};
