import { integerField, objectInput, stringField, ToolInputError, type Tool } from "./tool.js";
import { DEFAULT_TOOL_OUTPUT_CHARS } from "./output.js";

export const readTool: Tool = {
  name: "read",
  description:
    "Read a UTF-8 file as raw text. Use offset as the first line and limit as the number of lines to read. Returns at most 2000 complete lines or about 12000 characters; if more remains, the result gives the exact offset for the next read.",
  exampleInput: { path: "src/app.ts", offset: 1, limit: 200 },
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Required. Workspace-relative file path or $TMPDIR temporary path." },
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
    if (offset < 1) throw new ToolInputError("offset must be at least 1");
    if (limit < 1 || limit > 2000) throw new ToolInputError("limit must be between 1 and 2000");

    const content = await workspace.read(filePath);
    if (content.includes("\0")) throw new Error("Binary files cannot be read as text");
    const lines = content.replaceAll("\r\n", "\n").split("\n");
    const start = offset - 1;
    if (start >= lines.length) {
      throw new ToolInputError(`offset ${offset} is beyond the end of the file (${lines.length} lines)`);
    }

    const available = lines.slice(start, start + limit);
    let selected = "";
    let count = 0;
    for (const line of available) {
      const next = count ? `${selected}\n${line}` : line;
      const end = offset + count;
      const more = start + count + 1 < lines.length;
      const notice = more ? continuation(offset, end, lines.length, end + 1) : "";
      if (next.length + notice.length > DEFAULT_TOOL_OUTPUT_CHARS) break;
      selected = next;
      count += 1;
    }

    if (!count) {
      return {
        content: `[Line ${offset} exceeds the ${DEFAULT_TOOL_OUTPUT_CHARS}-character read limit. Use run_command with a targeted command to inspect part of that line.]`,
      };
    }

    const end = offset + count - 1;
    const more = start + count < lines.length;
    return { content: `${selected}${more ? continuation(offset, end, lines.length, end + 1) : ""}` };
  },
};

function continuation(start: number, end: number, total: number, nextOffset: number): string {
  return `\n\n[Showing lines ${start}-${end} of ${total}. Continue with offset ${nextOffset}.]`;
}
