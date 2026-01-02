import fetchUrl from "./fetchUrl.js";
import extractLinks from "./extractLinks.js";
import validateLink from "./validateLink.js";
import { classifyStatus } from "./classifyStatus.js";
import { normaliseLink } from "./normaliseLink.js";

import { createScanRun, completeScanRun } from "../../db/src/scanRuns.js";
import { insertScanResult } from "../../db/src/scanResults.js";

export interface CrawlSummary {
  scanRunId: string;
  totalLinks: number;
  checkedLinks: number;
  brokenLinks: number;
  skippedLinks: number;
}

export async function crawlPage(
  siteId: string,
  startUrl: string
): Promise<CrawlSummary> {
  const scanRunId = await createScanRun(siteId, startUrl);

  let totalLinks = 0;
  let checked = 0;
  let skipped = 0;
  let broken = 0;

  try {
    const html = await fetchUrl(startUrl);
    if (!html) {
      await completeScanRun(scanRunId, "failed", {
        totalLinks,
        checkedLinks: checked,
        brokenLinks: broken,
      });
      throw new Error("Failed to fetch start URL");
    }

    const rawLinks = extractLinks(html);
    const uniqueRawLinks = Array.from(new Set(rawLinks));

    totalLinks = uniqueRawLinks.length;

    console.log(
      `Found ${rawLinks.length} links on ${startUrl} (${uniqueRawLinks.length} unique)`
    );

    for (const rawHref of uniqueRawLinks) {
      const normalised = normaliseLink(rawHref, startUrl);

      if (normalised.kind === "skip") {
        skipped++;
        continue;
      }

      const result = await validateLink(normalised.url);
      checked++;

      const verdict = classifyStatus(normalised.url, result.status ?? undefined);

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

      if (verdict === "ok") {
        console.log(`OK    ${result.status} ${normalised.url}`);
      } else if (verdict === "blocked") {
        console.log(`BLKD  ${result.status ?? ""} ${normalised.url}`.trim());
      } else {
        const errMsg = result.ok ? "" : result.error ?? "";
        console.log(
          `BAD   ${result.status ?? ""} ${normalised.url} ${errMsg}`.trim()
        );
      }
    }

    await completeScanRun(scanRunId, "completed", {
      totalLinks,
      checkedLinks: checked,
      brokenLinks: broken,
    });

    console.log(
      `Checked: ${checked}, Skipped: ${skipped}, Broken: ${broken}`
    );

    return {
      scanRunId,
      totalLinks,
      checkedLinks: checked,
      brokenLinks: broken,
      skippedLinks: skipped,
    };
  } catch (err) {
    console.error("Unexpected error during crawl:", err);

    await completeScanRun(scanRunId, "failed", {
      totalLinks,
      checkedLinks: checked,
      brokenLinks: broken,
    });

    throw err;
  }
}
