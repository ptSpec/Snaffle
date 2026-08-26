import { classHighlighter, highlightTree } from "@lezer/highlight";
import { languageForPath } from "./file-language.js";

export type FileToken = { text: string; className?: string };

export async function tokenizeFile(path: string, text: string): Promise<FileToken[] | null> {
  const language = await languageForPath(path);
  if (!language) return null;
  const tokens: FileToken[] = [];
  let cursor = 0;
  highlightTree(language.parser.parse(text), classHighlighter, (from, to, className) => {
    if (from > cursor) tokens.push({ text: text.slice(cursor, from) });
    tokens.push({ text: text.slice(from, to), className });
    cursor = to;
  });
  if (cursor < text.length) tokens.push({ text: text.slice(cursor) });
  return tokens;
}
