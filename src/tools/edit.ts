import { contentRevision, objectInput, stringField, type Tool } from "./tool.js";

export const editTool: Tool = {
  name: "edit_file",
  description:
    'Replace one or more inclusive line ranges using the latest version returned for that path by read_file, write_file, or edit_file. Example: {"path":"src/app.ts","version":"8e42c197a810","edits":[{"startLine":10,"endLine":10,"newText":"const port = 4000;"},{"startLine":40,"endLine":42,"newText":"replacement lines"}]}. Returns the new version. Use one call for multiple non-overlapping ranges.',
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Required. Workspace-relative file path." },
      version: {
        type: "string",
        description: "Required. Latest version returned by read_file, write_file, or edit_file for this exact path. Never reuse another file's version.",
      },
      edits: {
        type: "array",
        minItems: 1,
        description:
          'Required. One or more non-overlapping JSON objects shaped like {"startLine":1,"endLine":2,"newText":"..."}. Ranges use the original version, not earlier edits in this array.',
        items: {
          type: "object",
          properties: {
            startLine: {
              type: "integer",
              minimum: 1,
              description: "Required. First line to replace, inclusive.",
            },
            endLine: {
              type: "integer",
              minimum: 1,
              description: "Required. Last line to replace, inclusive; use startLine for one line.",
            },
            newText: { type: "string", description: "Required. Replacement text; empty deletes the range." },
          },
          required: ["startLine", "endLine", "newText"],
          additionalProperties: false,
        },
      },
    },
    required: ["path", "version", "edits"],
    additionalProperties: false,
  },
  async execute(workspace, rawInput) {
    const input = objectInput(rawInput);
    const filePath = stringField(input, "path") as string;
    const version = stringField(input, "version") as string;
    if (!Array.isArray(input.edits) || input.edits.length === 0) {
      throw new Error("edits must be a non-empty array");
    }

    const content = await workspace.read(filePath);
    if (contentRevision(content) !== version) {
      throw new Error(
        `Version does not match ${filePath}. It is stale or belongs to another file. Read ${filePath} and retry with that file's version.`,
      );
    }

    const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
    const lines = content.replaceAll("\r\n", "\n").split("\n");
    const edits = input.edits.map((rawEdit, index) => {
      const edit = objectInput(rawEdit);
      const startLine = requiredLine(edit, "startLine", index);
      const endLine = requiredLine(edit, "endLine", index);
      const newText = stringField(edit, "newText", { allowEmpty: true }) as string;
      if (endLine < startLine || endLine > lines.length) {
        throw new Error(`Edit ${index + 1}: line range must be within 1-${lines.length}`);
      }
      return { startLine, endLine, newText };
    });

    const ordered = [...edits].sort((left, right) => left.startLine - right.startLine);
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index]!.startLine <= ordered[index - 1]!.endLine) {
        throw new Error("Edit line ranges must not overlap");
      }
    }

    for (const edit of ordered.reverse()) {
      const replacement = edit.newText
        ? edit.newText.replaceAll("\r\n", "\n").split("\n")
        : [];
      lines.splice(edit.startLine - 1, edit.endLine - edit.startLine + 1, ...replacement);
    }

    const updated = lines.join(lineEnding);
    await workspace.write(filePath, updated);
    return {
      content: `Updated ${filePath} with ${edits.length} edit(s); version: ${contentRevision(updated)}.`,
    };
  },
};

function requiredLine(input: Record<string, unknown>, name: string, index: number): number {
  const value = input[name];
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`Edit ${index + 1}: ${name} must be a positive integer`);
  }
  return value as number;
}
