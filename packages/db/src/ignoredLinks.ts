import { ensureConnected } from "./client.js";

export interface IgnoredLinkRow {
  id: string;
  scan_run_id: string;
  link_url: string;
  rule_id: string | null;
  rule_type: string | null;
  rule_pattern: string | null;
  status_code: number | null;
  error_message: string | null;
  occurrence_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
  created_at: Date;
}

export interface IgnoredOccurrenceRow {
  id: string;
  scan_ignored_link_id: string;
  scan_run_id: string;
  link_url: string;
  source_page: string;
  created_at: Date;
}

export async function upsertIgnoredLink(args: {
  scanRunId: string;
  linkUrl: string;
  ruleId: string | null;
  statusCode: number | null;
  errorMessage?: string;
}): Promise<IgnoredLinkRow> {
  const client = await ensureConnected();
  const res = await client.query<IgnoredLinkRow>(
    `
      INSERT INTO scan_ignored_links (
        scan_run_id,
        link_url,
        rule_id,
        status_code,
        error_message,
        occurrence_count
      )
      VALUES ($1, $2, $3, $4, $5, 1)
      ON CONFLICT (scan_run_id, link_url)
      DO UPDATE SET
        occurrence_count = scan_ignored_links.occurrence_count + 1,
        last_seen_at = NOW()
      RETURNING *
    `,
    [args.scanRunId, args.linkUrl, args.ruleId, args.statusCode, args.errorMessage ?? null]
  );
  return res.rows[0];
}

export async function insertIgnoredOccurrence(args: {
  scanIgnoredLinkId: string;
  scanRunId: string;
  linkUrl: string;
  sourcePage: string;
}): Promise<IgnoredOccurrenceRow> {
  const client = await ensureConnected();
  const res = await client.query<IgnoredOccurrenceRow>(
    `
      INSERT INTO scan_ignored_occurrences (
        scan_ignored_link_id,
        scan_run_id,
        link_url,
        source_page
      )
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
    [args.scanIgnoredLinkId, args.scanRunId, args.linkUrl, args.sourcePage]
  );
  return res.rows[0];
}

export async function listIgnoredLinksForRun(scanRunId: string, limit: number, offset: number) {
  const client = await ensureConnected();
  const countRes = await client.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM scan_ignored_links WHERE scan_run_id = $1`,
    [scanRunId]
  );
  const totalMatching = Number(countRes.rows[0]?.count ?? 0);

  const res = await client.query<IgnoredLinkRow>(
    `
      SELECT
        sil.*,
        ir.rule_type as rule_type,
        ir.pattern as rule_pattern
      FROM scan_ignored_links sil
      LEFT JOIN ignore_rules ir ON ir.id = sil.rule_id
      WHERE sil.scan_run_id = $1
      ORDER BY sil.last_seen_at DESC
      LIMIT $2 OFFSET $3
    `,
    [scanRunId, limit, offset]
  );

  return {
    links: res.rows,
    countReturned: res.rows.length,
    totalMatching,
  };
}

export async function listIgnoredOccurrences(
  ignoredLinkId: string,
  limit: number,
  offset: number
) {
  const client = await ensureConnected();
  const countRes = await client.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM scan_ignored_occurrences WHERE scan_ignored_link_id = $1`,
    [ignoredLinkId]
  );
  const totalMatching = Number(countRes.rows[0]?.count ?? 0);

  const res = await client.query<IgnoredOccurrenceRow>(
    `
      SELECT *
      FROM scan_ignored_occurrences
      WHERE scan_ignored_link_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `,
    [ignoredLinkId, limit, offset]
  );

  return {
    occurrences: res.rows,
    countReturned: res.rows.length,
    totalMatching,
  };
}
