export type LinkCheckResult =
  | { ok: true; status: number; headers: Record<string, string> }
  | { ok: false; status: number | null; error: string; headers?: Record<string, string> };

function normalizeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export default async function validateLink(
  url: string,
  options?: { timeoutMs?: number; userAgent?: string }
): Promise<LinkCheckResult> {
  const timeoutMs = options?.timeoutMs ?? 12_000;
  const userAgent = options?.userAgent ?? "Link-SentryBot/0.1 (+https://link-sentry.dev)";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // HEAD first (cheaper). Some servers reject HEAD → fallback to GET.
    let res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": userAgent }
    });

    if (res.status === 405 || res.status === 403) {
      // 405: method not allowed, 403: sometimes blocks HEAD specifically
      res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "user-agent": userAgent,
          "accept": "text/html,application/xhtml+xml,*/*;q=0.8"
        }
      });
    }

    const normalizedHeaders = normalizeHeaders(res.headers);
    return res.ok
      ? { ok: true, status: res.status, headers: normalizedHeaders }
      : { ok: false, status: res.status, error: `HTTP ${res.status}`, headers: normalizedHeaders };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : null;
    const msg =
      error?.name === "AbortError"
        ? "timeout"
        : typeof error?.message === "string"
          ? error.message
          : "request failed";
    return { ok: false, status: null, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
