
import { ensureConnected } from "./client.js";

export type ScanStatus = "in_progress" | "completed" | "failed";


export type LinkClassification = "ok" | "broken" | "blocked";

export interface ScanRunSummary {
  totalLinks: number;
  checkedLinks: number;
  brokenLinks: number;
}

export async function createScanRun(
  siteId: string,
  startUrl: string
): Promise<string> {
  const client = await ensureConnected();

  const res = await client.query<{ id: string }>(
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
): Promise<void> {
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


export async function finishScanRun(
  scanRunId: string,
  status: Exclude<ScanStatus, "in_progress">,
  summary: ScanRunSummary
): Promise<void> {
  return completeScanRun(scanRunId, status, summary);
}
