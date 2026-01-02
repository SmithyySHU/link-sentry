import { ensureConnected } from "./client.js";
import type { LinkClassification } from "./scanRuns.js";

export interface InsertScanResultArgs {
  scanRunId: string;
  sourcePage: string;
  linkUrl: string;
  statusCode: number | null;
  classification: LinkClassification;
  errorMessage?: string;
}

export interface ScanResultRow {
  id: string;
  scan_run_id: string;
  source_page: string;
  link_url: string;
  status_code: number | null;
  classification: LinkClassification;
  error_message: string | null;
  created_at: Date;
}

export async function insertScanResult(args: InsertScanResultArgs): Promise<void> {
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

export async function getResultsForScan(
  scanRunId: string
): Promise<ScanResultRow[]> {
  const client = await ensureConnected();

  const res = await client.query<ScanResultRow>(
    `
      SELECT
        id,
        scan_run_id,
        source_page,
        link_url,
        status_code,
        classification,
        error_message,
        created_at
      FROM scan_results
      WHERE scan_run_id = $1
      ORDER BY created_at
    `,
    [scanRunId]
  );

  return res.rows;
}
