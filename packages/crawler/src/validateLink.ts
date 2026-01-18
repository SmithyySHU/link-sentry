export type LinkCheckResult =
  | { ok: true; status: number; headers: Record<string, string> }
  | {
      ok: false;
      status: number | null;
      error: string;
      headers?: Record<string, string>;
    };

function normalizeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

type ValidateLinkOptions = {
  timeoutMs?: number;
  userAgent?: string;
  signal?: AbortSignal;
};

function classifyFetchError(
  error: Error | null,
  timedOut: boolean,
  aborted: boolean,
): string {
  if (timedOut) return "timeout";
  if (aborted) return "aborted";
  if (!error) return "request_failed";
  const code = (error as { code?: string }).code;
  const message = error.message?.toLowerCase() ?? "";

  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  if (code && code.startsWith("ERR_TLS")) return "tls";
  if (message.includes("tls") || message.includes("ssl")) return "tls";
  if (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "EPIPE" ||
    code === "ETIMEDOUT"
  ) {
    return "connection_failed";
  }
  return "request_failed";
}

export default async function validateLink(
  url: string,
  options?: ValidateLinkOptions,
): Promise<LinkCheckResult> {
  const timeoutMs = options?.timeoutMs ?? 12_000;
  const userAgent =
    options?.userAgent ?? "ScanlarkBot/0.1 (+https://scanlark.dev)";

  const controller = new AbortController();
  let timedOut = false;
  let aborted = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  if (options?.signal) {
    if (options.signal.aborted) {
      aborted = true;
      controller.abort();
    } else {
      options.signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          controller.abort();
        },
        { once: true },
      );
    }
  }

  try {
    // HEAD first (cheaper). Some servers reject HEAD → fallback to GET.
    let res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": userAgent },
    });

    if (res.status === 405 || res.status === 403) {
      // 405: method not allowed, 403: sometimes blocks HEAD specifically
      res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "user-agent": userAgent,
          accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        },
      });
    }

    const normalizedHeaders = normalizeHeaders(res.headers);
    return res.ok
      ? { ok: true, status: res.status, headers: normalizedHeaders }
      : {
          ok: false,
          status: res.status,
          error: `HTTP ${res.status}`,
          headers: normalizedHeaders,
        };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : null;
    if (error?.name === "AbortError") {
      timedOut = timedOut || !aborted;
    }
    const msg = classifyFetchError(error, timedOut, aborted);
    return { ok: false, status: null, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
