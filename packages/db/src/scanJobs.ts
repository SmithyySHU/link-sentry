import { ensureConnected } from "./client.js";

export type ScanJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ScanJobRow = {
  id: string;
  scan_run_id: string | null;
  site_id: string;
  status: ScanJobStatus;
  attempts: number;
  max_attempts: number;
  locked_at: Date | null;
  lock_expires_at: Date | null;
  run_at: Date;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};

export async function enqueueScanJob(params: {
  scanRunId?: string | null;
  siteId: string;
  runAt?: Date;
}): Promise<string> {
  const client = await ensureConnected();
  const res = await client.query<{ id: string }>(
    `
      INSERT INTO scan_jobs (scan_run_id, site_id, status, run_at)
      VALUES ($1, $2, 'queued', COALESCE($3, NOW()))
      RETURNING id
    `,
    [params.scanRunId ?? null, params.siteId, params.runAt ?? null],
  );
  return res.rows[0].id;
}

export async function claimNextScanJob(params: {
  workerId: string;
  leaseSeconds: number;
}): Promise<ScanJobRow | null> {
  const client = await ensureConnected();
  const res = await client.query<ScanJobRow>(
    `
      WITH next_job AS (
        SELECT id
        FROM scan_jobs
        WHERE status = 'queued'
          AND run_at <= NOW()
          AND NOT EXISTS (
            SELECT 1
            FROM scan_jobs active_jobs
            WHERE active_jobs.site_id = scan_jobs.site_id
              AND active_jobs.status = 'running'
              AND (
                active_jobs.lock_expires_at IS NULL
                OR active_jobs.lock_expires_at > NOW()
              )
          )
        ORDER BY run_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE scan_jobs
      SET status = 'running',
          locked_at = NOW(),
          lock_expires_at = NOW() + ($1 * INTERVAL '1 second'),
          attempts = attempts + 1,
          updated_at = NOW()
      WHERE id = (SELECT id FROM next_job)
      RETURNING *
    `,
    [params.leaseSeconds],
  );
  return res.rows[0] ?? null;
}

export async function completeScanJob(
  jobId: string,
): Promise<ScanJobRow | null> {
  const client = await ensureConnected();
  const res = await client.query<ScanJobRow>(
    `
      UPDATE scan_jobs
      SET status = 'completed',
          locked_at = NULL,
          lock_expires_at = NULL,
          last_error = NULL,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [jobId],
  );
  return res.rows[0] ?? null;
}

export async function failScanJob(
  jobId: string,
  error: string,
): Promise<ScanJobRow | null> {
  const client = await ensureConnected();
  const res = await client.query<ScanJobRow>(
    `
      UPDATE scan_jobs
      SET status = CASE
            WHEN attempts < max_attempts THEN 'queued'
            ELSE 'failed'
          END,
          run_at = CASE
            WHEN attempts < max_attempts THEN NOW() + CASE attempts
              WHEN 1 THEN INTERVAL '30 seconds'
              WHEN 2 THEN INTERVAL '2 minutes'
              ELSE INTERVAL '10 minutes'
            END
            ELSE run_at
          END,
          locked_at = NULL,
          lock_expires_at = NULL,
          last_error = $2,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [jobId, error],
  );
  return res.rows[0] ?? null;
}

export async function cancelScanJob(jobId: string): Promise<void> {
  const client = await ensureConnected();
  await client.query(
    `
      UPDATE scan_jobs
      SET status = 'cancelled',
          locked_at = NULL,
          lock_expires_at = NULL,
          updated_at = NOW()
      WHERE id = $1 AND status <> 'completed'
    `,
    [jobId],
  );
}

export async function getJobForScanRun(
  scanRunId: string,
): Promise<ScanJobRow | null> {
  const client = await ensureConnected();
  const res = await client.query<ScanJobRow>(
    `
      SELECT *
      FROM scan_jobs
      WHERE scan_run_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [scanRunId],
  );
  return res.rows[0] ?? null;
}

export async function setScanJobRunId(
  jobId: string,
  scanRunId: string,
): Promise<void> {
  const client = await ensureConnected();
  await client.query(
    `
      UPDATE scan_jobs
      SET scan_run_id = $2,
          updated_at = NOW()
      WHERE id = $1
    `,
    [jobId, scanRunId],
  );
}

export async function requeueExpiredScanJobs(): Promise<ScanJobRow[]> {
  const client = await ensureConnected();
  const res = await client.query<ScanJobRow>(
    `
      UPDATE scan_jobs
      SET status = 'queued',
          run_at = NOW(),
          locked_at = NULL,
          lock_expires_at = NULL,
          last_error = CASE
            WHEN last_error IS NULL THEN 'lock_expired_requeued'
            ELSE last_error || E'\\nlock_expired_requeued'
          END,
          updated_at = NOW()
      WHERE status = 'running'
        AND lock_expires_at IS NOT NULL
        AND lock_expires_at < NOW()
      RETURNING *
    `,
  );
  return res.rows;
}

export async function hasActiveJobForSite(siteId: string): Promise<boolean> {
  const client = await ensureConnected();
  const res = await client.query(
    `
      SELECT 1
      FROM scan_jobs
      WHERE site_id = $1
        AND status IN ('queued', 'running')
        AND (
          status <> 'running'
          OR lock_expires_at IS NULL
          OR lock_expires_at > NOW()
        )
      LIMIT 1
    `,
    [siteId],
  );
  return (res.rowCount ?? 0) > 0;
}
