import { crawlPage } from "./index.js";

async function main(): Promise<void> {
  const [siteId, startUrl] = process.argv.slice(2);

  if (!siteId || !startUrl) {
    console.error(
      "Usage: npm run scan:once -- <siteId> <startUrl>"
    );
    process.exit(1);
  }

  try {
    const summary = await crawlPage(siteId, startUrl);

    console.log("");
    console.log("Scan complete.");
    console.log(`scan_run_id: ${summary.scanRunId}`);
    console.log(`total:       ${summary.totalLinks}`);
    console.log(`checked:     ${summary.checkedLinks}`);
    console.log(`broken:      ${summary.brokenLinks}`);
    console.log(`skipped:     ${summary.skippedLinks}`);
  } catch (err) {
    console.error("Scan failed:", err);
    process.exit(1);
  }
}

await main();
