import { editTool } from "./edit.js";
import { readTool } from "./read.js";
import { runTool } from "./run.js";
import { searchTool } from "./search.js";
import type { Tool } from "./tool.js";
import { writeTool } from "./write.js";

export function defaultTools(): Tool[] {
  return [runTool, readTool, searchTool, editTool, writeTool];
}
