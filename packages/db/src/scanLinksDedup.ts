import { ensureConnected } from "./client";
import type { LinkClassification } from "./scanRuns";

async function isScanRunOwnedByUser(
  userId: string,
  scanRunId: string,
): Promise<boolean> {
  const client = await ensureConnected();
  const res = await client.query(
    `
      SELECT 1
      FROM scan_runs r
      JOIN sites s ON s.id = r.site_id
      WHERE r.id = $1 AND s.user_id = $2
      LIMIT 1
    `,
    [scanRunId, userId],
  );
  return (res.rowCount ?? 0) > 0;
}

async function getScanLinkOwnership(
  userId: string,
  scanLinkId: string,
): Promise<{ scanRunId: string } | null> {
  const client = await ensureConnected();
  const res = await client.query<{ scan_run_id: string }>(
    `
      SELECT l.scan_run_id
      FROM scan_links l
      JOIN scan_runs r ON r.id = l.scan_run_id
      JOIN sites s ON s.id = r.site_id
      WHERE l.id = $1 AND s.user_id = $2
      LIMIT 1
    `,
    [scanLinkId, userId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { scanRunId: row.scan_run_id };
}

/**
 * Represents a unique link found in a scan run.
 * Multiple occurrences of the same URL are deduplicated here.
 */
export interface ScanLink {
  id: string;
  scan_run_id: string;
  link_url: string;
  classification: LinkClassification;
  status_code: number | null;
  error_message: string | null;
  ignored: boolean;
  ignored_by_rule_id: string | null;
  ignored_at: Date | null;
  ignore_reason: string | null;
  ignored_source: "none" | "manual" | "rule";
  first_seen_at: Date;
  last_seen_at: Date;
  occurrence_count: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Represents a single occurrence of a link on a specific source page.
 * Used to show where a broken/blocked link appears on the site.
 */
export interface ScanLinkOccurrence {
  id: string;
  scan_link_id: string;
  scan_run_id: string;
  link_url: string;
  source_page: string;
  created_at: Date;
}

export interface ScanLinkOccurrenceRow extends ScanLinkOccurrence {}

export interface PaginatedOccurrences {
  scanLinkId: string;
  countReturned: number;
  totalMatching: number;
  occurrences: ScanLinkOccurrenceRow[];
}

export type ExportClassification = LinkClassification | "all" | "timeout";

export interface ScanLinkExportRow {
  link_url: string;
  classification: LinkClassification;
  status_code: number | null;
  error_message: string | null;
  occurrence_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
}

/**
 * Insert or update a scan link (upsert pattern).
 * If the link already exists for this scan run, increment the occurrence count.
 */
export async function upsertScanLink(args: {
  scanRunId: string;
  linkUrl: string;
  classification: LinkClassification;
  statusCode: number | null;
  errorMessage?: string;
}): Promise<ScanLink> {
  const client = await ensureConnected();

  const { scanRunId, linkUrl, classification, statusCode, errorMessage } = args;

  const res = await client.query<ScanLink>(
    `
    INSERT INTO scan_links (
      scan_run_id,
      link_url,
      classification,
      status_code,
      error_message,
      occurrence_count
    )
    VALUES ($1, $2, $3, $4, $5, 1)
    ON CONFLICT (scan_run_id, link_url)
    DO UPDATE SET
      occurrence_count = scan_links.occurrence_count + 1,
      last_seen_at = NOW(),
      updated_at = NOW()
    RETURNING *
  `,
    [scanRunId, linkUrl, classification, statusCode, errorMessage ?? null],
  );

  return res.rows[0];
}

/**
 * Insert a scan link occurrence (the specific page where the link appeared).
 */
export async function insertScanLinkOccurrence(args: {
  scanLinkId: string;
  scanRunId: string;
  linkUrl: string;
  sourcePage: string;
}): Promise<ScanLinkOccurrence> {
  const client = await ensureConnected();

  const { scanLinkId, scanRunId, linkUrl, sourcePage } = args;

  const res = await client.query<ScanLinkOccurrence>(
    `
    INSERT INTO scan_link_occurrences (
      scan_link_id,
      scan_run_id,
      link_url,
      source_page
    )
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `,
    [scanLinkId, scanRunId, linkUrl, sourcePage],
  );

  return res.rows[0];
}

/**
 * Get unique links for a scan run with optional pagination and classification filter.
 * Returns deduplicated results.
 */
export async function getScanLinksForRun(
  scanRunId: string,
  options?: {
    limit?: number;
    offset?: number;
    classification?: LinkClassification;
    statusGroup?: "all" | "no_response" | "http_error";
    includeIgnored?: boolean;
  },
): Promise<{
  links: ScanLink[];
  countReturned: number;
  totalMatching: number;
}> {
  const client = await ensureConnected();

  const limit = options?.limit ?? 200;
  const offset = options?.offset ?? 0;
  const classification = options?.classification;
  const statusGroup = options?.statusGroup ?? "all";
  const includeIgnored = options?.includeIgnored ?? false;

  // Build WHERE clause
  let whereClause = "WHERE scan_run_id = $1";
  const params: Array<string | LinkClassification | number> = [scanRunId];

  if (classification) {
    whereClause += " AND classification = $2";
    params.push(classification);
  }

  if (!includeIgnored) {
    whereClause += ` AND ignored = false`;
  }

  if (statusGroup === "no_response") {
    whereClause += " AND status_code IS NULL";
  } else if (statusGroup === "http_error") {
    whereClause += " AND status_code IS NOT NULL";
  }

  // Get total count
  const countRes = await client.query<{ count: string }>(
    `
      SELECT COUNT(*) as count
      FROM scan_links
      ${whereClause}
    `,
    params,
  );

  const totalMatching = Number(countRes.rows[0]?.count ?? 0);

  // Get paginated results
  const paramIndex = params.length + 1;
  const res = await client.query<ScanLink>(
    `
      SELECT
        id,
        scan_run_id,
        link_url,
        classification,
        status_code,
        error_message,
        ignored,
        ignored_by_rule_id,
        ignored_at,
        ignore_reason,
        ignored_source,
        first_seen_at,
        last_seen_at,
        occurrence_count,
        created_at,
        updated_at
      FROM scan_links
      ${whereClause}
      ORDER BY
        last_seen_at DESC,
        created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `,
    [...params, limit, offset],
  );

  return {
    links: res.rows,
    countReturned: res.rows.length,
    totalMatching,
  };
}

export async function getScanLinksForRunForUser(
  userId: string,
  scanRunId: string,
  options?: {
    limit?: number;
    offset?: number;
    classification?: LinkClassification;
    statusGroup?: "all" | "no_response" | "http_error";
    includeIgnored?: boolean;
  },
): Promise<{
  links: ScanLink[];
  countReturned: number;
  totalMatching: number;
} | null> {
  const owned = await isScanRunOwnedByUser(userId, scanRunId);
  if (!owned) return null;
  return getScanLinksForRun(scanRunId, options);
}

/**
 * Get all occurrences of a specific link in a scan run.
 * Used to show "where does this link appear".
 */
export async function getScanLinkOccurrences(
  scanLinkId: string,
  options?: { limit?: number; offset?: number },
): Promise<{
  occurrences: ScanLinkOccurrence[];
  countReturned: number;
  totalMatching: number;
}> {
  const client = await ensureConnected();

  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;

  // Get total count
  const countRes = await client.query<{ count: string }>(
    `
      SELECT COUNT(*) as count
      FROM scan_link_occurrences
      WHERE scan_link_id = $1
    `,
    [scanLinkId],
  );

  const totalMatching = Number(countRes.rows[0]?.count ?? 0);

  // Get paginated occurrences
  const res = await client.query<ScanLinkOccurrence>(
    `
      SELECT
        id,
        scan_link_id,
        scan_run_id,
        link_url,
        source_page,
        created_at
      FROM scan_link_occurrences
      WHERE scan_link_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `,
    [scanLinkId, limit, offset],
  );

  return {
    occurrences: res.rows,
    countReturned: res.rows.length,
    totalMatching,
  };
}

/**
 * Get summary counts of unique links by classification and status code.
 */
export async function getScanLinksSummary(scanRunId: string): Promise<
  Array<{
    classification: LinkClassification;
    status_code: number | null;
    count: number;
  }>
> {
  const client = await ensureConnected();

  const res = await client.query<{
    classification: LinkClassification;
    status_code: number | null;
    count: string;
  }>(
    `
      SELECT
        classification,
        status_code,
        COUNT(*) as count
      FROM scan_links
      WHERE scan_run_id = $1 AND ignored = false
      GROUP BY classification, status_code
      ORDER BY classification, status_code
    `,
    [scanRunId],
  );

  return res.rows.map((row) => ({
    ...row,
    count: Number(row.count),
  }));
}

export async function getScanLinksSummaryForUser(
  userId: string,
  scanRunId: string,
): Promise<
  Array<{
    classification: LinkClassification;
    status_code: number | null;
    count: number;
  }> | null
> {
  const owned = await isScanRunOwnedByUser(userId, scanRunId);
  if (!owned) return null;
  return getScanLinksSummary(scanRunId);
}

export async function getScanLinksForExport(
  scanRunId: string,
  classification: ExportClassification = "all",
  limit = 5000,
): Promise<ScanLinkExportRow[]> {
  const client = await ensureConnected();

  let whereClause = "WHERE scan_run_id = $1 AND ignored = false";
  const params: Array<string | LinkClassification> = [scanRunId];

  if (classification !== "all") {
    if (classification === "timeout") {
      whereClause +=
        " AND classification = 'no_response' AND status_code IS NULL AND error_message = 'timeout'";
    } else {
      params.push(classification);
      whereClause += ` AND classification = $${params.length}`;
    }
  }

  const res = await client.query<ScanLinkExportRow>(
    `
      SELECT
        link_url,
        classification,
        status_code,
        error_message,
        occurrence_count,
        first_seen_at,
        last_seen_at
      FROM scan_links
      ${whereClause}
      ORDER BY last_seen_at DESC
      LIMIT $${params.length + 1}
    `,
    [...params, limit],
  );

  return res.rows;
}

export async function getScanLinksForExportForUser(
  userId: string,
  scanRunId: string,
  classification: ExportClassification = "all",
  limit = 5000,
): Promise<ScanLinkExportRow[] | null> {
  const owned = await isScanRunOwnedByUser(userId, scanRunId);
  if (!owned) return null;
  return getScanLinksForExport(scanRunId, classification, limit);
}

type ExportFilterOptions = {
  classification?: ExportClassification;
  statusGroup?: "all" | "no_response" | "http_error";
  statusFilters?: string[];
  searchQuery?: string;
  minOccurrencesOnly?: boolean;
  sortOption?:
    | "severity"
    | "occ_desc"
    | "status_asc"
    | "status_desc"
    | "recent";
  showIgnored?: boolean;
  ignoredOnly?: boolean;
  limit?: number;
};

export async function getScanLinksForExportFiltered(
  scanRunId: string,
  options: ExportFilterOptions,
): Promise<ScanLinkExportRow[]> {
  const client = await ensureConnected();

  const whereClauses: string[] = ["scan_run_id = $1"];
  const params: Array<string | number | string[] | number[] | boolean> = [
    scanRunId,
  ];

  const classification = options.classification ?? "all";
  if (classification !== "all") {
    if (classification === "timeout") {
      whereClauses.push(
        "classification = 'no_response' AND status_code IS NULL AND error_message = 'timeout'",
      );
    } else {
      params.push(classification);
      whereClauses.push(`classification = $${params.length}`);
    }
  }

  if (options.ignoredOnly) {
    whereClauses.push("ignored = true");
  } else if (!options.showIgnored) {
    whereClauses.push("ignored = false");
  }

  if (options.statusGroup === "no_response") {
    whereClauses.push("classification = 'no_response'");
  } else if (options.statusGroup === "http_error") {
    whereClauses.push("status_code IS NOT NULL");
  }

  if (options.searchQuery) {
    params.push(`%${options.searchQuery}%`);
    whereClauses.push(`link_url ILIKE $${params.length}`);
  }

  if (options.minOccurrencesOnly) {
    whereClauses.push("occurrence_count > 1");
  }

  if (options.statusFilters && options.statusFilters.length > 0) {
    const statusClauses: string[] = [];
    if (options.statusFilters.includes("401/403/429")) {
      params.push([401, 403, 429]);
      statusClauses.push(`status_code = ANY($${params.length})`);
    }
    if (options.statusFilters.includes("404")) {
      params.push([404, 410]);
      statusClauses.push(`status_code = ANY($${params.length})`);
    }
    if (options.statusFilters.includes("5xx")) {
      statusClauses.push("status_code >= 500 AND status_code < 600");
    }
    if (options.statusFilters.includes("no_response")) {
      statusClauses.push("status_code IS NULL");
    }
    if (statusClauses.length > 0) {
      whereClauses.push(`(${statusClauses.join(" OR ")})`);
    }
  }

  const sort = options.sortOption ?? "severity";
  let orderBy = "last_seen_at DESC";
  if (sort === "occ_desc") {
    orderBy = "occurrence_count DESC, last_seen_at DESC";
  } else if (sort === "status_asc") {
    orderBy = "status_code IS NULL, status_code ASC, last_seen_at DESC";
  } else if (sort === "status_desc") {
    orderBy = "status_code IS NULL, status_code DESC, last_seen_at DESC";
  } else if (sort === "recent") {
    orderBy = "last_seen_at DESC";
  } else {
    orderBy = `
      CASE classification
        WHEN 'broken' THEN 0
        WHEN 'blocked' THEN 1
        WHEN 'no_response' THEN 2
        WHEN 'ok' THEN 3
        ELSE 4
      END,
      occurrence_count DESC,
      last_seen_at DESC
    `;
  }

  const limit = options.limit ?? 5000;
  params.push(limit);

  const res = await client.query<ScanLinkExportRow>(
    `
      SELECT
        link_url,
        classification,
        status_code,
        error_message,
        occurrence_count,
        first_seen_at,
        last_seen_at
      FROM scan_links
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY ${orderBy}
      LIMIT $${params.length}
    `,
    params,
  );

  return res.rows;
}

export async function getScanLinksForExportFilteredForUser(
  userId: string,
  scanRunId: string,
  options: ExportFilterOptions,
): Promise<ScanLinkExportRow[] | null> {
  const owned = await isScanRunOwnedByUser(userId, scanRunId);
  if (!owned) return null;
  return getScanLinksForExportFiltered(scanRunId, options);
}

export async function updateScanLinkAfterRecheck(args: {
  scanLinkId: string;
  classification: LinkClassification;
  statusCode: number | null;
  errorMessage: string | null;
}): Promise<ScanLink | null> {
  const client = await ensureConnected();
  const res = await client.query<ScanLink>(
    `
      UPDATE scan_links
      SET classification = $2,
          status_code = $3,
          error_message = $4,
          last_seen_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [args.scanLinkId, args.classification, args.statusCode, args.errorMessage],
  );
  return res.rows[0] ?? null;
}

export async function getTopLinksByClassification(
  scanRunId: string,
  classification: LinkClassification,
  limit: number,
): Promise<ScanLinkExportRow[]> {
  const client = await ensureConnected();
  const res = await client.query<ScanLinkExportRow>(
    `
      SELECT
        link_url,
        classification,
        status_code,
        error_message,
        occurrence_count,
        first_seen_at,
        last_seen_at
      FROM scan_links
      WHERE scan_run_id = $1
        AND classification = $2
        AND ignored = false
      ORDER BY occurrence_count DESC, last_seen_at DESC
      LIMIT $3
    `,
    [scanRunId, classification, limit],
  );

  return res.rows;
}

export async function getTopLinksByClassificationForUser(
  userId: string,
  scanRunId: string,
  classification: LinkClassification,
  limit: number,
): Promise<ScanLinkExportRow[] | null> {
  const owned = await isScanRunOwnedByUser(userId, scanRunId);
  if (!owned) return null;
  return getTopLinksByClassification(scanRunId, classification, limit);
}

export async function getTimeoutCountForRun(
  scanRunId: string,
): Promise<number> {
  const client = await ensureConnected();
  const res = await client.query<{ count: string }>(
    `
      SELECT COUNT(*) as count
      FROM scan_links
      WHERE scan_run_id = $1
        AND ignored = false
        AND classification = 'no_response'
        AND status_code IS NULL
        AND error_message = 'timeout'
    `,
    [scanRunId],
  );
  return Number(res.rows[0]?.count ?? 0);
}

export async function getTimeoutCountForRunForUser(
  userId: string,
  scanRunId: string,
): Promise<number | null> {
  const owned = await isScanRunOwnedByUser(userId, scanRunId);
  if (!owned) return null;
  return getTimeoutCountForRun(scanRunId);
}

export async function getScanLinkByRunAndUrl(
  scanRunId: string,
  linkUrl: string,
): Promise<ScanLink | null> {
  const client = await ensureConnected();
  const res = await client.query<ScanLink>(
    `
      SELECT
        id,
        scan_run_id,
        link_url,
        classification,
        status_code,
        error_message,
        ignored,
        ignored_by_rule_id,
        ignored_at,
        ignore_reason,
        ignored_source,
        first_seen_at,
        last_seen_at,
        occurrence_count,
        created_at,
        updated_at
      FROM scan_links
      WHERE scan_run_id = $1 AND link_url = $2
      LIMIT 1
    `,
    [scanRunId, linkUrl],
  );
  return res.rows[0] ?? null;
}

export async function getScanLinkByRunAndUrlForUser(
  userId: string,
  scanRunId: string,
  linkUrl: string,
): Promise<ScanLink | null> {
  const owned = await isScanRunOwnedByUser(userId, scanRunId);
  if (!owned) return null;
  return getScanLinkByRunAndUrl(scanRunId, linkUrl);
}

export async function getScanLinkById(
  scanLinkId: string,
): Promise<ScanLink | null> {
  const client = await ensureConnected();
  const res = await client.query<ScanLink>(
    `
      SELECT
        id,
        scan_run_id,
        link_url,
        classification,
        status_code,
        error_message,
        ignored,
        ignored_by_rule_id,
        ignored_at,
        ignore_reason,
        ignored_source,
        first_seen_at,
        last_seen_at,
        occurrence_count,
        created_at,
        updated_at
      FROM scan_links
      WHERE id = $1
      LIMIT 1
    `,
    [scanLinkId],
  );
  return res.rows[0] ?? null;
}

export async function getScanLinkByIdForUser(
  userId: string,
  scanLinkId: string,
): Promise<ScanLink | null> {
  const owned = await getScanLinkOwnership(userId, scanLinkId);
  if (!owned) return null;
  return getScanLinkById(scanLinkId);
}

export async function listScanLinksForIgnore(scanRunId: string): Promise<
  Array<{
    id: string;
    link_url: string;
    status_code: number | null;
    classification: LinkClassification;
  }>
> {
  const client = await ensureConnected();
  const res = await client.query<{
    id: string;
    link_url: string;
    status_code: number | null;
    classification: LinkClassification;
  }>(
    `
      SELECT id, link_url, status_code, classification
      FROM scan_links
      WHERE scan_run_id = $1 AND ignored = false
    `,
    [scanRunId],
  );
  return res.rows;
}

export async function setScanLinkIgnoredForRun(
  scanRunId: string,
  linkUrl: string,
  ignored: boolean,
  options?: {
    reason?: string;
    source?: "manual" | "rule" | "none";
    ruleId?: string | null;
  },
): Promise<void> {
  const client = await ensureConnected();
  const source = options?.source ?? (ignored ? "manual" : "none");
  const reason = options?.reason ?? null;
  const ruleId = options?.ruleId ?? null;
  const ignoredAt = ignored ? new Date().toISOString() : null;
  await client.query(
    `
      UPDATE scan_links
      SET ignored = $3,
          ignored_by_rule_id = $4,
          ignored_at = $5,
          ignore_reason = $6,
          ignored_source = $7
      WHERE scan_run_id = $1 AND link_url = $2
    `,
    [scanRunId, linkUrl, ignored, ruleId, ignoredAt, reason, source],
  );
}

export async function setScanLinksIgnoredByIds(
  ids: string[],
  ignored: boolean,
  options?: {
    reason?: string;
    source?: "manual" | "rule" | "none";
    ruleId?: string | null;
  },
): Promise<void> {
  if (ids.length === 0) return;
  const client = await ensureConnected();
  const source = options?.source ?? (ignored ? "manual" : "none");
  const reason = options?.reason ?? null;
  const ruleId = options?.ruleId ?? null;
  const ignoredAt = ignored ? new Date().toISOString() : null;
  await client.query(
    `
      UPDATE scan_links
      SET ignored = $2,
          ignored_by_rule_id = $3,
          ignored_at = $4,
          ignore_reason = $5,
          ignored_source = $6
      WHERE id = ANY($1::uuid[])
    `,
    [ids, ignored, ruleId, ignoredAt, reason, source],
  );
}

/**
 * Get all occurrences of a specific scan link with pagination.
 * Returns scanLinkId in response for UI to reference.
 */
export async function getOccurrencesForScanLink(
  scanLinkId: string,
  options?: { limit?: number; offset?: number },
): Promise<PaginatedOccurrences> {
  const client = await ensureConnected();

  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  // Get total count
  const countRes = await client.query<{ count: string }>(
    `
      SELECT COUNT(*) as count
      FROM scan_link_occurrences
      WHERE scan_link_id = $1
    `,
    [scanLinkId],
  );

  const totalMatching = Number(countRes.rows[0]?.count ?? 0);

  // Get paginated occurrences
  const res = await client.query<ScanLinkOccurrence>(
    `
      SELECT
        id,
        scan_link_id,
        scan_run_id,
        link_url,
        source_page,
        created_at
      FROM scan_link_occurrences
      WHERE scan_link_id = $1
      ORDER BY created_at ASC
      LIMIT $2 OFFSET $3
    `,
    [scanLinkId, limit, offset],
  );

  return {
    scanLinkId,
    countReturned: res.rows.length,
    totalMatching,
    occurrences: res.rows,
  };
}

export async function getOccurrencesForScanLinkForUser(
  userId: string,
  scanLinkId: string,
  options?: { limit?: number; offset?: number },
): Promise<PaginatedOccurrences | null> {
  const owned = await getScanLinkOwnership(userId, scanLinkId);
  if (!owned) return null;
  return getOccurrencesForScanLink(scanLinkId, options);
}
