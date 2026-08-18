import { fetchTranscript } from "youtube-transcript";
import { ToolInputError } from "../tool.js";

type YoutubeVideo = { id: string; url: string };

export function youtubeVideo(value: string): YoutubeVideo | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!["youtu.be", "youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ToolInputError("YouTube URLs must use http or https");
  }

  let id: string | undefined;
  if (host === "youtu.be") {
    id = parsed.pathname.split("/").filter(Boolean)[0];
  } else {
    id = parsed.searchParams.get("v") ?? undefined;
    if (!id) {
      const [kind, pathId] = parsed.pathname.split("/").filter(Boolean);
      if (["embed", "live", "shorts"].includes(kind ?? "")) id = pathId;
    }
  }
  if (!id || !/^[\w-]{11}$/.test(id)) throw new ToolInputError("url must identify a YouTube video");
  return { id, url: `https://www.youtube.com/watch?v=${id}` };
}

export async function fetchYoutubeTranscript(video: YoutubeVideo, signal?: AbortSignal): Promise<{
  title: string;
  url: string;
  content: string;
}> {
  const transcript = await abortable(fetchTranscript(video.id), signal);
  if (!transcript.length) throw new Error("No transcript is available for this video");
  const milliseconds = transcript.some((item) => item.duration > 100);
  const content = transcript
    .map((item) => {
      const text = item.text.replace(/\s+/g, " ").trim();
      const seconds = milliseconds ? item.offset / 1000 : item.offset;
      return text ? `[${timestamp(seconds)}] ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
  if (!content) throw new Error("No transcript is available for this video");
  return { title: "YouTube transcript", url: video.url, content };
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = (): void => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}

function timestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}:` : ""}${String(minutes % 60).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}
