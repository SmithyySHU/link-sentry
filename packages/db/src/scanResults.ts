import { ensureConnected } from "./client.js";
import type { LinkClassification } from "./scanRuns.js";

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

export interface PaginatedResults {
  results: ScanResultRow[];
  countReturned: number;
  totalMatching: number;
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

export async function getResultsForScanRun(
  scanRunId: string,
  options?: { limit?: number; offset?: number; classification?: LinkClassification }
): Promise<PaginatedResults> {
  const client = await ensureConnected();

  const limit = options?.limit ?? 200;
  const offset = options?.offset ?? 0;
  const classification = options?.classification;

  // Build WHERE clause
  let whereClause = "WHERE scan_run_id = $1";
  const params: Array<string | number> = [scanRunId];
  
  if (classification) {
    whereClause += " AND classification = $2";
    params.push(classification);
  }

  // Get total count
  const countRes = await client.query<{ count: string }>(
    `
      SELECT COUNT(*) as count
      FROM scan_results
      ${whereClause}
    `,
    params
  );

  const totalMatching = Number(countRes.rows[0]?.count ?? 0);

  // Get paginated results
  const paramIndex = params.length + 1;
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
      ${whereClause}
      ORDER BY
        (classification <> 'ok') DESC,
        created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `,
    [...params, limit, offset]
  );

  return {
    results: res.rows,
    countReturned: res.rows.length,
    totalMatching,
  };
}
export interface ResultsSummary {
  classification: LinkClassification;
  status_code: number | null;
  count: number;
}

export async function getResultsSummaryForScanRun(
  scanRunId: string
): Promise<ResultsSummary[]> {
  const client = await ensureConnected();

  const res = await client.query<ResultsSummary>(
    `
      SELECT
        classification,
        status_code,
        COUNT(*) as count
      FROM scan_results
      WHERE scan_run_id = $1
      GROUP BY classification, status_code
      ORDER BY classification, status_code
    `,
    [scanRunId]
  );

  return res.rows.map((row) => ({
    ...row,
    count: Number(row.count),
  }));
}
