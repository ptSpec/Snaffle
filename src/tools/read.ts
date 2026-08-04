import { integerField, objectInput, stringField, type Tool } from "./tool.js";

export const readTool: Tool = {
  name: "read_file",
  description:
    "Read a UTF-8 file as raw text. Use offset and limit only when a file is too large to read at once.",
  exampleInput: { path: "src/app.ts", offset: 1, limit: 200 },
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Required. Workspace-relative file path." },
      offset: { type: "integer", description: "Optional. First line to return; defaults to 1.", minimum: 1 },
      limit: { type: "integer", description: "Optional. Maximum lines to return; defaults to 2000.", minimum: 1, maximum: 2000 },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(workspace, rawInput) {
    const input = objectInput(rawInput);
    const filePath = stringField(input, "path") as string;
    const offset = integerField(input, "offset", 1);
    const limit = integerField(input, "limit", 2000);
    if (offset < 1) throw new Error("offset must be at least 1");
    if (limit < 1 || limit > 2000) throw new Error("limit must be between 1 and 2000");

    const content = await workspace.read(filePath);
    if (content.includes("\0")) throw new Error("Binary files cannot be read as text");
    const lines = content.replaceAll("\r\n", "\n").split("\n");
    const selected = lines.slice(offset - 1, offset - 1 + limit).join("\n");
    const truncated = offset - 1 + limit < lines.length;
    return {
      content: truncated
        ? `${selected}\n\n[Output truncated. Continue with offset ${offset + limit}.]`
        : selected,
    };
  },
};
