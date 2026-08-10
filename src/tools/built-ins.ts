import { editTool } from "./edit.js";
import { readTool } from "./read.js";
import { runTool } from "./run.js";
import { searchTool } from "./search.js";
import type { Tool } from "./tool.js";
import { writeTool } from "./write.js";
import { webFetchTool } from "./web/fetch.js";
import { webSearchTool, type WebSearchOptions } from "./web/search.js";
import { youtubeTranscriptTool } from "./web/youtube.js";
import { findKetch } from "./web/ketch.js";

export function defaultTools(options: WebSearchOptions = {}): Tool[] {
  const ketchPath = options.ketchPath ?? findKetch();
  const webSearch = webSearchTool({ ...options, ketchPath });
  const webToolsEnabled = options.webSearchEnabled === true;
  const richSearch = Boolean(webSearch) &&
    (options.backend === "exa" || options.backend === "tavily" || options.backend === "openrouter");
  return [
    runTool,
    readTool,
    searchTool,
    editTool,
    writeTool,
    ...(webSearch ? [webSearch] : []),
    ...(webToolsEnabled && !richSearch ? [webFetchTool(Boolean(webSearch), ketchPath)] : []),
    ...(webToolsEnabled ? [youtubeTranscriptTool] : []),
  ];
}
