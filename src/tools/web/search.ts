import { integerField, objectInput, stringField, ToolInputError, type Tool } from "../tool.js";
import { searchWithKetch } from "./ketch.js";
import type { KetchSearchBackend, WebSearchBackend } from "./types.js";

type SearchResult = { content: string; sources: { title: string; url: string }[] };
type OpenRouterAnnotation = {
  type?: unknown;
  url_citation?: { url?: unknown; title?: unknown; content?: unknown };
};
type DeepSeekBlock = {
  type?: unknown;
  text?: unknown;
  citations?: DeepSeekCitation[];
  content?: DeepSeekSearchResult[];
};
type DeepSeekCitation = { url?: unknown; title?: unknown };
type DeepSeekSearchResult = { type?: unknown; url?: unknown; title?: unknown };

export type WebSearchOptions = {
  webSearchEnabled?: boolean | undefined;
  backend?: WebSearchBackend | undefined;
  apiKey?: string | undefined;
  openRouterApiKey?: string | undefined;
  deepSeekApiKey?: string | undefined;
  ketchPath?: string | undefined;
};

const OPENROUTER_SEARCH_MODEL = "openai/gpt-5.6-luna";
const DEEPSEEK_SEARCH_MODEL = "deepseek-v4-flash";

export function webSearchTool(options: WebSearchOptions): Tool | undefined {
  if (!options.webSearchEnabled) return undefined;
  const backend = options.backend ?? "ddg";
  const search = backend === "openrouter"
    ? options.openRouterApiKey
      ? (query: string, maxResults: number, signal?: AbortSignal) => searchOpenRouter(options.openRouterApiKey!, query, maxResults, signal)
      : undefined
    : backend === "deepseek"
      ? options.deepSeekApiKey
        ? (query: string, maxResults: number, signal?: AbortSignal) => searchDeepSeek(options.deepSeekApiKey!, query, maxResults, signal)
        : undefined
      : options.ketchPath && (backend === "ddg" || backend === "exa" || options.apiKey)
      ? (query: string, maxResults: number, signal?: AbortSignal) => searchKetch(
          options.ketchPath!, backend, options.apiKey, query, maxResults, signal,
        )
      : undefined;
  if (!search) return undefined;

  return {
    name: "web_search",
    description: "Search the public web when a direct URL is not known. Results include source URLs; cite relevant sources inline immediately after the supported text without surrounding brackets, parentheses, or citation numbers. Snaffle renders recognized sources as pills. Depending on configuration, search may use a free local backend or a paid provider.",
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
    async execute(_workspace, rawInput, context) {
      const input = objectInput(rawInput);
      const query = stringField(input, "query")!;
      const maxResults = integerField(input, "maxResults", 5);
      if (maxResults < 1 || maxResults > 10) throw new ToolInputError("maxResults must be from 1 to 10");

      return search(query, maxResults, context?.signal);
    },
  };
}

async function searchKetch(
  executable: string,
  backend: KetchSearchBackend,
  apiKey: string | undefined,
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<SearchResult> {
  try {
    const results = await searchWithKetch(executable, backend, apiKey, query, maxResults, signal);
    return results.length
      ? resultList(results)
      : { content: "No search results found. Try a shorter query and remove site: filters unless a specific domain is required.", sources: [] };
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
          return `Result ${index + 1}: ${result.title}\nURL: ${result.url}\n${excerpt}`;
        }).join("\n\n")
      : "No search results found.",
    sources: results.map(({ title, url }) => ({ title, url })),
  };
}

async function searchOpenRouter(
  apiKey: string,
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENROUTER_SEARCH_MODEL,
      messages: [
        {
          role: "system",
          content: "Search the web for the user's query. Return concise research notes grounded only in the sources. Put each Markdown source link inline immediately after the text it supports. Do not wrap links in extra brackets, parentheses, or citation numbers. Do not collect citations at the end or ask follow-up questions.",
        },
        { role: "user", content: query },
      ],
      tools: [{
        type: "openrouter:web_search",
        parameters: {
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

async function searchDeepSeek(
  apiKey: string,
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const response = await fetch("https://api.deepseek.com/anthropic/v1/messages", {
    method: "POST",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEEPSEEK_SEARCH_MODEL,
      max_tokens: 1_000,
      system: "Search the web for the user's query. Return concise research notes grounded only in the sources. Do not ask follow-up questions.",
      messages: [{ role: "user", content: query }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }],
    }),
  });
  if (!response.ok) throw new Error(`DeepSeek web search failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  const data = await response.json() as { content?: DeepSeekBlock[] };
  const blocks = data.content ?? [];
  const sources = deepSeekSources(blocks).slice(0, maxResults);
  const content = blocks.flatMap((block) => block.type === "text" && typeof block.text === "string"
    ? [block.text.trim()]
    : []).filter(Boolean).join("\n\n");
  if (!content && !sources.length) throw new Error("DeepSeek web search returned no results");
  return {
    content: `${content || "Search completed."}${sources.length ? `\n\nSources:\n${sources.map((source) => `- [${source.title}](${source.url})`).join("\n")}` : ""}`,
    sources,
  };
}

function deepSeekSources(blocks: DeepSeekBlock[]): { title: string; url: string }[] {
  const candidates = blocks.flatMap((block) => [
    ...(block.citations ?? []),
    ...(block.content ?? []).filter((result) => result.type === "web_search_result"),
  ]);
  const seen = new Set<string>();
  return candidates.flatMap((source) => {
    if (typeof source.url !== "string" || seen.has(source.url)) return [];
    seen.add(source.url);
    return [{
      title: typeof source.title === "string" && source.title ? source.title : source.url,
      url: source.url,
    }];
  });
}
