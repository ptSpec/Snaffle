import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_RESPONSE_BYTES = 2_000_000;

export async function fetchPublicText(rawUrl: string): Promise<{ url: string; contentType: string; text: string }> {
  let url = publicUrl(rawUrl);

  for (let redirect = 0; redirect <= 5; redirect += 1) {
    await rejectPrivateHost(url.hostname);
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
      headers: { "User-Agent": "Esch/0.0 web_fetch" },
    });
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
      text: await limitedText(response),
    };
  }

  throw new Error("Too many redirects");
}

function publicUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("url must use http or https");
  }
  if (url.username || url.password) throw new Error("url must not contain credentials");
  return url;
}

async function rejectPrivateHost(hostname: string): Promise<void> {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Private and local addresses are not allowed");
  }
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map(({ address }) => address);
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw new Error("Private and local addresses are not allowed");
  }
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
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_RESPONSE_BYTES) throw new Error("Response is larger than 2 MB");
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Response is larger than 2 MB");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
