import { ensureConnected } from "./client";
import { emitScanEvent } from "./events";

export type ScanStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";
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
  notified_at: Date | null;
  error_message: string | null;
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

type ScanRunEventRow = ScanRunRow & {
  user_id: string;
  updated_at: Date;
  error_message: string | null;
  finished_at: Date | null;
};

function toIso(value: Date | null) {
  return value ? value.toISOString() : null;
}

async function emitScanEventForRow(
  row: ScanRunEventRow,
  type: "scan_started" | "scan_progress" | "scan_completed" | "scan_failed",
) {
  await emitScanEvent({
    type,
    user_id: row.user_id,
    site_id: row.site_id,
    scan_run_id: row.id,
    status: row.status,
    started_at: toIso(row.started_at),
    finished_at: toIso(row.finished_at),
    updated_at: toIso(row.updated_at),
    start_url: row.start_url,
    total_links: row.total_links,
    checked_links: row.checked_links,
    broken_links: row.broken_links,
    error_message: row.error_message,
  });
}

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

  const res = await db.query<ScanRunEventRow>(
    `
      UPDATE scan_runs r
      SET
        total_links   = COALESCE($2::int, r.total_links),
        checked_links = COALESCE($3::int, r.checked_links),
        broken_links  = COALESCE($4::int, r.broken_links),
        updated_at = NOW()
      FROM sites s
      WHERE r.id = $1 AND s.id = r.site_id
      RETURNING
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
        r.broken_links,
        s.user_id
    `,
    [scanRunId, totalLinks, checkedLinks, brokenLinks],
  );
  const row = res.rows[0];
  if (row) {
    await emitScanEventForRow(row, "scan_progress");
  }
}

export async function createScanRun(
  siteId: string,
  startUrl: string,
): Promise<string> {
  const client = await ensureConnected();
  const res = await client.query<ScanRunEventRow>(
    `
      WITH inserted AS (
        INSERT INTO scan_runs (site_id, start_url, status)
        VALUES ($1, $2, 'queued')
        RETURNING
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
      )
      SELECT inserted.*, s.user_id
      FROM inserted
      JOIN sites s ON s.id = inserted.site_id
    `,
    [siteId, startUrl],
  );
  const row = res.rows[0];
  if (row) {
    await emitScanEventForRow(row, "scan_started");
    return row.id;
  }
  throw new Error("scan_run_create_failed");
}

export async function completeScanRun(
  scanRunId: string,
  status: Exclude<ScanStatus, "in_progress" | "queued">,
  summary: ScanRunSummary,
): Promise<void> {
  const client = await ensureConnected();
  const { totalLinks, checkedLinks, brokenLinks } = summary;

  const res = await client.query<ScanRunEventRow>(
    `
      UPDATE scan_runs r
      SET status = $2,
          finished_at = NOW(),
          updated_at = NOW(),
          error_message = NULL,
          total_links = $3,
          checked_links = $4,
          broken_links = $5
      FROM sites s
      WHERE r.id = $1 AND s.id = r.site_id
      RETURNING
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
        r.broken_links,
        s.user_id
    `,
    [scanRunId, status, totalLinks, checkedLinks, brokenLinks],
  );
  const row = res.rows[0];
  if (row) {
    await emitScanEventForRow(
      row,
      status === "completed" ? "scan_completed" : "scan_failed",
    );
  }
}

export async function cancelScanRun(scanRunId: string): Promise<void> {
  const client = await ensureConnected();
  const res = await client.query<ScanRunEventRow>(
    `
      UPDATE scan_runs r
      SET status = 'cancelled',
          finished_at = COALESCE(r.finished_at, NOW()),
          updated_at = NOW()
      FROM sites s
      WHERE r.id = $1 AND s.id = r.site_id AND r.status IN ('queued', 'in_progress')
      RETURNING
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
        r.broken_links,
        s.user_id
    `,
    [scanRunId],
  );
  const row = res.rows[0];
  if (row) {
    await emitScanEventForRow(row, "scan_failed");
  }
}

export async function setScanRunStatus(
  scanRunId: string,
  status: ScanStatus,
  options?: {
    errorMessage?: string | null;
    setFinishedAt?: boolean;
    clearFinishedAt?: boolean;
  },
): Promise<void> {
  const client = await ensureConnected();
  const errorMessage =
    typeof options?.errorMessage === "string" ? options.errorMessage : null;
  const setFinishedAt = options?.setFinishedAt ?? false;
  const clearFinishedAt = options?.clearFinishedAt ?? false;
  const res = await client.query<ScanRunEventRow>(
    `
      UPDATE scan_runs r
      SET status = $2,
          error_message = $3,
          finished_at = CASE
            WHEN $4 THEN NOW()
            WHEN $5 THEN NULL
            ELSE r.finished_at
          END,
          started_at = CASE
            WHEN $2 = 'in_progress' THEN COALESCE(r.started_at, NOW())
            ELSE r.started_at
          END,
          updated_at = NOW()
      FROM sites s
      WHERE r.id = $1 AND s.id = r.site_id
      RETURNING
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
        r.broken_links,
        s.user_id
    `,
    [scanRunId, status, errorMessage, setFinishedAt, clearFinishedAt],
  );
  const row = res.rows[0];
  if (!row) return;
  if (status === "in_progress") {
    await emitScanEventForRow(row, "scan_started");
    return;
  }
  if (status === "completed") {
    await emitScanEventForRow(row, "scan_completed");
    return;
  }
  if (status === "failed" || status === "cancelled") {
    await emitScanEventForRow(row, "scan_failed");
  }
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
  return res.rows[0] ?? null;
}
