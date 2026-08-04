import { integerField, objectInput, stringField, type Tool } from "./tool.js";

export const searchTool: Tool = {
  name: "search_files",
  description:
    "Search file contents with ripgrep inside the workspace.",
  exampleInput: { query: "functionName", path: "src", glob: "*.ts", maxResults: 20 },
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Required. Ripgrep regular expression." },
      path: { type: "string", description: "Optional. Workspace-relative directory or file; omit to search the whole workspace." },
      glob: { type: "string", description: "Optional. File glob such as *.ts." },
      maxResults: { type: "integer", description: "Optional. Maximum matches; defaults to 50.", minimum: 1, maximum: 200 },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async execute(workspace, rawInput) {
    const input = objectInput(rawInput);
    const query = stringField(input, "query") as string;
    const searchPath = stringField(input, "path", { optional: true });
    const glob = stringField(input, "glob", { optional: true });
    const maxResults = integerField(input, "maxResults", 50);

    if (maxResults < 1 || maxResults > 200) {
      throw new Error("maxResults must be between 1 and 200");
    }

    const matches = await workspace.search(query, {
      ...(searchPath === undefined ? {} : { path: searchPath }),
      ...(glob === undefined ? {} : { glob }),
      maxResults,
    });

    return { content: matches.length ? matches.join("\n") : "No matches." };
  },
};
