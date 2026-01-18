import { ensureConnected } from "./client";
import type { LinkClassification } from "./scanRuns";

export interface ScanRunHistoryRow {
  id: string;
  site_id: string;
  status: string;
  started_at: Date;
  finished_at: Date | null;
  error_message: string | null;
  updated_at: Date;
  start_url: string;
  total_links: number;
  checked_links: number;
  broken_links: number;
}

export interface ScanLinkMinimalRow {
  link_url: string;
  classification: LinkClassification;
  status_code: number | null;
  error_message: string | null;
  occurrence_count: number;
  last_seen_at: Date;
}

export async function getRecentScanRunsForSite(
  siteId: string,
  limit: number,
): Promise<ScanRunHistoryRow[]> {
  const client = await ensureConnected();
  const res = await client.query<ScanRunHistoryRow>(
    `
      SELECT
        id,
        site_id,
        status,
        started_at,
        finished_at,
        error_message,
        updated_at,
        start_url,
        total_links,
        checked_links,
        broken_links
      FROM scan_runs
      WHERE site_id = $1
      ORDER BY started_at DESC
      LIMIT $2
    `,
    [siteId, limit],
  );
  return res.rows;
}

export async function getRecentScanRunsForSiteForUser(
  userId: string,
  siteId: string,
  limit: number,
): Promise<ScanRunHistoryRow[]> {
  const client = await ensureConnected();
  const res = await client.query<ScanRunHistoryRow>(
    `
      SELECT
        r.id,
        r.site_id,
        r.status,
        r.started_at,
        r.finished_at,
        r.error_message,
        r.updated_at,
        r.start_url,
        r.total_links,
        r.checked_links,
        r.broken_links
      FROM scan_runs r
      JOIN sites s ON s.id = r.site_id
      WHERE r.site_id = $1 AND s.user_id = $2
      ORDER BY r.started_at DESC
      LIMIT $3
    `,
    [siteId, userId, limit],
  );
  return res.rows;
}

export async function getScanLinksForRunMinimal(
  scanRunId: string,
): Promise<ScanLinkMinimalRow[]> {
  const client = await ensureConnected();
  const res = await client.query<ScanLinkMinimalRow>(
    `
      SELECT
        link_url,
        classification,
        status_code,
        error_message,
        occurrence_count,
        last_seen_at
      FROM scan_links
      WHERE scan_run_id = $1 AND ignored = false
      ORDER BY last_seen_at DESC
    `,
    [scanRunId],
  );
  return res.rows;
}

function totalsFor(rows: ScanLinkMinimalRow[]) {
  const base = { broken: 0, blocked: 0, ok: 0, no_response: 0 };
  for (const row of rows) {
    if (row.classification === "broken") base.broken += 1;
    else if (row.classification === "blocked") base.blocked += 1;
    else if (row.classification === "no_response") base.no_response += 1;
    else base.ok += 1;
  }
  return base;
}

export async function getDiffBetweenRuns(runA: string, runB: string) {
  const [rowsA, rowsB] = await Promise.all([
    getScanLinksForRunMinimal(runA),
    getScanLinksForRunMinimal(runB),
  ]);

  const mapA = new Map(rowsA.map((row) => [row.link_url, row]));
  const mapB = new Map(rowsB.map((row) => [row.link_url, row]));

  const added: ScanLinkMinimalRow[] = [];
  const removed: ScanLinkMinimalRow[] = [];
  const changed: Array<{
    before: ScanLinkMinimalRow;
    after: ScanLinkMinimalRow;
  }> = [];
  let unchangedCount = 0;

  for (const [linkUrl, rowA] of mapA.entries()) {
    const rowB = mapB.get(linkUrl);
    if (!rowB) {
      added.push(rowA);
      continue;
    }
    const isChanged =
      rowA.classification !== rowB.classification ||
      rowA.status_code !== rowB.status_code ||
      (rowA.error_message ?? "") !== (rowB.error_message ?? "");
    if (isChanged) {
      changed.push({ before: rowB, after: rowA });
    } else {
      unchangedCount += 1;
    }
  }

  for (const [linkUrl, rowB] of mapB.entries()) {
    if (!mapA.has(linkUrl)) removed.push(rowB);
  }

  return {
    added,
    removed,
    changed,
    unchangedCount,
    totals: {
      a: totalsFor(rowsA),
      b: totalsFor(rowsB),
    },
  };
}

export async function getDiffBetweenRunsForUser(
  userId: string,
  runA: string,
  runB: string,
) {
  const client = await ensureConnected();
  const res = await client.query<{ id: string }>(
    `
      SELECT r.id
      FROM scan_runs r
      JOIN sites s ON s.id = r.site_id
      WHERE s.user_id = $1 AND r.id IN ($2, $3)
    `,
    [userId, runA, runB],
  );
  if (res.rows.length < 2) {
    return null;
  }
  return getDiffBetweenRuns(runA, runB);
}
