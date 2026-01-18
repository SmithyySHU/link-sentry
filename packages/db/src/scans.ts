import { ensureConnected } from "./client";

export type ScanStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export interface ScanRunRow {
  id: string;
  site_id: string;
  status: ScanStatus;
  started_at: Date;
  finished_at: Date | null;
  notified_at: Date | null;
  error_message: string | null;
  updated_at: Date;
  start_url: string;
  total_links: number;
  checked_links: number;
  broken_links: number;
}

export async function getLatestScanForSite(
  siteId: string,
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
        notified_at,
        error_message,
        updated_at,
        start_url,
        total_links,
        checked_links,
        broken_links
      FROM scan_runs
      WHERE site_id = $1
      ORDER BY started_at DESC
      LIMIT 1
    `,
    [siteId],
  );

  if (res.rowCount === 0) {
    return null;
  }

  return res.rows[0];
}

export async function getLatestScanForSiteForUser(
  userId: string,
  siteId: string,
): Promise<ScanRunRow | null> {
  const client = await ensureConnected();
  const res = await client.query<ScanRunRow>(
    `
      SELECT
        r.id,
        r.site_id,
        r.status,
        r.started_at,
        r.finished_at,
        r.notified_at,
        r.error_message,
        r.updated_at,
        r.start_url,
        r.total_links,
        r.checked_links,
        r.broken_links
      FROM scan_runs r
      JOIN sites s ON s.id = r.site_id
      WHERE r.site_id = $1 AND s.user_id = $2
      ORDER BY r.started_at DESC
      LIMIT 1
    `,
    [siteId, userId],
  );

  if (res.rowCount === 0) {
    return null;
  }

  return res.rows[0];
}

export async function getRecentScansForSite(
  siteId: string,
  limit: number,
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
        notified_at,
        error_message,
        updated_at,
        start_url,
        total_links,
        checked_links,
        broken_links
      FROM scan_runs
      WHERE site_id = $1
      ORDER BY started_at DESC
      LIMIT $2
    `,
    [siteId, limit],
  );

  return res.rows;
}

export async function getRecentScansForSiteForUser(
  userId: string,
  siteId: string,
  limit: number,
): Promise<ScanRunRow[]> {
  const client = await ensureConnected();

  const res = await client.query<ScanRunRow>(
    `
      SELECT
        r.id,
        r.site_id,
        r.status,
        r.started_at,
        r.finished_at,
        r.notified_at,
        r.error_message,
        r.updated_at,
        r.start_url,
        r.total_links,
        r.checked_links,
        r.broken_links
      FROM scan_runs r
      JOIN sites s ON s.id = r.site_id
      WHERE r.site_id = $1 AND s.user_id = $2
      ORDER BY r.started_at DESC
      LIMIT $3
    `,
    [siteId, userId, limit],
  );

  return res.rows;
}

export async function getScanRunById(
  scanRunId: string,
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
        notified_at,
        error_message,
        updated_at,
        start_url,
        total_links,
        checked_links,
        broken_links
      FROM scan_runs
      WHERE id = $1
      LIMIT 1
    `,
    [scanRunId],
  );

  return res.rows[0] ?? null;
}

export async function getScanRunByIdForUser(
  userId: string,
  scanRunId: string,
): Promise<ScanRunRow | null> {
  const client = await ensureConnected();

  const res = await client.query<ScanRunRow>(
    `
      SELECT
        r.id,
        r.site_id,
        r.status,
        r.started_at,
        r.finished_at,
        r.notified_at,
        r.error_message,
        r.updated_at,
        r.start_url,
        r.total_links,
        r.checked_links,
        r.broken_links
      FROM scan_runs r
      JOIN sites s ON s.id = r.site_id
      WHERE r.id = $1 AND s.user_id = $2
      LIMIT 1
    `,
    [scanRunId, userId],
  );

  return res.rows[0] ?? null;
}

export async function setScanRunNotified(scanRunId: string): Promise<void> {
  const client = await ensureConnected();
  await client.query(
    `
      UPDATE scan_runs
      SET notified_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `,
    [scanRunId],
  );
}
