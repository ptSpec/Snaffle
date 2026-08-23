import { objectInput, stringField, ToolInputError, type Tool } from "./tool.js";

export const writeTool: Tool = {
  name: "write",
  description:
    "Create a new file or intentionally replace an entire file. For changes to an existing file, prefer edit: rewriting the whole file uses more output tokens and may overwrite unrelated changes. Use write as an edit fallback only when full replacement is genuinely necessary.",
  exampleInput: { path: "src/config.ts", content: "export const port = 3000;\n" },
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Required. Workspace-relative file path or $TMPDIR temporary path." },
      content: { type: "string", description: "Required. Complete new file contents; may be empty." },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  async execute(workspace, rawInput) {
    const input = objectInput(rawInput);
    if (input.path === undefined) {
      throw new ToolInputError('Required field "path" is missing.');
    }
    const filePath = stringField(input, "path") as string;
    const content = stringField(input, "content", { allowEmpty: true }) as string;

    await workspace.write(filePath, content);
    return { content: `Successfully wrote ${Buffer.byteLength(content)} bytes to ${filePath}` };
  },
};
