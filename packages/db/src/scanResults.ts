import { ensureConnected } from "./client.js";
import type { LinkClassification } from "./scanRuns.js";

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
