import fetchUrl from "./fetchUrl";
import extractLinks from "./extractLinks";
import validateLink from "./validateLink";
import { classifyStatus } from "./classifyStatus";
import { normaliseLink } from "./normaliseLink";
import type { IgnoreRule } from "@link-sentry/db";
import {
  completeScanRun,
  createScanRun,
  findMatchingIgnoreRule,
  getScanRunStatus,
  insertIgnoredOccurrence,
  insertScanLinkOccurrence,
  insertScanResult,
  listIgnoreRules,
  setScanRunStatus,
  touchScanRun,
  updateScanRunProgress,
  upsertIgnoredLink,
  upsertScanLink,
} from "@link-sentry/db";

export interface ScanExecutionSummary {
  scanRunId: string;
  totalLinks: number;
  checkedLinks: number;
  brokenLinks: number;
  ignoredLinks: number;
}

/**
 * Create a scan run in the database and return the ID.
 * This allows the API to return immediately with a scanRunId,
 * then run the scan asynchronously in the background.
 */
export async function getScanRunIdOnly(
  siteId: string,
  startUrl: string,
): Promise<string> {
  return await createScanRun(siteId, startUrl);
}

function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    if (active >= concurrency) return;
    const job = queue.shift();
    if (!job) return;
    active++;
    job();
  };

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(async () => {
        try {
          const res = await fn();
          resolve(res);
        } catch (e) {
          reject(e);
        } finally {
          active--;
          next();
        }
      });
      next();
    });
  };
}

function createDomainLimiter(maxInFlight: number, minDelayMs: number) {
  const state = new Map<
    string,
    { active: number; queue: Array<() => void>; nextAllowedAt: number }
  >();

  const runNext = (key: string) => {
    const entry = state.get(key);
    if (!entry) return;
    if (entry.active >= maxInFlight) return;
    const job = entry.queue.shift();
    if (!job) return;
    const now = Date.now();
    const delay = Math.max(0, entry.nextAllowedAt - now);
    entry.active++;
    const start = () => {
      entry.nextAllowedAt = Date.now() + minDelayMs;
      job();
    };
    if (delay > 0) {
      setTimeout(start, delay);
    } else {
      start();
    }
  };

  return function schedule<T>(url: string, fn: () => Promise<T>): Promise<T> {
    const host = safeHost(url) ?? "unknown";
    const entry = state.get(host) ?? { active: 0, queue: [], nextAllowedAt: 0 };
    state.set(host, entry);

    return new Promise<T>((resolve, reject) => {
      entry.queue.push(async () => {
        try {
          const res = await fn();
          resolve(res);
        } catch (e) {
          reject(e);
        } finally {
          entry.active--;
          runNext(host);
        }
      });
      runNext(host);
    });
  };
}

function canonicalUrl(u: string) {
  const x = new URL(u);
  x.hash = "";
  return x.toString();
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// Manual test plan:
// - Start a scan and confirm progress updates and last-updated timestamp.
// - Cancel a scan mid-way; ensure it stops and status becomes cancelled.
// - Verify blocked/no_response links are classified and filtered correctly.

function looksLikeNonHtmlPath(pathname: string) {
  const lower = pathname.toLowerCase();
  const exts = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".svg",
    ".ico",
    ".css",
    ".js",
    ".mjs",
    ".map",
    ".pdf",
    ".zip",
    ".rar",
    ".7z",
    ".gz",
    ".tar",
    ".mp3",
    ".mp4",
    ".mov",
    ".avi",
    ".mkv",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".xml",
    ".json",
  ];
  return exts.some((e) => lower.endsWith(e));
}

type ValidationResult = {
  ok: boolean;
  status: number | null;
  error?: string;
  verdict: "ok" | "broken" | "blocked" | "no_response";
};

function shouldIgnoreUrl(siteId: string, url: string, rules: IgnoreRule[]) {
  return !!findMatchingIgnoreRule(siteId, url, null, rules);
}

export async function runScanForSite(
  siteId: string,
  startUrl: string,
  scanRunId?: string,
): Promise<ScanExecutionSummary> {
  // Ensure the scan run exists before any background work starts.
  const actualScanRunId: string =
    scanRunId ?? (await createScanRun(siteId, startUrl));

  await setScanRunStatus(actualScanRunId, "in_progress");

  const MAX_PAGES = 25;
  const MAX_DEPTH = 2;
  const PAGE_CONCURRENCY = 4;
  const LINK_CONCURRENCY = 8;
  const INSERT_CONCURRENCY = 12;
  const DOMAIN_CONCURRENCY = 2;
  const DOMAIN_MIN_DELAY_MS = 150;
  const CANCEL_POLL_MS = 1000;

  // Concurrency caps protect both the target site and our DB.
  const limitPage = createLimiter(PAGE_CONCURRENCY);
  const limitLink = createLimiter(LINK_CONCURRENCY);
  const limitInsert = createLimiter(INSERT_CONCURRENCY);
  const limitDomain = createDomainLimiter(
    DOMAIN_CONCURRENCY,
    DOMAIN_MIN_DELAY_MS,
  );

  let checkedUnique = 0;
  let brokenUnique = 0;
  let ignoredCount = 0;
  let cancelled = false;

  const discoveredLinks = new Set<string>();
  const validatedOnce = new Set<string>();
  const validationMap = new Map<string, Promise<ValidationResult>>();

  let progressTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTotal = 0;
  let lastChecked = 0;
  let lastBroken = 0;

  // Debounce progress updates to avoid noisy DB writes on every link.
  const scheduleProgressWrite = (totalLinks: number) => {
    if (progressTimer) return;
    progressTimer = setTimeout(async () => {
      progressTimer = null;

      const should =
        totalLinks !== lastTotal ||
        checkedUnique !== lastChecked ||
        brokenUnique !== lastBroken;

      if (!should) return;

      lastTotal = totalLinks;
      lastChecked = checkedUnique;
      lastBroken = brokenUnique;

      try {
        await updateScanRunProgress(actualScanRunId, {
          totalLinks,
          checkedLinks: checkedUnique,
          brokenLinks: brokenUnique,
        });
      } catch {}
    }, 250);
  };

  const flushProgressWrite = async (totalLinks: number) => {
    if (progressTimer) {
      clearTimeout(progressTimer);
      progressTimer = null;
    }
    try {
      await updateScanRunProgress(actualScanRunId, {
        totalLinks,
        checkedLinks: checkedUnique,
        brokenLinks: brokenUnique,
      });
    } catch {}
  };

  const startOrigin = new URL(startUrl).origin;
  const ignoreRules = await listIgnoreRules(siteId, { enabledOnly: true });
  const cancelController = new AbortController();

  const retryDelays = [400, 900];
  let cancelTimer: ReturnType<typeof setInterval> | null = null;
  let touchTimer: ReturnType<typeof setInterval> | null = null;

  const getValidation = (url: string): Promise<ValidationResult> => {
    const existing = validationMap.get(url);
    if (existing) return existing;

    const p = limitLink(async () => {
      let r = await limitDomain(url, () =>
        validateLink(url, { signal: cancelController.signal }),
      );
      for (let i = 0; i < retryDelays.length; i++) {
        if (cancelled) break;
        if (r.status != null) break;
        if (!r.ok && r.error === "aborted") break;
        const jitter = Math.floor(Math.random() * 200);
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelays[i] + jitter),
        );
        r = await limitDomain(url, () =>
          validateLink(url, { signal: cancelController.signal }),
        );
      }
      const verdict = classifyStatus(
        url,
        r.status ?? undefined,
        r.headers,
      ) as ValidationResult["verdict"];

      if (!validatedOnce.has(url)) {
        validatedOnce.add(url);
        checkedUnique++;
        if (verdict === "broken") brokenUnique++;
        scheduleProgressWrite(discoveredLinks.size);
      }

      return {
        ok: r.ok,
        status: r.status ?? null,
        error: r.ok ? undefined : r.error,
        verdict,
      };
    });

    validationMap.set(url, p);
    return p;
  };

  const insertOccurrence = async (sourcePage: string, linkUrl: string) => {
    if (cancelled) return;
    const preRule = findMatchingIgnoreRule(siteId, linkUrl, null, ignoreRules);
    if (preRule && preRule.rule_type !== "status_code") {
      const ignored = await upsertIgnoredLink({
        scanRunId: actualScanRunId,
        linkUrl,
        ruleId: preRule.id,
        statusCode: null,
      });
      await insertIgnoredOccurrence({
        scanIgnoredLinkId: ignored.id,
        scanRunId: actualScanRunId,
        linkUrl,
        sourcePage,
      });
      ignoredCount++;
      return;
    }

    const v = await getValidation(linkUrl);
    const matchRule = findMatchingIgnoreRule(
      siteId,
      linkUrl,
      v.status,
      ignoreRules,
    );
    if (matchRule) {
      const ignored = await upsertIgnoredLink({
        scanRunId: actualScanRunId,
        linkUrl,
        ruleId: matchRule.id,
        statusCode: v.status,
        errorMessage: v.ok ? undefined : v.error,
      });
      await insertIgnoredOccurrence({
        scanIgnoredLinkId: ignored.id,
        scanRunId: actualScanRunId,
        linkUrl,
        sourcePage,
      });
      ignoredCount++;
      return;
    }

    // ✅ Optional: write to legacy scan_results (disabled by default)
    const writeLegacy = process.env.WRITE_LEGACY_SCAN_RESULTS === "true";
    if (writeLegacy) {
      await insertScanResult({
        scanRunId: actualScanRunId,
        sourcePage,
        linkUrl,
        statusCode: v.status,
        classification: v.verdict,
        errorMessage: v.ok ? undefined : v.error,
      });
    }

    // ✅ Write to dedup tables (new primary storage)
    const scanLink = await upsertScanLink({
      scanRunId: actualScanRunId,
      linkUrl,
      classification: v.verdict,
      statusCode: v.status,
      errorMessage: v.ok ? undefined : v.error,
    });

    // ✅ Track this specific occurrence
    await insertScanLinkOccurrence({
      scanLinkId: scanLink.id,
      scanRunId: actualScanRunId,
      linkUrl,
      sourcePage,
    });
  };

  type PageJob = { url: string; depth: number };
  const pageQueue: PageJob[] = [{ url: canonicalUrl(startUrl), depth: 0 }];
  const visitedPages = new Set<string>();

  const occurrenceTasks: Array<Promise<void>> = [];

  const processPage = async (pageUrl: string, depth: number) => {
    const html = await limitDomain(pageUrl, () =>
      fetchUrl(pageUrl, { signal: cancelController.signal }),
    );
    if (!html) return;

    const rawLinks = extractLinks(html);
    const uniqueRawLinks = Array.from(new Set(rawLinks));

    for (const rawHref of uniqueRawLinks) {
      const n = normaliseLink(rawHref, pageUrl);
      if (n.kind === "skip") continue;

      const linkUrl = canonicalUrl(n.url);
      const isIgnored = shouldIgnoreUrl(siteId, linkUrl, ignoreRules);

      if (!discoveredLinks.has(linkUrl)) {
        discoveredLinks.add(linkUrl);
        scheduleProgressWrite(discoveredLinks.size);
      }

      occurrenceTasks.push(
        limitInsert(() => insertOccurrence(pageUrl, linkUrl)),
      );

      try {
        const u = new URL(linkUrl);

        if (!isIgnored && u.origin === startOrigin && depth < MAX_DEPTH) {
          if (!looksLikeNonHtmlPath(u.pathname)) {
            const nextPage = canonicalUrl(u.toString());
            if (
              !visitedPages.has(nextPage) &&
              visitedPages.size + pageQueue.length < MAX_PAGES
            ) {
              pageQueue.push({ url: nextPage, depth: depth + 1 });
            }
          }
        }
      } catch {}
    }
  };

  try {
    // ✅ FIX: use actualScanRunId
    await updateScanRunProgress(actualScanRunId, {
      totalLinks: 0,
      checkedLinks: 0,
      brokenLinks: 0,
    });

    const inFlight = new Set<Promise<void>>();
    let cancelCheckInFlight = false;
    cancelTimer = setInterval(async () => {
      if (cancelled || cancelCheckInFlight) return;
      cancelCheckInFlight = true;
      try {
        const status = await getScanRunStatus(actualScanRunId);
        if (status?.status === "cancelled") {
          cancelled = true;
          cancelController.abort();
        }
      } catch {
      } finally {
        cancelCheckInFlight = false;
      }
    }, CANCEL_POLL_MS);

    touchTimer = setInterval(() => {
      if (cancelled) return;
      void touchScanRun(actualScanRunId);
    }, 1000);

    while (pageQueue.length > 0 || inFlight.size > 0) {
      if (cancelled) break;
      while (
        pageQueue.length > 0 &&
        inFlight.size < PAGE_CONCURRENCY &&
        visitedPages.size < MAX_PAGES
      ) {
        if (cancelled) break;
        const job = pageQueue.shift()!;
        const pageUrl = job.url;

        if (visitedPages.has(pageUrl)) continue;
        visitedPages.add(pageUrl);

        const p = limitPage(() => processPage(pageUrl, job.depth));
        inFlight.add(p);

        p.finally(() => {
          inFlight.delete(p);
        });
      }

      if (inFlight.size > 0) {
        await Promise.race(inFlight);
      }
    }

    await Promise.allSettled(occurrenceTasks);
    await Promise.allSettled(Array.from(validationMap.values()));
    if (cancelTimer) clearInterval(cancelTimer);
    if (touchTimer) clearInterval(touchTimer);

    if (cancelled) {
      await flushProgressWrite(discoveredLinks.size);
      return {
        scanRunId: actualScanRunId,
        totalLinks: discoveredLinks.size,
        checkedLinks: checkedUnique,
        brokenLinks: brokenUnique,
        ignoredLinks: ignoredCount,
      };
    }

    await flushProgressWrite(discoveredLinks.size);

    await completeScanRun(actualScanRunId, "completed", {
      totalLinks: discoveredLinks.size,
      checkedLinks: checkedUnique,
      brokenLinks: brokenUnique,
    });

    return {
      scanRunId: actualScanRunId,
      totalLinks: discoveredLinks.size,
      checkedLinks: checkedUnique,
      brokenLinks: brokenUnique,
      ignoredLinks: ignoredCount,
    };
  } catch (err) {
    console.error("Unexpected error during scan", err);

    await flushProgressWrite(discoveredLinks.size);

    if (cancelTimer) clearInterval(cancelTimer);
    if (touchTimer) clearInterval(touchTimer);

    if (cancelled) {
      return {
        scanRunId: actualScanRunId,
        totalLinks: discoveredLinks.size,
        checkedLinks: checkedUnique,
        brokenLinks: brokenUnique,
        ignoredLinks: ignoredCount,
      };
    }

    await completeScanRun(actualScanRunId, "failed", {
      totalLinks: discoveredLinks.size,
      checkedLinks: checkedUnique,
      brokenLinks: brokenUnique,
    });

    return {
      scanRunId: actualScanRunId,
      totalLinks: discoveredLinks.size,
      checkedLinks: checkedUnique,
      brokenLinks: brokenUnique,
      ignoredLinks: ignoredCount,
    };
  }
}
