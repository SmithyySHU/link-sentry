export type LinkVerdict = "ok" | "broken" | "blocked";

const BLOCKED_HOSTS = new Set([
  "googleusercontent.com",
  "lh3.googleusercontent.com",
  "drive.google.com",
  "docs.google.com",
  "accounts.google.com",
]);

const BROKEN_STATUS = new Set([404, 410]);

const BOT_PROTECTION_SERVERS = ["cloudflare", "akamai", "imperva", "fastly"];

type HeaderMap = Record<string, string> | undefined;

export function classifyStatus(url: string, status?: number, headers?: HeaderMap): LinkVerdict {
  // Network error / DNS / fetch failed etc
  if (status == null) return "broken";

  // OK + redirects
  if (status >= 200 && status < 400) return "ok";

  const host = safeHost(url);

  // Treat 401/429 as blocked by default; 403 only when we see bot/auth signals.
  if (status === 401 || status === 403 || status === 429) {
    const blockedSignals = hasBlockedSignals(host, headers);
    if (blockedSignals) return "blocked";
    if (status === 403) return "broken";
    return "blocked";
  }

  // Extra blocked host safety (kept from your original code)
  if (host && isBlockedHost(host) && (status === 400 || status === 405 || status === 406)) {
    // Some Google endpoints return odd 4xx when hit without proper headers
    return "blocked";
  }

  // Definitely broken
  if (BROKEN_STATUS.has(status)) return "broken";
  if (status >= 500) return "broken";

  // Default: other 4xx -> broken
  if (status >= 400 && status < 500) return "broken";

  return "broken";
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hasBlockedSignals(host: string | null, headers?: HeaderMap): boolean {
  if (host && isBlockedHost(host)) return true;
  if (!headers) return false;

  if (headers["www-authenticate"]) return true;
  if (headers["cf-ray"] || headers["cf-mitigated"]) return true;

  const server = headers["server"]?.toLowerCase();
  if (server) {
    for (const marker of BOT_PROTECTION_SERVERS) {
      if (server.includes(marker)) return true;
    }
  }

  return false;
}

function isBlockedHost(hostname: string): boolean {
  if (BLOCKED_HOSTS.has(hostname)) return true;

  for (const h of BLOCKED_HOSTS) {
    if (hostname === h) return true;
    if (hostname.endsWith("." + h)) return true;
  }
  return false;
}
