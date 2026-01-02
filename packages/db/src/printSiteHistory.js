import { closeConnection, ensureConnected } from "./client.js";
async function main() {
    const [siteId] = process.argv.slice(2);
    if (!siteId) {
        console.error("Usage: npm run demo:site-history -- <siteId>");
        process.exit(1);
    }
    const client = await ensureConnected();
    const res = await client.query(`
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
      LIMIT 20
    `, [siteId]);
    console.log(`Scans for site ${siteId} (${res.rowCount} total):`);
    if (res.rowCount === 0) {
        await closeConnection();
        return;
    }
    for (const run of res.rows) {
        const started = new Date(run.started_at).toISOString();
        const finished = run.finished_at
            ? new Date(run.finished_at).toISOString()
            : "in-progress";
        const total = run.total_links ?? 0;
        const checked = run.checked_links ?? 0;
        const broken = run.broken_links ?? 0;
        const healthy = checked > 0 ? checked - broken : 0;
        const brokenPct = checked > 0 ? ((broken / checked) * 100).toFixed(1) : "0.0";
        console.log("--------------------------------------------------");
        console.log(`run:      ${run.id}`);
        console.log(`status:   ${run.status}`);
        console.log(`url:      ${run.start_url ?? "?"}`);
        console.log(`started:  ${started}`);
        console.log(`finished: ${finished}`);
        console.log(`links:    total=${total}, checked=${checked}, broken=${broken}, healthy=${healthy} (${brokenPct}% broken)`);
    }
    await closeConnection();
}
await main();
