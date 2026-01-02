import { runScanForSite } from "./scanService.js";

async function main(): Promise<void> {
  const [siteId, startUrl] = process.argv.slice(2);

  if (!siteId || !startUrl) {
    console.error("Usage: npm run scan:once -- <siteId> <startUrl>");
    process.exit(1);
  }

  console.log(`Starting scan for site ${siteId}`);
  console.log(`Start URL: ${startUrl}`);

  const summary = await runScanForSite(siteId, startUrl);

  console.log("Scan completed.");
  console.log(
    `Run: ${summary.scanRunId}, total=${summary.totalLinks}, checked=${summary.checkedLinks}, broken=${summary.brokenLinks}`
  );
}

await main();
