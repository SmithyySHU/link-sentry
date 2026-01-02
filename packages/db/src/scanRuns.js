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
export async function getLatestScanForSite(siteId) {
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
      LIMIT 1
    `, [siteId]);
    return res.rows[0] ?? null;
}
