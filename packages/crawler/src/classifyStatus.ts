export type LinkVerdict = "ok" | "broken" | "blocked";

const BLOCKED_HOSTS = new Set([
  "googleusercontent.com",
  "lh3.googleusercontent.com",
  "drive.google.com",
  "docs.google.com",
  "accounts.google.com",
]);

export function classifyStatus(url: string, status?: number): LinkVerdict {
  if (!status) return "broken"; // network error etc.

  if (status >= 200 && status < 400) return "ok";

  const host = safeHost(url);

  // Treat common “bot blocked/auth required” codes as blocked for known hosts
  if ((status === 401 || status === 403 || status === 429) && host && isBlockedHost(host)) {
    return "blocked";
  }

  // “Actually broken”
  if (status === 404 || status === 410) return "broken";
  if (status >= 500) return "broken";

  // Default: anything else 4xx is broken for now
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

  // handle subdomains like *.googleusercontent.com
  for (const h of BLOCKED_HOSTS) {
    if (hostname === h) return true;
    if (hostname.endsWith("." + h)) return true;
  }
  return false;
}
