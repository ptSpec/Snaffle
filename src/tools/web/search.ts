import { integerField, objectInput, stringField, ToolInputError, type Tool } from "../tool.js";
import { searchWithKetch } from "./ketch.js";
import type { KetchSearchBackend, WebSearchBackend } from "./types.js";

type SearchResult = { content: string; sources: { title: string; url: string }[] };
type OpenRouterAnnotation = {
  type?: unknown;
  url_citation?: { url?: unknown; title?: unknown; content?: unknown };
};

export type WebSearchOptions = {
  webSearchEnabled?: boolean | undefined;
  backend?: WebSearchBackend | undefined;
  apiKey?: string | undefined;
  openRouterApiKey?: string | undefined;
  ketchPath?: string | undefined;
};

const OPENROUTER_SEARCH_MODEL = "openai/gpt-5.6-luna";

export function webSearchTool(options: WebSearchOptions): Tool | undefined {
  if (!options.webSearchEnabled) return undefined;
  const backend = options.backend ?? "ddg";
  const search = backend === "openrouter"
    ? options.openRouterApiKey
      ? (query: string, maxResults: number) => searchOpenRouter(options.openRouterApiKey!, query, maxResults)
      : undefined
    : options.ketchPath && (backend === "ddg" || backend === "exa" || options.apiKey)
      ? (query: string, maxResults: number) => searchKetch(
          options.ketchPath!, backend, options.apiKey, query, maxResults,
        )
      : undefined;
  if (!search) return undefined;

  return {
    name: "web_search",
    description: "Search the public web when a direct URL is not known. Results include source URLs; cite relevant sources inline immediately after the supported text. Depending on configuration, search may use a free local backend or a paid provider.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Required. Focused web search query." },
        maxResults: { type: "integer", description: "Optional. Number of results. Defaults to 5; allowed range 1-10." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    exampleInput: { query: "Node.js current LTS release", maxResults: 5 },
    async execute(_workspace, rawInput) {
      const input = objectInput(rawInput);
      const query = stringField(input, "query")!;
      const maxResults = integerField(input, "maxResults", 5);
      if (maxResults < 1 || maxResults > 10) throw new ToolInputError("maxResults must be from 1 to 10");

      return search(query, maxResults);
    },
  };
}

async function searchKetch(
  executable: string,
  backend: KetchSearchBackend,
  apiKey: string | undefined,
  query: string,
  maxResults: number,
): Promise<SearchResult> {
  try {
    const results = await searchWithKetch(executable, backend, apiKey, query, maxResults);
    if (!results.length) throw new Error("Ketch returned no results");
    return resultList(results);
  } catch (error) {
    throw new Error(`Ketch search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resultList(results: { title: string; url: string; content: string }[]): SearchResult {
  return {
    content: results.length
      ? results.map((result, index) => {
          const excerpt = result.content.length > 2_000
            ? `${result.content.slice(0, 2_000)}… [excerpt truncated]`
            : result.content;
          return `[${index + 1}] ${result.title}\nURL: ${result.url}\n${excerpt}`;
        }).join("\n\n")
      : "No search results found.",
    sources: results.map(({ title, url }) => ({ title, url })),
  };
}

async function searchOpenRouter(
  apiKey: string,
  query: string,
  maxResults: number,
): Promise<SearchResult> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENROUTER_SEARCH_MODEL,
      messages: [
        {
          role: "system",
          content: "Search the web for the user's query. Return concise research notes grounded only in the sources. Put each Markdown source link inline immediately after the text it supports. Do not collect citations at the end or ask follow-up questions.",
        },
        { role: "user", content: query },
      ],
      tools: [{
        type: "openrouter:web_search",
        parameters: {
          engine: "exa",
          max_results: maxResults,
          max_total_results: maxResults,
          max_uses: 1,
          max_characters: 3_000,
        },
      }],
      tool_choice: "required",
      max_tool_calls: 1,
      max_tokens: 1_000,
    }),
  });
  if (!response.ok) throw new Error(`OpenRouter web search failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  const data = await response.json() as {
    choices?: { message?: { content?: unknown; annotations?: OpenRouterAnnotation[] } }[];
  };
  const message = data.choices?.[0]?.message;
  const content = typeof message?.content === "string" ? message.content.trim() : "";
  const sources = uniqueSources(message?.annotations ?? []);
  if (!content && !sources.length) throw new Error("OpenRouter web search returned no results");
  return {
    content: `${content || "Search completed."}${sources.length ? `\n\nSources:\n${sources.map((source) => `- [${source.title}](${source.url})`).join("\n")}` : ""}`,
    sources,
  };
}

function uniqueSources(annotations: OpenRouterAnnotation[]): { title: string; url: string }[] {
  const seen = new Set<string>();
  return annotations.flatMap((annotation) => {
    const citation = annotation.type === "url_citation" ? annotation.url_citation : undefined;
    if (typeof citation?.url !== "string" || seen.has(citation.url)) return [];
    seen.add(citation.url);
    return [{
      title: typeof citation.title === "string" && citation.title ? citation.title : citation.url,
      url: citation.url,
    }];
  });
}
