import { ensureConnected } from "./client.js";
export async function insertScanResult(args) {
    const client = await ensureConnected();
    const { scanRunId, sourcePage, linkUrl, statusCode, classification, errorMessage, } = args;
    await client.query(`
      INSERT INTO scan_results (
        scan_run_id,
        source_page,
        link_url,
        status_code,
        classification,
        error_message
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
        scanRunId,
        sourcePage,
        linkUrl,
        statusCode,
        classification,
        errorMessage ?? null,
    ]);
}
export async function getResultsForScan(scanRunId) {
    const client = await ensureConnected();
    const res = await client.query(`
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
    `, [scanRunId]);
    return res.rows;
}
