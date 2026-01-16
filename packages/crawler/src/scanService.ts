import fetchUrl from "./fetchUrl.js";
import extractLinks from "./extractLinks.js";
import validateLink from "./validateLink.js";
import { classifyStatus } from "./classifyStatus.js";
import { normaliseLink } from "./normaliseLink.js";
import {
  createScanRun,
  completeScanRun,
  updateScanRunProgress,
} from "../../db/src/scanRuns";
import { insertScanResult } from "../../db/src/scanResults.js";

export interface ScanExecutionSummary {
  scanRunId: string;
  totalLinks: number;
  checkedLinks: number;
  brokenLinks: number;
}

/**
 * Create a scan run in the database and return the ID.
 * This allows the API to return immediately with a scanRunId,
 * then run the scan asynchronously in the background.
 */
export async function getScanRunIdOnly(
  siteId: string,
  startUrl: string
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

function canonicalUrl(u: string) {
  const x = new URL(u);
  x.hash = "";
  return x.toString();
}

function looksLikeNonHtmlPath(pathname: string) {
  const lower = pathname.toLowerCase();
  const exts = [
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico",
    ".css", ".js", ".mjs", ".map",
    ".pdf", ".zip", ".rar", ".7z", ".gz", ".tar",
    ".mp3", ".mp4", ".mov", ".avi", ".mkv",
    ".woff", ".woff2", ".ttf", ".eot",
    ".xml", ".json",
  ];
  return exts.some((e) => lower.endsWith(e));
}

type ValidationResult = {
  ok: boolean;
  status: number | null;
  error?: string;
  verdict: "ok" | "broken" | "blocked";
};

export async function runScanForSite(
  siteId: string,
  startUrl: string,
  scanRunId?: string
): Promise<ScanExecutionSummary> {
  // If scanRunId is not provided, create a new one
  const actualScanRunId = scanRunId ?? (await createScanRun(siteId, startUrl));

  const MAX_PAGES = 25;
  const MAX_DEPTH = 2;
  const PAGE_CONCURRENCY = 4;
  const LINK_CONCURRENCY = 8;
  const INSERT_CONCURRENCY = 12;

  const limitPage = createLimiter(PAGE_CONCURRENCY);
  const limitLink = createLimiter(LINK_CONCURRENCY);
  const limitInsert = createLimiter(INSERT_CONCURRENCY);

  let checkedUnique = 0;
  let brokenUnique = 0;

  const discoveredLinks = new Set<string>();
  const validatedOnce = new Set<string>();
  const validationMap = new Map<string, Promise<ValidationResult>>();

  let progressTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTotal = 0;
  let lastChecked = 0;
  let lastBroken = 0;

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

  const getValidation = (url: string): Promise<ValidationResult> => {
    const existing = validationMap.get(url);
    if (existing) return existing;

    const p = limitLink(async () => {
      const r = await validateLink(url);
      const verdict = classifyStatus(url, r.status ?? undefined) as ValidationResult["verdict"];

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
    const v = await getValidation(linkUrl);

    await insertScanResult({
      scanRunId,
      sourcePage,
      linkUrl,
      statusCode: v.status,
      classification: v.verdict,
      errorMessage: v.ok ? undefined : v.error,
    });
  };

  type PageJob = { url: string; depth: number };
  const pageQueue: PageJob[] = [{ url: canonicalUrl(startUrl), depth: 0 }];
  const visitedPages = new Set<string>();

  const occurrenceTasks: Array<Promise<void>> = [];

  const processPage = async (pageUrl: string, depth: number) => {
    const html = await fetchUrl(pageUrl);
    if (!html) return;

    const rawLinks = extractLinks(html);
    const uniqueRawLinks = Array.from(new Set(rawLinks));

    for (const rawHref of uniqueRawLinks) {
      const n = normaliseLink(rawHref, pageUrl);
      if (n.kind === "skip") continue;

      const linkUrl = canonicalUrl(n.url);

      if (!discoveredLinks.has(linkUrl)) {
        discoveredLinks.add(linkUrl);
        scheduleProgressWrite(discoveredLinks.size);
      }

      occurrenceTasks.push(
        limitInsert(() => insertOccurrence(pageUrl, linkUrl))
      );

      try {
        const u = new URL(linkUrl);

        if (u.origin === startOrigin && depth < MAX_DEPTH) {
          if (!looksLikeNonHtmlPath(u.pathname)) {
            const nextPage = canonicalUrl(u.toString());
            if (!visitedPages.has(nextPage) && visitedPages.size + pageQueue.length < MAX_PAGES) {
              pageQueue.push({ url: nextPage, depth: depth + 1 });
            }
          }
        }
      } catch {}
    }
  };

  try {
    await updateScanRunProgress(scanRunId, {
      totalLinks: 0,
      checkedLinks: 0,
      brokenLinks: 0,
    });

    const inFlight = new Set<Promise<void>>();

    while (pageQueue.length > 0 || inFlight.size > 0) {
      while (pageQueue.length > 0 && inFlight.size < PAGE_CONCURRENCY && visitedPages.size < MAX_PAGES) {
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
    await flushProgressWrite(discoveredLinks.size);

    console.log(`[scan] Completing scan ${actualScanRunId} with status completed`);
    await completeScanRun(actualScanRunId, "completed", {
      totalLinks: discoveredLinks.size,
      checkedLinks: checkedUnique,
      brokenLinks: brokenUnique,
    });
    console.log(`[scan] Scan ${actualScanRunId} completed successfully`);

    return {
      scanRunId: actualScanRunId,
      totalLinks: discoveredLinks.size,
      checkedLinks: checkedUnique,
      brokenLinks: brokenUnique,
    };
  } catch (err) {
    console.error("Unexpected error during scan", err);

    await flushProgressWrite(discoveredLinks.size);

    console.log(`[scan] Completing scan ${actualScanRunId} with status failed`);
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
    };
  }
}
