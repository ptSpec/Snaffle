import { Children, isValidElement, memo, useState, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import hljs from "highlight.js/lib/common";
import "katex/dist/katex.min.css";
import type { SourceReference } from "../../../../protocol.js";
import { MermaidDiagram } from "./mermaid.js";

export const MarkdownContent = memo(function MarkdownContent({
  text,
  sources,
}: {
  text: string;
  sources?: SourceReference[];
}): JSX.Element {
  const markdown = normalizeLatexDelimiters(normalizeCitationMarkers(text));
  return (
    <ReactMarkdown
      components={markdownComponents}
      remarkPlugins={[remarkGfm, remarkMath, inlineSources(sources)]}
      rehypePlugins={[rehypeKatex]}
      skipHtml
    >
      {markdown}
    </ReactMarkdown>
  );
});

function normalizeCitationMarkers(text: string): string {
  return text.replace(/\uE200cite\uE202([^\uE201]+)\uE201/g, (_marker, body: string) =>
    body
      .split("\uE202")
      .filter((value) => /^https?:\/\//.test(value))
      .map((url) => `<${url}>`)
      .join(" "),
  );
}

function normalizeLatexDelimiters(text: string): string {
  return text
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g)
    .map((part, index) => index % 2 === 1
      ? part
      : part
          .replace(/\\\[([\s\S]*?)\\\]/g, (_match, math: string) => `\n\n$$\n${math.trim()}\n$$\n\n`)
          .replace(/\\\(([^\n]*?)\\\)/g, (_match, math: string) => `$${math}$`))
    .join("");
}

type MarkdownNode = {
  type: string;
  children?: MarkdownNode[];
  value?: string;
  url?: string;
  title?: string;
  data?: { hProperties: { className: string; title: string } };
};

function inlineSources(sources?: SourceReference[]) {
  return () => (tree: MarkdownNode): void => {
    const byUrl = new Map((sources ?? []).map((source) => [source.url, source]));
    markSourceLinks(tree, byUrl);
  };
}

function markSourceLinks(node: MarkdownNode, sources: Map<string, SourceReference>): void {
  const source = node.url ? sources.get(node.url) : undefined;
  if (node.type === "link" && source) {
    node.title = source.title;
    node.data = { hProperties: { className: "source-reference", title: source.title } };
    node.children = [{ type: "text", value: websiteName(source.url) }];
  }
  for (const child of node.children ?? []) markSourceLinks(child, sources);
  unwrapSourceLink(node, sources);
}

function unwrapSourceLink(node: MarkdownNode, sources: Map<string, SourceReference>): void {
  const children = node.children ?? [];
  for (let index = 1; index < children.length - 1; index += 1) {
    const link = children[index];
    if (link?.type !== "link" || !link.url || !sources.has(link.url)) continue;
    const before = children[index - 1];
    const after = children[index + 1];
    if (before?.type !== "text" || after?.type !== "text") continue;
    const opening = before.value?.at(-1);
    const closing = after.value?.at(0);
    if (!((opening === "(" && closing === ")") || (opening === "[" && closing === "]"))) continue;
    before.value = before.value!.slice(0, -1);
    after.value = after.value!.slice(1);
  }
}

function websiteName(rawUrl: string): string {
  try {
    const parts = new URL(rawUrl).hostname.replace(/^www\./, "").split(".");
    const name = parts.length > 1 ? parts.slice(-2).join(".") : parts[0] || rawUrl;
    return name.length > 15 ? `${name.slice(0, 14)}…` : name;
  } catch {
    return rawUrl.length > 15 ? `${rawUrl.slice(0, 14)}…` : rawUrl;
  }
}


const markdownComponents: Components = {
  a({ href, children, className, title }) {
    const external = href?.startsWith("https://") || href?.startsWith("http://");
    const sourceReference = className?.includes("source-reference");
    return (
      <a
        className={className}
        href={external ? href : undefined}
        title={title}
        onClick={(event) => {
          event.preventDefault();
          if (external && href) void window.desktop.openExternal(href);
        }}
      >
        {sourceReference ? (
          <>
            <span>{children}</span>
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6 3h7v7M13 3 6 10M12 9v4H3V4h4" />
            </svg>
          </>
        ) : children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="markdown-table-scroll">
        <table>{children}</table>
      </div>
    );
  },
  pre: CodeBlock,
};

function CodeBlock({ children }: ComponentProps<"pre">): JSX.Element {
  const [copied, setCopied] = useState(false);
  const child = Children.toArray(children)[0];
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    return <pre>{children}</pre>;
  }

  const code = String(child.props.children).replace(/\n$/, "");
  const language = /language-([\w-]+)/.exec(child.props.className ?? "")?.[1] ?? "text";
  if (language.toLowerCase() === "mermaid") return <MermaidDiagram code={code} copyIcon={<CopyIcon />} />;
  const actionPositions = code.split("\n").length >= 8 ? ["top", "bottom"] : ["bottom"];
  const highlighted = hljs.getLanguage(language)
    ? hljs.highlight(code, { language, ignoreIllegals: true }).value
    : null;

  async function copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="code-block">
      {actionPositions.map((position) => (
        <div className={`code-block-actions ${position}`} key={position}>
          <span className="code-block-language">{language}</span>
          <span className="code-block-action-separator" aria-hidden="true">/</span>
          <button
            className={copied ? "copied" : ""}
            type="button"
            onClick={() => void copyCode()}
            title={copied ? "Copied" : "Copy code"}
            aria-label={copied ? "Copied" : "Copy code"}
          >
            <CopyIcon />
          </button>
        </div>
      ))}
      <pre>
        {highlighted ? (
          <code
            className={child.props.className}
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        ) : (
          <code>{code}</code>
        )}
      </pre>
    </div>
  );
}

export function CopyIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5" y="5" width="8" height="8" rx="1.5" />
      <path d="M3 10.5H2.5V3A1.5 1.5 0 0 1 4 1.5h7.5V2" />
    </svg>
  );
}
