import { ensureConnected } from "./client.js";

export type ScanStatus = "in_progress" | "completed" | "failed";

export interface ScanRunRow {
  id: string;
  site_id: string;
  status: ScanStatus;
  started_at: Date;
  finished_at: Date | null;
  start_url: string;
  total_links: number;
  checked_links: number;
  broken_links: number;
}

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

export async function getRecentScansForSite(
  siteId: string,
  limit: number
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
