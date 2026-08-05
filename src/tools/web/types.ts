export type KetchSearchBackend = "ddg" | "exa" | "tavily" | "brave" | "firecrawl";
export type WebSearchBackend = KetchSearchBackend | "openrouter";

export const WEB_SEARCH_BACKENDS: WebSearchBackend[] = [
  "ddg", "exa", "tavily", "brave", "firecrawl", "openrouter",
];
