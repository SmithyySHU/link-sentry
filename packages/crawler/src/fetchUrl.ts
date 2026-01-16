import { HTML_FETCH_TIMEOUT_MS, HTML_USER_AGENT } from "./limits.js";
import { lookup } from "dns/promises";

const ALLOWED_PROTOCOLS = new Set<string>(["http:", "https:"]);
const MAX_REDIRECTS = 5;

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map((p) => Number(p));
  if (
    parts.length !== 4 ||
    parts.some(
      (p) => !Number.isInteger(p) || p < 0 || p > 255 || Number.isNaN(p)
    )
  ) {
    return null;
  }
  return (
    ((parts[0] << 24) |
      (parts[1] << 16) |
      (parts[2] << 8) |
      parts[3]) >>> 0
  );
}

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;

  const inRange = (start: string, end: string) => {
    const s = ipv4ToInt(start)!;
    const e = ipv4ToInt(end)!;
    return n >= s && n <= e;
  };

  // 10.0.0.0/8
  if (inRange("10.0.0.0", "10.255.255.255")) return true;
  // 172.16.0.0/12
  if (inRange("172.16.0.0", "172.31.255.255")) return true;
  // 192.168.0.0/16
  if (inRange("192.168.0.0", "192.168.255.255")) return true;
  // 169.254.0.0/16 (link-local)
  if (inRange("169.254.0.0", "169.254.255.255")) return true;
  // 127.0.0.0/8 (loopback)
  if (inRange("127.0.0.0", "127.255.255.255")) return true;

  return false;
}

function isPrivateOrLoopbackIp(ip: string): boolean {
  // IPv4
  if (ip.includes(".")) {
    if (ip === "127.0.0.1") return true;
    return isPrivateIpv4(ip);
  }

  // Very simple IPv6 checks (good enough for now)
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local

  return false;
}

async function ensureSafeDestination(hostname: string): Promise<void> {
  const lower = hostname.toLowerCase();

  // Basic hostname bans
  if (
    lower === "localhost" ||
    lower === "127.0.0.1" ||
    lower === "::1"
  ) {
    throw new Error("Refusing to crawl localhost / loopback address");
  }

  // Resolve hostname and check all returned addresses
  const addresses = await lookup(hostname, { all: true });

  for (const addr of addresses) {
    if (isPrivateOrLoopbackIp(addr.address)) {
      throw new Error(
        `Refusing to crawl internal/private address: ${addr.address}`
      );
    }
  }
}

const ALLOWED_PORTS = new Set<number>([80, 443]); // http/https defaults

async function validateCrawlTarget(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new Error(`Disallowed protocol in crawl URL: ${url.protocol}`);
  }

  // Optional: restrict ports to typical web ports only
  const port = url.port ? Number(url.port) : (url.protocol === "https:" ? 443 : 80);
  if (!ALLOWED_PORTS.has(port)) {
    throw new Error(`Disallowed port in crawl URL: ${port}`);
  }

  await ensureSafeDestination(url.hostname);

  return url;
}

// The crawler intentionally fetches user-supplied URLs, but we:
// - restrict to http/https
// - restrict ports to 80/443
// - resolve DNS and block private/loopback IP ranges
// - revalidate on redirects and cap redirect depth
export default async function fetchUrl(
  rawUrl: string,
  options?: { timeoutMs?: number; userAgent?: string }
): Promise<string | null> {
  const initialUrl = (await validateCrawlTarget(rawUrl)).toString();

  const timeoutMs = options?.timeoutMs ?? HTML_FETCH_TIMEOUT_MS;
  const userAgent = options?.userAgent ?? HTML_USER_AGENT;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = initialUrl;
    let res: Response | null = null;

    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      res = await fetch(currentUrl, {
        method: "GET",
        signal: controller.signal,
        redirect: "manual", // manual so we can validate each hop
        headers: {
          "user-agent": userAgent,
          accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        },
      });

      const status = res.status;

      // 3xx redirect handling
      if (status >= 300 && status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          console.error("Redirect without Location header", {
            fromUrl: currentUrl,
            status,
          });
          return null;
        }

        const nextUrl = new URL(location, currentUrl);
        await validateCrawlTarget(nextUrl.toString());
        currentUrl = nextUrl.toString();

        if (i === MAX_REDIRECTS) {
          console.error("Too many redirects when fetching URL", {
            initialUrl,
          });
          return null;
        }

        continue;
      }

      // Not a redirect => use this response
      break;
    }

    if (!res) {
      console.error("No response received for URL", { initialUrl });
      return null;
    }

    if (!res.ok) {
      console.error("Failed to fetch URL", {
        url: currentUrl,
        status: res.status,
      });
      return null;
    }

    const contentType = res.headers.get("content-type");
    if (contentType && !contentType.includes("text/html")) {
      console.error("Non-HTML content for URL", {
        url: currentUrl,
        contentType,
      });
      return null;
    }

    return await res.text();
  } catch (err: unknown) {
    const error = err instanceof Error ? err : null;
    if (error?.name === "AbortError") {
      console.error("Timed out fetching URL", {
        url: rawUrl,
        timeoutMs,
      });
    } else {
      console.error("Error fetching URL", {
        url: rawUrl,
        error,
      });
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
