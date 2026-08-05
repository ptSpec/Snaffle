import { editTool } from "./edit.js";
import { readTool } from "./read.js";
import { runTool } from "./run.js";
import { searchTool } from "./search.js";
import type { Tool } from "./tool.js";
import { writeTool } from "./write.js";
import { webFetchTool } from "./web/fetch.js";
import { webSearchTool, type WebSearchOptions } from "./web/search.js";
import { youtubeTranscriptTool } from "./web/youtube.js";

export function defaultTools(options: WebSearchOptions = {}): Tool[] {
  const webSearch = webSearchTool(options);
  return [
    runTool,
    readTool,
    searchTool,
    editTool,
    writeTool,
    ...(webSearch ? [webSearch] : []),
    webFetchTool(Boolean(webSearch)),
    youtubeTranscriptTool,
  ];
}
