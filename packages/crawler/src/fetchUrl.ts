import { HTML_FETCH_TIMEOUT_MS, HTML_USER_AGENT } from "./limits.js";
const ALLOWED_PROTOCOLS = new Set< string >(["http:", "https:"]);

function validateCrawlTarget(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new Error(`Disallowed protocol in crawl URL: ${url.protocol}`);
  }

  
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  ) {
    throw new Error("Refusing to crawl localhost / loopback address");
  }

  return url;
}

export default async function fetchUrl(
  rawUrl: string,
  options?: { timeoutMs?: number; userAgent?: string }
): Promise<string | null> {
  const safeUrl = validateCrawlTarget(rawUrl).toString();

  const timeoutMs = options?.timeoutMs ?? HTML_FETCH_TIMEOUT_MS;
  const userAgent = options?.userAgent ?? HTML_USER_AGENT;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(safeUrl, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
    });

    if (!res.ok) {
      console.error(`Failed to fetch ${safeUrl}: HTTP ${res.status}`);
      return null;
    }

    const contentType = res.headers.get("content-type");
    if (contentType && !contentType.includes("text/html")) {
      console.error(`Non-HTML content for ${safeUrl}: ${contentType}`);
      return null;
    }

    return await res.text();
  } catch (err: any) {
    if (err?.name === "AbortError") {
      console.error(`Timed out fetching ${safeUrl} after ${timeoutMs}ms`);
    } else {
      console.error(`Error fetching ${safeUrl}:`, err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
