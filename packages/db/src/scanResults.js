// packages/db/src/scanResults.ts
import { ensureConnected } from "./client.js";
export async function insertScanResult(params) {
    const client = await ensureConnected();
    const { scanRunId, sourcePage, linkUrl, statusCode, classification, errorMessage, } = params;
    await client.query(`
      INSERT INTO scan_results (
        scan_run_id,
        source_page,
        link_url,
        status_code,
        classification,
        error_message
      )
      VALUES ($1, $2, $3, $4, $5, $6);
    `, [scanRunId, sourcePage, linkUrl, statusCode, classification, errorMessage ?? null]);
}
