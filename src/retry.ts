export const MAX_RETRY_DELAY_MS = 45_000;

export function canRetryStatus(status: number | undefined): boolean {
  return status === undefined || status < 400 || status >= 500 ||
    status === 408 || status === 409 || status === 425 || status === 429;
}

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

export async function fetchWithResponseTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const abort = (): void => controller.abort(signal.reason);
  const timeout = setTimeout(
    () => controller.abort(new Error(
      `Provider returned no response for ${Math.round(timeoutMs / 1000)} seconds`,
    )),
    timeoutMs,
  );
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}
