import { ensureConnected } from "./client.js";
export async function createScanRun(siteId, startUrl) {
    const client = await ensureConnected();
    const res = await client.query(`
    INSERT INTO scan_runs (site_id, start_url, status)
    VALUES ($1, $2, 'in_progress')
    RETURNING id
  `, [siteId, startUrl]);
    return res.rows[0].id;
}
export async function completeScanRun(scanRunId, status, summary) {
    const client = await ensureConnected();
    const { totalLinks, checkedLinks, brokenLinks } = summary;
    await client.query(`
    UPDATE scan_runs
    SET status = $2,
        finished_at = NOW(),
        total_links = $3,
        checked_links = $4,
        broken_links = $5
    WHERE id = $1
  `, [scanRunId, status, totalLinks, checkedLinks, brokenLinks]);
}
export async function finishScanRun(scanRunId, status, summary) {
    return completeScanRun(scanRunId, status, summary);
}
