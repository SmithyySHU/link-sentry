import { ensureConnected } from "./client.js";
import type { ScanRunRow } from "./scanRuns.js";

export async function getLatestScanForSite(
  siteId: string
): Promise<ScanRunRow | null> {
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
      LIMIT 1
    `,
    [siteId]
  );

  if (res.rowCount === 0) {
    return null;
  }

  return res.rows[0];
}

export async function getScanHistoryForSite(
  siteId: string,
  limit = 20
): Promise<ScanRunRow[]> {
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
      LIMIT $2
    `,
    [siteId, limit]
  );

  return res.rows;
}
