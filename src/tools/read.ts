import { integerField, objectInput, stringField, type Tool } from "./tool.js";

export const readTool: Tool = {
  name: "read_file",
  description: "Read a UTF-8 file or a bounded range of its lines.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Required. Workspace-relative file path." },
      startLine: { type: "integer", description: "Optional. First line to return; defaults to 1.", minimum: 1 },
      lineCount: { type: "integer", description: "Optional. Maximum lines to return; defaults to 200.", minimum: 1, maximum: 1000 },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(workspace, rawInput) {
    const input = objectInput(rawInput);
    const filePath = stringField(input, "path") as string;
    const startLine = integerField(input, "startLine", 1);
    const lineCount = integerField(input, "lineCount", 200);

    if (startLine < 1) throw new Error("startLine must be at least 1");
    if (lineCount < 1 || lineCount > 1000) {
      throw new Error("lineCount must be between 1 and 1000");
    }

    const content = await workspace.read(filePath);
    if (content.includes("\0")) throw new Error("Binary files cannot be read as text");

    const lines = content.split("\n");
    const selected = lines.slice(startLine - 1, startLine - 1 + lineCount);
    const endLine = Math.min(startLine + selected.length - 1, lines.length);

    return {
      content: `[lines ${startLine}-${endLine} of ${lines.length}]\n${selected.join("\n")}`,
    };
  },
};
