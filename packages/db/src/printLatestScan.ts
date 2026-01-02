import { closeConnection, ensureConnected } from "./client.js";
import { getLatestScanForSite } from "./scanRuns.js";
import { getResultsForScan } from "./scanResults.js";

const SITE_ID = "85efa142-35dc-4b06-93ee-fb7180ab28fd"; // your TwiddleFood site id

async function main() {
  await ensureConnected();
  const scan = await getLatestScanForSite(SITE_ID);

  if (!scan) {
    console.log("No scans found for site", SITE_ID);
    await closeConnection();
    return;
  }

  console.log("Latest scan:");
  console.log({
    id: scan.id,
    status: scan.status,
    started_at: scan.started_at,
    finished_at: scan.finished_at,
    start_url: scan.start_url,
    total_links: scan.total_links,
    checked_links: scan.checked_links,
    broken_links: scan.broken_links,
  });

  const results = await getResultsForScan(scan.id);

  console.log(`\nFirst 10 results (${results.length} total):`);
  for (const r of results.slice(0, 10)) {
    const status = r.status_code ?? "";
    console.log(
      `${r.classification.toUpperCase()} ${status} ${r.link_url}`
    );
  }

  await closeConnection();
}

await main();
