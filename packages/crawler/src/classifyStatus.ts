export type LinkVerdict = "ok" | "broken" | "blocked";

const BLOCKED_HOSTS = new Set([
  "googleusercontent.com",
  "lh3.googleusercontent.com",
  "drive.google.com",
  "docs.google.com",
  "accounts.google.com",
]);

const BLOCKED_STATUS = new Set([401, 403, 429]);
const BROKEN_STATUS = new Set([404, 410]);

export function classifyStatus(url: string, status?: number): LinkVerdict {
  // Network error / DNS / fetch failed etc
  if (status == null) return "broken";

  // OK + redirects
  if (status >= 200 && status < 400) return "ok";

  // If the server says “you can’t access this / slow down / login”
  // treat as BLOCKED (not broken) – this is the big change.
  if (BLOCKED_STATUS.has(status)) return "blocked";

  const host = safeHost(url);

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

function isBlockedHost(hostname: string): boolean {
  if (BLOCKED_HOSTS.has(hostname)) return true;

  for (const h of BLOCKED_HOSTS) {
    if (hostname === h) return true;
    if (hostname.endsWith("." + h)) return true;
  }
  return false;
}
