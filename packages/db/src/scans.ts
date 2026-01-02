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

export async function insertScanResult(args: {
  scanRunId: string;
  sourcePage: string;
  linkUrl: string;
  statusCode: number | null;
  classification: LinkClassification;
  errorMessage?: string;
}): Promise<void> {
  const client = await ensureConnected();
  const {
    scanRunId,
    sourcePage,
    linkUrl,
    statusCode,
    classification,
    errorMessage,
  } = args;

  await client.query(
    `
    INSERT INTO scan_results (
      scan_run_id,
      source_page,
      link_url,
      status_code,
      classification,
      error_message
    )
    VALUES ($1, $2, $3, $4, $5, $6)
  `,
    [
      scanRunId,
      sourcePage,
      linkUrl,
      statusCode,
      classification,
      errorMessage ?? null,
    ]
  );
}
