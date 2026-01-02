import fetchUrl from "./fetchUrl.js";
import extractLinks from "./extractLinks.js";
import validateLink from "./validateLink.js";
import { classifyStatus } from "./classifyStatus.js";
import { normaliseLink } from "./normaliseLink.js";
import { MAX_LINKS_PER_PAGE } from "./limits.js";

import { createScanRun, completeScanRun } from "../../db/src/scanRuns.js";
import { insertScanResult } from "../../db/src/scanResults.js";

export async function runScanForSite(
  siteId: string,
  startUrl: string
): Promise<void> {
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
      return;
    }

    const rawLinks = extractLinks(html);
    const uniqueRawLinks = Array.from(new Set(rawLinks));

    const linksToCheck =
      uniqueRawLinks.length > MAX_LINKS_PER_PAGE
        ? uniqueRawLinks.slice(0, MAX_LINKS_PER_PAGE)
        : uniqueRawLinks;

    console.log(
      `Found ${rawLinks.length} links on ${startUrl} (${uniqueRawLinks.length} unique, checking ${linksToCheck.length})`
    );

    for (const rawHref of linksToCheck) {
      const normalised = normaliseLink(rawHref, startUrl);

      if (normalised.kind === "skip") {
        skipped++;
        continue;
      }

      checked++;

      const result = await validateLink(normalised.url);
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
        console.log(
          `BLKD  ${result.status ?? ""} ${normalised.url}`.trim()
        );
      } else {
        const errMsg = result.ok ? "" : result.error ?? "";
        console.log(
          `BAD   ${result.status ?? ""} ${normalised.url} ${errMsg}`.trim()
        );
      }
    }

    await completeScanRun(scanRunId, "completed", {
      totalLinks: uniqueRawLinks.length,
      checkedLinks: checked,
      brokenLinks: broken,
    });

    console.log(
      `Checked: ${checked}, Skipped: ${skipped}, Broken: ${broken}`
    );
  } catch (err) {
    console.error("Unexpected error during crawl:", err);
    await completeScanRun(scanRunId, "failed", {
      totalLinks: 0,
      checkedLinks: checked,
      brokenLinks: broken,
    });
  }
}

export async function runScanForSiteFromArgs(): Promise<void> {
  const siteId = process.argv[2];
  const url = process.argv[3];

  if (!siteId || !url) {
    console.error("Usage: npm run scan:once -- <siteId> <url>");
    process.exitCode = 1;
    return;
  }

  await runScanForSite(siteId, url);
}
