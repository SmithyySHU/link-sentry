import { ensureConnected, closeConnection } from "./client";
import type { ScanRunRow } from "./scanRuns";

async function main(): Promise<void> {
  const [siteId] = process.argv.slice(2);

  if (!siteId) {
    console.error("Usage: npm run demo:site-history -- <siteId>");
    process.exit(1);
  }

  const client = await ensureConnected();

  const res = await client.query<ScanRunRow>(
    `
      SELECT
        id,
        site_id,
        status,
        started_at,
        finished_at,
        start_url,
        total_links,
        checked_links,
        broken_links
      FROM scan_runs
      WHERE site_id = $1
      ORDER BY started_at DESC
    `,
    [siteId],
  );

  if (res.rowCount === 0) {
    console.log("No scans found for site", siteId);
    await closeConnection();
    return;
  }

  console.log(`Scans for site ${siteId} (${res.rowCount} total):`);

  for (const run of res.rows) {
    const healthy = run.checked_links - run.broken_links;
    const brokenPct =
      run.checked_links > 0 ? (run.broken_links / run.checked_links) * 100 : 0;

    console.log("--------------------------------------------------");
    console.log(`run:      ${run.id}`);
    console.log(`status:   ${run.status}`);
    console.log(`url:      ${run.start_url}`);
    console.log(`started:  ${run.started_at.toISOString()}`);
    console.log(
      `finished: ${run.finished_at ? run.finished_at.toISOString() : "in-progress"}`,
    );
    console.log(
      `links:    total=${run.total_links}, checked=${run.checked_links}, broken=${run.broken_links}, healthy=${healthy} (${brokenPct.toFixed(
        1,
      )}% broken)`,
    );
  }

  await closeConnection();
}

await main();
