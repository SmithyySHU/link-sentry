import { ensureConnected } from "./client.js";

export type ScanStatus = "in_progress" | "completed" | "failed" | "cancelled";
export type LinkClassification = "ok" | "broken" | "blocked" | "no_response";

export interface ScanRunSummary {
  totalLinks: number;
  checkedLinks: number;
  brokenLinks: number;
}

export interface ScanRunRow {
  id: string;
  site_id: string;
  status: ScanStatus;
  started_at: Date;
  finished_at: Date | null;
  updated_at: Date;
  start_url: string;
  total_links: number;
  checked_links: number;
  broken_links: number;
}

type ScanRunProgressFields = {
  totalLinks?: number;
  checkedLinks?: number;
  brokenLinks?: number;
};

export async function updateScanRunProgress(
  scanRunId: string,
  fields: ScanRunProgressFields,
): Promise<void> {
  const db = await ensureConnected();

  const totalLinks =
    typeof fields.totalLinks === "number" ? fields.totalLinks : null;
  const checkedLinks =
    typeof fields.checkedLinks === "number" ? fields.checkedLinks : null;
  const brokenLinks =
    typeof fields.brokenLinks === "number" ? fields.brokenLinks : null;

  await db.query(
    `
    UPDATE scan_runs
    SET
      total_links   = COALESCE($2::int, total_links),
      checked_links = COALESCE($3::int, checked_links),
      broken_links  = COALESCE($4::int, broken_links),
      updated_at = NOW()
    WHERE id = $1
    `,
    [scanRunId, totalLinks, checkedLinks, brokenLinks],
  );
}

export async function createScanRun(
  siteId: string,
  startUrl: string,
): Promise<string> {
  const client = await ensureConnected();
  const res = await client.query(
    `
    INSERT INTO scan_runs (site_id, start_url, status)
    VALUES ($1, $2, 'in_progress')
    RETURNING id
    `,
    [siteId, startUrl],
  );
  return res.rows[0].id;
}

export async function completeScanRun(
  scanRunId: string,
  status: Exclude<ScanStatus, "in_progress">,
  summary: ScanRunSummary,
): Promise<void> {
  const client = await ensureConnected();
  const { totalLinks, checkedLinks, brokenLinks } = summary;

  await client.query(
    `
    UPDATE scan_runs
    SET status = $2,
        finished_at = NOW(),
        updated_at = NOW(),
        total_links = $3,
        checked_links = $4,
        broken_links = $5
    WHERE id = $1
    `,
    [scanRunId, status, totalLinks, checkedLinks, brokenLinks],
  );
}

export async function cancelScanRun(scanRunId: string): Promise<void> {
  const client = await ensureConnected();
  await client.query(
    `
      UPDATE scan_runs
      SET status = 'cancelled',
          finished_at = COALESCE(finished_at, NOW()),
          updated_at = NOW()
      WHERE id = $1 AND status = 'in_progress'
    `,
    [scanRunId],
  );
}

export async function getScanRunStatus(
  scanRunId: string,
): Promise<{ status: ScanStatus } | null> {
  const client = await ensureConnected();
  const res = await client.query<{ status: ScanStatus }>(
    `SELECT status FROM scan_runs WHERE id = $1`,
    [scanRunId],
  );
  return res.rows[0] ?? null;
}

export async function touchScanRun(scanRunId: string): Promise<void> {
  const client = await ensureConnected();
  await client.query(`UPDATE scan_runs SET updated_at = NOW() WHERE id = $1`, [
    scanRunId,
  ]);
}

export async function getLatestScanForSite(
  siteId: string,
): Promise<ScanRunRow | null> {
  const client = await ensureConnected();
  const res = await client.query(
    `
    SELECT
      id,
      site_id,
      status,
      started_at,
      finished_at,
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
  return res.rows[0] ?? null;
}
