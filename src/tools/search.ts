import { integerField, objectInput, stringField, ToolInputError, type Tool } from "./tool.js";
import { truncateHead } from "./output.js";

export const searchTool: Tool = {
  name: "search_files",
  description:
    "Search file contents with ripgrep inside the workspace. Results are bounded; narrow the query or path if output is truncated.",
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
  async execute(workspace, rawInput, context) {
    const input = objectInput(rawInput);
    const query = stringField(input, "query") as string;
    const searchPath = stringField(input, "path", { optional: true });
    const glob = stringField(input, "glob", { optional: true });
    const maxResults = integerField(input, "maxResults", 50);

    if (maxResults < 1 || maxResults > 200) {
      throw new ToolInputError("maxResults must be between 1 and 200");
    }

    const matches = await workspace.search(query, {
      ...(searchPath === undefined ? {} : { path: searchPath }),
      ...(glob === undefined ? {} : { glob }),
      maxResults: maxResults + 1,
    }, context?.signal);
    if (!matches.length) return { content: "No matches." };
    const visible = matches.slice(0, maxResults).map((match) =>
      match.length > 1_000 ? `${match.slice(0, 1_000)}… [line truncated]` : match,
    );
    const resultNotice = matches.length > maxResults
      ? `\n\n[More than ${maxResults} matches found. Narrow the query or path to see others.]`
      : "";
    return { content: truncateHead(`${visible.join("\n")}${resultNotice}`) };
  },
};
