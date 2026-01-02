export default async function validateLink(url, options) {
    const timeoutMs = options?.timeoutMs ?? 12000;
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
        return res.ok
            ? { ok: true, status: res.status }
            : { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    catch (err) {
        const msg = err?.name === "AbortError"
            ? "timeout"
            : typeof err?.message === "string"
                ? err.message
                : "request failed";
        return { ok: false, status: null, error: msg };
    }
    finally {
        clearTimeout(timer);
    }
}
