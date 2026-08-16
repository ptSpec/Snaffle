export type ToolSurfaceMode = "compact" | "expanded";
export type ModelToolSurface = { mode: ToolSurfaceMode; optionalTools: string[] };
export type ModelToolSurfaces = Record<string, ModelToolSurface>;

const CORE_TOOLS = new Set(["run_command", "read_file", "search_files", "edit_file", "write_file"]);
const COMPACT_BASE_TOOLS = new Set(["update_plan"]);
const COMPACT_SELECTABLE_TOOLS = new Set(["web_search", "web_fetch", "use_skill", "mcp"]);

export function modelSurfaceKey(connectionId: string, model: string): string {
  return `${connectionId}:${model}`;
}

export function parseModelToolSurfaces(value: unknown): ModelToolSurfaces {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, raw]) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const input = raw as Record<string, unknown>;
    if (input.mode !== "compact" && input.mode !== "expanded") return [];
    const optionalTools = Array.isArray(input.optionalTools)
      ? [...new Set(input.optionalTools.filter((name): name is string =>
          typeof name === "string" && COMPACT_SELECTABLE_TOOLS.has(name)))].slice(0, 2)
      : [];
    return [[key, { mode: input.mode, optionalTools }]];
  }));
}

export function surfaceForModel(
  surfaces: ModelToolSurfaces,
  connectionId: string,
  model: string,
  availableToolNames: string[],
): ModelToolSurface {
  const stored = surfaces[modelSurfaceKey(connectionId, model)];
  if (stored) return stored;
  const available = new Set(availableToolNames);
  const web = ["web_search", "web_fetch"].filter((name) => available.has(name));
  return { mode: "compact", optionalTools: web };
}

export function toolsForSurface<T extends { tool: { name: string } }>(
  tools: T[],
  surface: ModelToolSurface,
  explicitlyActive: string[] = [],
): T[] {
  const names = activeToolNamesForSurface(tools.map(({ tool }) => tool.name), surface, explicitlyActive);
  return tools.filter(({ tool }) => names.includes(tool.name));
}

export function activeToolNamesForSurface(
  availableToolNames: string[],
  surface: ModelToolSurface,
  explicitlyActive: string[] = [],
): string[] {
  if (surface.mode === "expanded") return availableToolNames;
  const active = new Set([...COMPACT_BASE_TOOLS, ...surface.optionalTools, ...explicitlyActive]);
  return availableToolNames.filter((name) => CORE_TOOLS.has(name) || active.has(name));
}

export function compactToolChoices(): string[] {
  return [...COMPACT_SELECTABLE_TOOLS];
}
