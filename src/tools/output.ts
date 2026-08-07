export const DEFAULT_TOOL_OUTPUT_CHARS = 12_000;
export const MAX_TOOL_OUTPUT_CHARS = 50_000;

export function truncateHead(text: string, maxChars = DEFAULT_TOOL_OUTPUT_CHARS): string {
  if (text.length <= maxChars) return text;
  const notice = truncationNotice(text.length - maxChars, "end");
  return `${text.slice(0, maxChars - notice.length).trimEnd()}${notice}`;
}

export function truncateTail(text: string, maxChars = DEFAULT_TOOL_OUTPUT_CHARS): string {
  if (text.length <= maxChars) return text;
  const notice = truncationNotice(text.length - maxChars, "beginning");
  return `${notice}${text.slice(text.length - maxChars + notice.length).trimStart()}`;
}

export function truncateMiddle(text: string, maxChars = MAX_TOOL_OUTPUT_CHARS): string {
  if (text.length <= maxChars) return text;
  const notice = truncationNotice(text.length - maxChars, "middle");
  const remaining = maxChars - notice.length;
  const head = Math.ceil(remaining / 2);
  return `${text.slice(0, head).trimEnd()}${notice}${text.slice(text.length - (remaining - head)).trimStart()}`;
}

function truncationNotice(omittedChars: number, location: string): string {
  return `\n\n[Output truncated: approximately ${omittedChars.toLocaleString("en-US")} characters omitted from the ${location}.]\n\n`;
}
