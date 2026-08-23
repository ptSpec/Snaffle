import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { PROJECT } from "../../identity.js";

const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_HTML_RESPONSE_BYTES = 7_000_000;

export type PublicResource = {
  url: string;
  contentType: string;
  bytes: Uint8Array;
};

export async function fetchPublicText(rawUrl: string, signal?: AbortSignal): Promise<{ url: string; contentType: string; text: string }> {
  const resource = await fetchPublicResource(rawUrl, signal);
  return {
    url: resource.url,
    contentType: resource.contentType,
    text: new TextDecoder().decode(resource.bytes),
  };
}

export async function fetchPublicResource(rawUrl: string, signal?: AbortSignal): Promise<PublicResource> {
  let url = publicUrl(rawUrl);

  for (let redirect = 0; redirect <= 5; redirect += 1) {
    await rejectPrivateHost(url.hostname, signal);
    const response = await fetch(url, {
      redirect: "manual",
      signal: requestSignal(signal),
      headers: { "User-Agent": `${PROJECT.slug}/0.0 web_fetch` },
    });
    if (response.status === 403 && response.headers.get("cf-mitigated") === "challenge") {
      const fandom = await fetchFandomPage(url, signal);
      if (fandom) return fandom;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === 5) throw new Error("Too many or invalid redirects");
      url = publicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return {
      url: response.url || url.toString(),
      contentType: response.headers.get("content-type") ?? "",
      bytes: await limitedBytes(response),
    };
  }

  throw new Error("Too many redirects");
}

async function fetchFandomPage(url: URL, signal?: AbortSignal): Promise<PublicResource | undefined> {
  if (!url.hostname.endsWith(".fandom.com") || !url.pathname.startsWith("/wiki/")) return undefined;
  let page: string;
  try {
    page = decodeURIComponent(url.pathname.slice(6));
  } catch {
    return undefined;
  }
  if (!page) return undefined;

  const api = new URL("/api.php", url);
  api.search = new URLSearchParams({
    action: "parse",
    page,
    prop: "text|displaytitle",
    format: "json",
    origin: "*",
  }).toString();
  const response = await fetch(api, {
    signal: requestSignal(signal),
    headers: { "User-Agent": `${PROJECT.slug}/0.0 web_fetch` },
  });
  if (!response.ok) return undefined;
  const data = JSON.parse(await limitedText(response)) as {
    parse?: { title?: unknown; text?: { "*"?: unknown } };
  };
  const html = data.parse?.text?.["*"];
  if (typeof html !== "string") return undefined;
  const title = typeof data.parse?.title === "string" ? data.parse.title : page;
  return {
    url: url.toString(),
    contentType: "text/html; charset=utf-8",
    bytes: new TextEncoder().encode(`<html><head><title>${escapeHtml(title)}</title></head><body>${html}</body></html>`),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function publicUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("url must use http or https");
  }
  if (url.username || url.password) throw new Error("url must not contain credentials");
  return url;
}

async function rejectPrivateHost(hostname: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Private and local addresses are not allowed");
  }
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map(({ address }) => address);
  signal?.throwIfAborted();
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw new Error("Private and local addresses are not allowed");
  }
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(30_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase();
  if (value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(value)) return true;
  const ipv4 = value.startsWith("::ffff:") ? value.slice(7) : value;
  const parts = ipv4.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

async function limitedText(response: Response): Promise<string> {
  return new TextDecoder().decode(await limitedBytes(response));
}

async function limitedBytes(response: Response): Promise<Uint8Array> {
  const html = /html|xhtml/i.test(response.headers.get("content-type") ?? "");
  const maxBytes = html ? MAX_HTML_RESPONSE_BYTES : MAX_RESPONSE_BYTES;
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) throw responseTooLarge(html);
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw responseTooLarge(html);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function responseTooLarge(html: boolean): Error {
  return new Error(html
    ? "Page HTML exceeds the 7 MB download limit before extraction. maxChars only limits returned text, so lowering it will not help."
    : "Response is larger than 2 MB");
}
