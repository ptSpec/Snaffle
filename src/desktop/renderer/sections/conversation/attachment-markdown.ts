export async function htmlToMarkdown(html: string): Promise<string> {
  const [{ default: TurndownService }, { gfm }] = await Promise.all([
    import("turndown"),
    import("turndown-plugin-gfm"),
  ]);
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("script, style, link, meta, svg").forEach((node) => node.remove());
  const turndown = new TurndownService({ bulletListMarker: "-", codeBlockStyle: "fenced" });
  turndown.use(gfm);
  return turndown.turndown(document.body.innerHTML).trim();
}

