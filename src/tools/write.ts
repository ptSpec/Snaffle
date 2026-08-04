import { contentLineCount, contentRevision, objectInput, stringField, type Tool } from "./tool.js";

export const writeTool: Tool = {
  name: "write_file",
  description:
    "Create a file or replace its complete contents, then return its version and exact total lines for a later edit_file call. Use edit_file for targeted changes.",
  exampleInput: { path: "src/config.ts", content: "export const port = 3000;\n" },
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Required. Workspace-relative file path." },
      content: { type: "string", description: "Required. Complete new file contents; may be empty." },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  async execute(workspace, rawInput) {
    const input = objectInput(rawInput);
    if (input.path === undefined) {
      throw new Error('Required field "path" is missing.');
    }
    const filePath = stringField(input, "path") as string;
    const content = stringField(input, "content", { allowEmpty: true }) as string;

    await workspace.write(filePath, content);
    return {
      content: `Wrote ${filePath}; version: ${contentRevision(content)}; total lines: ${contentLineCount(content)}.`,
    };
  },
};
