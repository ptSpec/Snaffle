import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { integerField, objectInput, stringField, type Tool } from "../tool.js";
import { fetchPublicText } from "./request.js";

export const webFetchTool: Tool = {
  name: "web_fetch",
  description: "Fetch a known public HTTP or HTTPS page and return readable text. This is not a search tool: use web_search for discovery and do not fetch Google or Bing search-result pages.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Required. Public HTTP or HTTPS URL to fetch." },
      maxChars: { type: "integer", description: "Optional. Maximum returned characters. Defaults to 12000; allowed range 1000-30000." },
    },
    required: ["url"],
    additionalProperties: false,
  },
  exampleInput: { url: "https://example.com/docs", maxChars: 12000 },
  async execute(_workspace, rawInput) {
    const input = objectInput(rawInput);
    const url = stringField(input, "url")!;
    if (isSearchResultsUrl(url)) {
      throw new Error("web_fetch cannot search Google or Bing. Use web_search; if it is unavailable, tell the user that web search is not configured.");
    }
    const maxChars = integerField(input, "maxChars", 12_000);
    if (maxChars < 1_000 || maxChars > 30_000) throw new Error("maxChars must be from 1000 to 30000");

    const page = await fetchPublicText(url);
    if (page.contentType && !/(^text\/|json|xml|javascript|xhtml)/i.test(page.contentType)) {
      throw new Error(`Unsupported content type: ${page.contentType.split(";")[0]}`);
    }
    const html = /html|xhtml/i.test(page.contentType) || /<html[\s>]/i.test(page.text);
    const readable = html ? readableMarkdown(page.text) : undefined;
    const title = readable?.title || (html ? pageTitle(page.text) : new URL(page.url).hostname);
    const content = readable?.content || (html ? markdown(page.text) : page.text.trim());
    return {
      content: `Source: ${title}\nURL: ${page.url}\n\n${content.slice(0, maxChars)}`,
      sources: [{ title, url: page.url }],
    };
  },
};

function isSearchResultsUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, "");
    return url.pathname === "/search" && (host === "google.com" || host.endsWith(".google.com") || host === "bing.com");
  } catch {
    return false;
  }
}

function readableMarkdown(html: string): { title?: string; content: string } | undefined {
  try {
    const { document } = parseHTML(html);
    const article = new Readability(document as unknown as Document).parse();
    if (!article?.content) return undefined;
    return {
      ...(article.title ? { title: article.title } : {}),
      content: markdown(article.content),
    };
  } catch {
    return undefined;
  }
}

function markdown(html: string): string {
  const cleaned = html
    .replace(/<(script|style|svg|noscript|iframe)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--([\s\S]*?)-->/g, "");
  const service = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  service.use(gfm);
  return service.turndown(cleaned).replace(/\n{3,}/g, "\n\n").trim();
}

function pageTitle(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title || "Web page";
}
