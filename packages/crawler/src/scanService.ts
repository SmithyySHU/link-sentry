import fetchUrl from "./fetchUrl.js";
import extractLinks from "./extractLinks.js";
import validateLink from "./validateLink.js";
import { classifyStatus } from "./classifyStatus.js";
import { normaliseLink } from "./normaliseLink.js";
import {
  createScanRun,
  completeScanRun,
} from "../../db/src/scanRuns.js";
import { insertScanResult } from "../../db/src/scanResults.js";



export interface ScanExecutionSummary {
  scanRunId: string;
  totalLinks: number;
  checkedLinks: number;
  brokenLinks: number;
}

export async function runScanForSite(
  siteId: string,
  startUrl: string
): Promise<ScanExecutionSummary> {
  const scanRunId = await createScanRun(siteId, startUrl);

  let checked = 0;
  let skipped = 0;
  let broken = 0;

  try {
    const html = await fetchUrl(startUrl);
    if (!html) {
      await completeScanRun(scanRunId, "failed", {
        totalLinks: 0,
        checkedLinks: 0,
        brokenLinks: 0,
      });

      return {
        scanRunId,
        totalLinks: 0,
        checkedLinks: 0,
        brokenLinks: 0,
      };
    }

    const rawLinks = extractLinks(html);
    const uniqueRawLinks = Array.from(new Set(rawLinks));
    const totalLinks = uniqueRawLinks.length;

    for (const rawHref of uniqueRawLinks) {
      const normalised = normaliseLink(rawHref, startUrl);

      if (normalised.kind === "skip") {
        skipped++;
        continue;
      }

      const result = await validateLink(normalised.url);
      checked++;

      const verdict = classifyStatus(
        normalised.url,
        result.status ?? undefined
      );

      if (verdict === "broken") {
        broken++;
      }

      await insertScanResult({
        scanRunId,
        sourcePage: startUrl,
        linkUrl: normalised.url,
        statusCode: result.status ?? null,
        classification: verdict,
        errorMessage: result.ok ? undefined : result.error,
      });
    }

    await completeScanRun(scanRunId, "completed", {
      totalLinks,
      checkedLinks: checked,
      brokenLinks: broken,
    });

    return {
      scanRunId,
      totalLinks,
      checkedLinks: checked,
      brokenLinks: broken,
    };
  } catch (err) {
    console.error("Unexpected error during scan", err);

    await completeScanRun(scanRunId, "failed", {
      totalLinks: 0,
      checkedLinks: checked,
      brokenLinks: broken,
    });

    return {
      scanRunId,
      totalLinks: 0,
      checkedLinks: checked,
      brokenLinks: broken,
    };
  }
}
