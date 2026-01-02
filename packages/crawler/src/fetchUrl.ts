export default async function fetchUrl(
  url: string,
  options?: {
    timeoutMs?: number;
    userAgent?: string;
  }
): Promise<string | null> {
  const timeoutMs = options?.timeoutMs ?? 15_000;
  const userAgent = options?.userAgent ?? "Link-SentryBot/0.1 (+https://link-sentry.dev)";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": userAgent,
        "accept": "text/html,application/xhtml+xml"
      }
    });

    if (!res.ok) return null;

    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
