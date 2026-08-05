import { fetchTranscript } from "youtube-transcript";
import { integerField, objectInput, stringField, type Tool } from "../tool.js";

export const youtubeTranscriptTool: Tool = {
  name: "youtube_transcript",
  description: "Get timestamped transcript text from a YouTube video. Set query to return only relevant passages, or omit it for the transcript.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Required. YouTube video URL or 11-character video id." },
      query: { type: "string", description: "Optional. Topic or phrase used to select relevant transcript passages." },
      language: { type: "string", description: "Optional. Preferred transcript language code, such as en or de." },
      maxChars: { type: "integer", description: "Optional. Maximum returned characters. Defaults to 12000; allowed range 1000-30000." },
    },
    required: ["url"],
    additionalProperties: false,
  },
  exampleInput: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", query: "main argument", language: "en" },
  async execute(_workspace, rawInput) {
    const input = objectInput(rawInput);
    const url = stringField(input, "url")!;
    const query = stringField(input, "query", { optional: true });
    const language = stringField(input, "language", { optional: true });
    const maxChars = integerField(input, "maxChars", 12_000);
    if (maxChars < 1_000 || maxChars > 30_000) throw new Error("maxChars must be from 1000 to 30000");

    const transcript = await fetchTranscript(url, language ? { lang: language } : undefined);
    if (!transcript.length) throw new Error("No transcript is available for this video");
    const milliseconds = transcript.some((item) => item.duration > 100);
    const rows = transcript.map((item) => ({
      text: item.text.replace(/\s+/g, " ").trim(),
      seconds: (milliseconds ? item.offset / 1000 : item.offset),
    })).filter((item) => item.text);
    const selected = query ? relevantRows(rows, query) : rows;
    if (!selected.length) return { content: `No transcript passages matched “${query}”.` };

    const videoUrl = canonicalYoutubeUrl(url);
    const content = selected.map((item) =>
      `[${timestamp(item.seconds)}](${videoUrl}&t=${Math.floor(item.seconds)}s) ${item.text}`,
    ).join("\n").slice(0, maxChars);
    return {
      content: `${query ? `Transcript passages for: ${query}` : "Transcript"}\n\n${content}`,
      sources: [{ title: "YouTube transcript", url: videoUrl }],
    };
  },
};

function relevantRows(rows: { text: string; seconds: number }[], query: string): { text: string; seconds: number }[] {
  const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 2);
  const indexes = new Set<number>();
  rows.forEach((row, index) => {
    const text = row.text.toLowerCase();
    if (text.includes(query.toLowerCase()) || terms.some((term) => text.includes(term))) {
      for (let nearby = Math.max(0, index - 2); nearby <= Math.min(rows.length - 1, index + 2); nearby += 1) indexes.add(nearby);
    }
  });
  return [...indexes].sort((a, b) => a - b).map((index) => rows[index]!);
}

function canonicalYoutubeUrl(value: string): string {
  const id = /^[\w-]{11}$/.test(value)
    ? value
    : /(?:v=|youtu\.be\/|embed\/)([\w-]{11})/.exec(value)?.[1];
  if (!id) throw new Error("url must be a YouTube URL or video id");
  return `https://www.youtube.com/watch?v=${id}`;
}

function timestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}:` : ""}${String(minutes % 60).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}
