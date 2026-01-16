import { ensureConnected } from "./client.js";

export type ScanStatus = "in_progress" | "completed" | "failed";
export type LinkClassification = "ok" | "broken" | "blocked";

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
  fields: ScanRunProgressFields
) {
  const db = await ensureConnected();

  const totalLinks = typeof fields.totalLinks === "number" ? fields.totalLinks : null;
  const checkedLinks = typeof fields.checkedLinks === "number" ? fields.checkedLinks : null;
  const brokenLinks = typeof fields.brokenLinks === "number" ? fields.brokenLinks : null;

  await db.query(
    `
    UPDATE scan_runs
    SET
      total_links   = COALESCE($2::int, total_links),
      checked_links = COALESCE($3::int, checked_links),
      broken_links  = COALESCE($4::int, broken_links)
    WHERE id = $1
    `,
    [scanRunId, totalLinks, checkedLinks, brokenLinks]
  );
}

export async function createScanRun(siteId: string, startUrl: string) {
  const client = await ensureConnected();
  const res = await client.query(
    `
    INSERT INTO scan_runs (site_id, start_url, status)
    VALUES ($1, $2, 'in_progress')
    RETURNING id
    `,
    [siteId, startUrl]
  );
  return res.rows[0].id;
}

export async function completeScanRun(
  scanRunId: string,
  status: Exclude<ScanStatus, "in_progress">,
  summary: ScanRunSummary
) {
  const client = await ensureConnected();
  const { totalLinks, checkedLinks, brokenLinks } = summary;

  await client.query(
    `
    UPDATE scan_runs
    SET status = $2,
        finished_at = NOW(),
        total_links = $3,
        checked_links = $4,
        broken_links = $5
    WHERE id = $1
    `,
    [scanRunId, status, totalLinks, checkedLinks, brokenLinks]
  );
}

export async function getLatestScanForSite(siteId: string) {
  const client = await ensureConnected();
  const res = await client.query(
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
  return res.rows[0] ?? null;
}
