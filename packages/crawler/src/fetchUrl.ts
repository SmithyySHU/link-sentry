import { HTML_FETCH_TIMEOUT_MS, HTML_USER_AGENT } from "./limits.js";

export default async function fetchUrl(
  url: string,
  options?: { timeoutMs?: number; userAgent?: string }
): Promise<string | null> {
  const timeoutMs = options?.timeoutMs ?? HTML_FETCH_TIMEOUT_MS;
  const userAgent = options?.userAgent ?? HTML_USER_AGENT;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
    });

    if (!res.ok) {
      console.error(`Failed to fetch ${url}: HTTP ${res.status}`);
      return null;
    }

    const contentType = res.headers.get("content-type");
    if (contentType && !contentType.includes("text/html")) {
      console.error(`Non-HTML content for ${url}: ${contentType}`);
      return null;
    }

    return await res.text();
  } catch (err: any) {
    if (err?.name === "AbortError") {
      console.error(`Timed out fetching ${url} after ${timeoutMs}ms`);
    } else {
      console.error(`Error fetching ${url}:`, err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
