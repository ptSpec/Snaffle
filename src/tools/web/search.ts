import { integerField, objectInput, stringField, ToolInputError, type Tool } from "../tool.js";

type TavilyResult = { title?: unknown; url?: unknown; content?: unknown };
type SearchResult = { content: string; sources: { title: string; url: string }[] };
type OpenRouterAnnotation = {
  type?: unknown;
  url_citation?: { url?: unknown; title?: unknown; content?: unknown };
};

export type WebSearchOptions = {
  tavilyApiKey?: string | undefined;
  openRouterApiKey?: string | undefined;
};

const OPENROUTER_SEARCH_MODEL = "openai/gpt-5.6-luna";

export function webSearchTool(options: WebSearchOptions): Tool | undefined {
  const search = options.tavilyApiKey
    ? (query: string, maxResults: number) => searchTavily(options.tavilyApiKey!, query, maxResults)
    : options.openRouterApiKey
      ? (query: string, maxResults: number) => searchOpenRouter(
          options.openRouterApiKey!,
          query,
          maxResults,
        )
      : undefined;
  if (!search) return undefined;

  return {
    name: "web_search",
    description: "Search the public web through a paid provider when a direct URL is not known. Results include source URLs; cite relevant sources inline immediately after the supported text.",
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

async function searchTavily(apiKey: string, query: string, maxResults: number): Promise<SearchResult> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, search_depth: "basic", max_results: maxResults, include_answer: false }),
  });
  if (!response.ok) throw new Error(`Tavily search failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  const data = await response.json() as { results?: TavilyResult[] };
  const results = (data.results ?? []).flatMap((result) =>
    typeof result.title === "string" && typeof result.url === "string"
      ? [{ title: result.title, url: result.url, content: typeof result.content === "string" ? result.content : "" }]
      : [],
  );
  return {
    content: results.length
      ? results.map((result, index) => `[${index + 1}] ${result.title}\nURL: ${result.url}\n${result.content}`).join("\n\n")
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
