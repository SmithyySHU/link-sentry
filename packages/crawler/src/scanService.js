import fetchUrl from "./fetchUrl.js";
import extractLinks from "./extractLinks.js";
import validateLink from "./validateLink.js";
import { classifyStatus } from "./classifyStatus.js";
import { normaliseLink } from "./normaliseLink.js";
import { createScanRun, completeScanRun, } from "../../db/src/scanRuns.js";
import { insertScanResult } from "../../db/src/scanResults.js";
export async function runScanForSite(siteId, startUrl) {
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
        console.log(`Found ${rawLinks.length} links on ${startUrl} (${uniqueRawLinks.length} unique)`);
        const totalLinks = uniqueRawLinks.length;
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
            }
            else if (verdict === "blocked") {
                console.log(`BLKD  ${result.status ?? ""} ${normalised.url}`.trim());
            }
            else {
                const errMsg = result.ok ? "" : result.error ?? "";
                console.log(`BAD   ${result.status ?? ""} ${normalised.url} ${errMsg}`.trim());
            }
        }
        console.log(`Checked: ${checked}, Skipped: ${skipped}, Broken: ${broken}`);
        const summary = {
            totalLinks,
            checkedLinks: checked,
            brokenLinks: broken,
        };
        await completeScanRun(scanRunId, "completed", summary);
        return {
            scanRunId,
            ...summary,
        };
    }
    catch (err) {
        console.error("Unexpected error during crawl:", err);
        const totalLinks = checked + skipped;
        const summary = {
            totalLinks,
            checkedLinks: checked,
            brokenLinks: broken,
        };
        await completeScanRun(scanRunId, "failed", summary);
        return {
            scanRunId,
            ...summary,
        };
    }
}
