export const MAX_RETRY_DELAY_MS = 45_000;

export function retryBackoffMs(retry: number, retryAfterMs = 0): number {
  const backoff = retry <= 2
    ? retry * 500
    : retry === 3 ? 15_000 : MAX_RETRY_DELAY_MS;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(backoff, retryAfterMs));
}

export function retryAfterMilliseconds(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

export function waitForRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(done, milliseconds);

    function done(): void {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }

    function aborted(): void {
      clearTimeout(timeout);
      reject(signal?.reason ?? new Error("Aborted"));
    }

    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}
