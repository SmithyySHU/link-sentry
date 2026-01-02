import fetchUrl from "./fetchUrl.js";
import extractLinks from "./extractLinks.js";
import validateLink from "./validateLink.js";
import { classifyStatus } from "./classifyStatus.js";
import { normaliseLink } from "./normaliseLink.js";

import { createScanRun, completeScanRun } from "../../db/src/scanRuns.js";
import { insertScanResult } from "../../db/src/scanResults.js";

async function crawlPage(siteId: string, startUrl: string) {
  const scanRunId = await createScanRun(siteId, startUrl);

  let checked = 0;
  let skipped = 0;
  let brokenLinks = 0;

  try {
    const html = await fetchUrl(startUrl);
    if (!html) {
      console.error("Failed to fetch the page.");
      await completeScanRun(scanRunId, "failed", {
        totalLinks: 0,
        checkedLinks: 0,
        brokenLinks: 0,
      });
      return;
    }

    const rawLinks = extractLinks(html);
    const uniqueRawLinks = Array.from(new Set(rawLinks));
    const totalLinks = uniqueRawLinks.length;

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

      const verdict = classifyStatus(
        normalised.url,
        result.status ?? undefined
      );
      if (verdict === "broken") {
        brokenLinks++;
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
      totalLinks,
      checkedLinks: checked,
      brokenLinks,
    });

    console.log(
      `Checked: ${checked}, Skipped: ${skipped}, Broken: ${brokenLinks}`
    );
  } catch (err) {
    console.error("Unexpected error during crawl:", err);
    await completeScanRun(scanRunId, "failed", {
      totalLinks: checked + skipped,
      checkedLinks: checked,
      brokenLinks,
    });
  }
}

const [siteIdArg, startUrlArg] = process.argv.slice(2);

if (!siteIdArg || !startUrlArg) {
  console.error(
    "Usage: npm run dev:crawler -- <siteId> <startUrl>"
  );
  process.exit(1);
}

await crawlPage(siteIdArg, startUrlArg);
