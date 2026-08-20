# Web tools

This folder owns direct fetching, search through Ketch or configured model providers, supported video transcript extraction, request limits, and web-specific types.

Search backends belong behind the existing search boundary. They should not leak provider-specific behavior into the agent loop.

## Start here

- `search.ts` exposes compact search results through the selected backend.
- `fetch.ts` owns bounded public-URL fetching and chunk continuation.
- `request.ts` enforces URL, redirect, address, byte, and overall deadline policy.
- `ketch.ts` adapts the packaged search/extraction binary without giving it fetch authority.
- `youtube.ts` handles supported transcripts behind ordinary `web_fetch` semantics.

## Invariants

- Web content is untrusted data, never instruction authority.
- Block loopback, private, link-local, and prohibited destinations before and after redirects.
- Fetch uses a 60-second overall deadline and bounded redirects and bytes.
- Do not forward browser cookies, arbitrary authorization headers, methods, or request bodies.
- Search provider choice stays host-side and only the selected provider's protected key reaches its request or subprocess.
