import { contentRevision, objectInput, stringField, type Tool } from "./tool.js";

export const writeTool: Tool = {
  name: "write_file",
  description:
    'Create a file or replace its complete contents, then return its version for a later edit_file call. Example: {"path":"src/config.ts","content":"export const port = 3000;\\n"}. Use edit_file for targeted changes.',
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
      throw new Error(
        'Required field "path" is missing. Retry write_file with {"path":"workspace-relative/path","content":"..."}.',
      );
    }
    const filePath = stringField(input, "path") as string;
    const content = stringField(input, "content", { allowEmpty: true }) as string;

    await workspace.write(filePath, content);
    return { content: `Wrote ${filePath}; version: ${contentRevision(content)}.` };
  },
};
