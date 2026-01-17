import { ensureConnected } from "./client.js";

export type ScanJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ScanJobRow = {
  id: string;
  scan_run_id: string;
  site_id: string;
  status: ScanJobStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  locked_at: Date | null;
  locked_by: string | null;
  available_at: Date;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};

export async function enqueueScanJob(params: {
  scanRunId: string;
  siteId: string;
  priority?: number;
}): Promise<string> {
  const client = await ensureConnected();
  const priority = params.priority ?? 0;
  const res = await client.query<{ id: string }>(
    `
      INSERT INTO scan_jobs (scan_run_id, site_id, status, priority)
      VALUES ($1, $2, 'queued', $3)
      RETURNING id
    `,
    [params.scanRunId, params.siteId, priority],
  );
  return res.rows[0].id;
}

export async function claimNextScanJob(params: {
  workerId: string;
}): Promise<ScanJobRow | null> {
  const client = await ensureConnected();
  await client.query("BEGIN");
  try {
    const res = await client.query<ScanJobRow>(
      `
        SELECT *
        FROM scan_jobs
        WHERE status = 'queued'
          AND available_at <= NOW()
        ORDER BY priority DESC, available_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `,
    );

    const job = res.rows[0];
    if (!job) {
      await client.query("COMMIT");
      return null;
    }

    const updated = await client.query<ScanJobRow>(
      `
        UPDATE scan_jobs
        SET status = 'running',
            locked_at = NOW(),
            locked_by = $2,
            attempts = attempts + 1,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [job.id, params.workerId],
    );

    await client.query("COMMIT");
    return updated.rows[0] ?? null;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

export async function completeScanJob(jobId: string): Promise<void> {
  const client = await ensureConnected();
  await client.query(
    `
      UPDATE scan_jobs
      SET status = 'completed',
          updated_at = NOW()
      WHERE id = $1
    `,
    [jobId],
  );
}

export async function failScanJob(jobId: string, error: string): Promise<void> {
  const client = await ensureConnected();
  await client.query(
    `
      UPDATE scan_jobs
      SET status = CASE
            WHEN attempts < max_attempts THEN 'queued'
            ELSE 'failed'
          END,
          available_at = CASE
            WHEN attempts < max_attempts THEN NOW() + (INTERVAL '30 seconds' * attempts)
            ELSE available_at
          END,
          last_error = $2,
          updated_at = NOW()
      WHERE id = $1
    `,
    [jobId, error],
  );
}

export async function cancelScanJob(jobId: string): Promise<void> {
  const client = await ensureConnected();
  await client.query(
    `
      UPDATE scan_jobs
      SET status = 'cancelled',
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
