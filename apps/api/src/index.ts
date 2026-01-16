import express from "express";
import type { Response } from "express";
import cors from "cors";
import type { LinkClassification } from "../../../packages/db/src/scanRuns.js";
import type { ExportClassification } from "../../../packages/db/src/scanLinksDedup.js";
import type { ScanLinkOccurrenceRow } from "../../../packages/db/src/scanLinksDedup.js";
import type { IgnoreRuleType } from "../../../packages/db/src/ignoreRules.js";

import {
  getLatestScanForSite,
  getRecentScansForSite,
  getScanRunById,
} from "../../../packages/db/src/scans";
import { cancelScanRun } from "../../../packages/db/src/scanRuns.js";

import {
  getSitesForUser,
  getSiteById,
  createSite,
  deleteSite,
} from "../../../packages/db/src/sites.js";

import {
  getResultsForScanRun,
  getResultsSummaryForScanRun,
} from "../../../packages/db/src/scanResults.js";
import {
  getScanLinksForRun,
  getOccurrencesForScanLink,
  getScanLinkById,
  getScanLinkByRunAndUrl,
  setScanLinkIgnoredForRun,
  getScanLinksSummary,
  getScanLinksForExport,
  getTopLinksByClassification,
  getTimeoutCountForRun,
} from "../../../packages/db/src/scanLinksDedup.js";
import { runScanForSite } from "../../../packages/crawler/src/scanService.js";
import {
  listIgnoreRulesForSite,
  listIgnoreRules,
  createIgnoreRule,
  deleteIgnoreRule,
  setIgnoreRuleEnabled,
} from "../../../packages/db/src/ignoreRules.js";
import { applyIgnoreRulesForScanRun } from "../../../packages/db/src/scanLinksIgnoreApply.js";
import {
  getRecentScanRunsForSite,
  getDiffBetweenRuns,
} from "../../../packages/db/src/scanRunsHistory.js";
import {
  listIgnoredLinksForRun,
  listIgnoredOccurrences,
  upsertIgnoredLink,
  insertIgnoredOccurrence,
} from "../../../packages/db/src/ignoredLinks.js";

import { mountScanRunEvents } from "./routes/scanRunEvents";
import { serializeScanRun } from "./serializers";

const DEMO_USER_ID = "00000000-0000-0000-0000-000000000000";
const LINK_CLASSIFICATIONS = new Set<LinkClassification>([
  "ok",
  "broken",
  "blocked",
  "no_response",
]);
const EXPORT_CLASSIFICATIONS = new Set<ExportClassification>([
  "all",
  "ok",
  "broken",
  "blocked",
  "no_response",
  "timeout",
]);
const STATUS_GROUPS = new Set(["all", "no_response", "http_error"]);
const IGNORE_RULE_TYPES = new Set<IgnoreRuleType>([
  "contains",
  "regex",
  "exact",
  "status_code",
  "classification",
  "domain",
  "path_prefix",
]);

function parseClassification(value: unknown): LinkClassification | undefined {
  if (typeof value !== "string") return undefined;
  return LINK_CLASSIFICATIONS.has(value as LinkClassification)
    ? (value as LinkClassification)
    : undefined;
}

function parseExportClassification(value: unknown): ExportClassification {
  if (typeof value !== "string") return "all";
  return EXPORT_CLASSIFICATIONS.has(value as ExportClassification)
    ? (value as ExportClassification)
    : "all";
}

function parseStatusGroup(
  value: unknown,
): "all" | "no_response" | "http_error" {
  if (typeof value !== "string") return "all";
  return STATUS_GROUPS.has(value)
    ? (value as "all" | "no_response" | "http_error")
    : "all";
}

function parseIgnoreRuleType(value: unknown): IgnoreRuleType | null {
  if (typeof value !== "string") return null;
  return IGNORE_RULE_TYPES.has(value as IgnoreRuleType)
    ? (value as IgnoreRuleType)
    : null;
}

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

type ApiErrorPayload = {
  error: string;
  message: string;
  details?: string;
};

function sendApiError(
  res: Response,
  status: number,
  error: string,
  message: string,
  details?: string,
) {
  const payload: ApiErrorPayload = { error, message };
  if (details) payload.details = details;
  return res.status(status).json(payload);
}

function sendInternalError(res: Response, message: string, err?: unknown) {
  return sendApiError(
    res,
    500,
    "internal_error",
    message,
    err ? getErrorMessage(err) : undefined,
  );
}

function parseShowIgnored(value: unknown): boolean {
  return value === "true" || value === "1";
}

function csvEscape(value: unknown): string {
  const str = value == null ? "" : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

const app = express();

app.use(cors());
app.use(express.json());

mountScanRunEvents(app);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "link-sentry-api" });
});

// List sites for a (temporary) demo user
app.get("/sites", async (req, res) => {
  try {
    const userId = (req.query.userId as string) ?? DEMO_USER_ID;
    const sites = await getSitesForUser(userId);

    res.json({
      userId,
      count: sites.length,
      sites,
    });
  } catch (err: unknown) {
    console.error("Error fetching sites", err);
    sendInternalError(res, "Failed to fetch sites", err);
  }
});

// Recent scans for a site
app.get("/sites/:siteId/scans", async (req, res) => {
  const siteId = req.params.siteId;
  const limitRaw = req.query.limit;
  const limit = limitRaw ? Number(limitRaw) : 10;

  if (Number.isNaN(limit) || limit <= 0) {
    return sendApiError(
      res,
      400,
      "invalid_limit",
      "limit must be a positive number",
    );
  }

  try {
    const scans = await getRecentScansForSite(siteId, limit);

    res.json({
      siteId,
      count: scans.length,
      scans: scans.map(serializeScanRun),
    });
  } catch (err: unknown) {
    console.error("Error in GET /sites/:siteId/scans", err);
    return sendInternalError(res, "Failed to fetch scans", err);
  }
});

// Recent scan runs for a site (history drawer)
app.get("/sites/:siteId/scan-runs", async (req, res) => {
  const siteId = req.params.siteId;
  const limitRaw = req.query.limit;
  const limit = limitRaw ? Number(limitRaw) : 10;

  if (Number.isNaN(limit) || limit <= 0) {
    return sendApiError(
      res,
      400,
      "invalid_limit",
      "limit must be a positive number",
    );
  }

  try {
    const runs = await getRecentScanRunsForSite(siteId, limit);
    res.json({
      siteId,
      runs: runs.map(serializeScanRun),
    });
  } catch (err: unknown) {
    console.error("Error in GET /sites/:siteId/scan-runs", err);
    return sendInternalError(res, "Failed to fetch scan runs", err);
  }
});

// Latest scan for a site
app.get("/sites/:siteId/scans/latest", async (req, res) => {
  const siteId = req.params.siteId;

  try {
    const latest = await getLatestScanForSite(siteId);

    if (!latest) {
      return sendApiError(
        res,
        404,
        "no_scans_for_site",
        `No scans found for site ${siteId}`,
      );
    }

    res.json(serializeScanRun(latest));
  } catch (err: unknown) {
    console.error("Error in GET /sites/:siteId/scans/latest", err);
    return sendInternalError(res, "Failed to fetch latest scan", err);
  }
});

// NEW: Get a scan run by id (live progress polling)
app.get("/scan-runs/:scanRunId", async (req, res) => {
  const scanRunId = req.params.scanRunId;

  try {
    const run = await getScanRunById(scanRunId);

    if (!run) {
      return sendApiError(
        res,
        404,
        "scan_run_not_found",
        `No scan run found with id ${scanRunId}`,
      );
    }

    const serialized = serializeScanRun(run);
    return res.json(serialized);
  } catch (err: unknown) {
    console.error("Error in GET /scan-runs/:scanRunId", err);
    return sendInternalError(res, "Failed to fetch scan run", err);
  }
});

// Scan report payload
app.get("/scan-runs/:scanRunId/report", async (req, res) => {
  const scanRunId = req.params.scanRunId;

  try {
    const run = await getScanRunById(scanRunId);
    if (!run) {
      return sendApiError(
        res,
        404,
        "scan_run_not_found",
        `No scan run found with id ${scanRunId}`,
      );
    }

    await applyIgnoreRulesForScanRun(scanRunId);

    const summaryRows = await getScanLinksSummary(scanRunId);
    const timeoutCount = await getTimeoutCountForRun(scanRunId);
    const byClassification: Record<string, number> = {
      ok: 0,
      broken: 0,
      blocked: 0,
      no_response: 0,
      timeout: timeoutCount,
    };
    const byStatusCode: Record<string, number> = {};

    summaryRows.forEach((row) => {
      byClassification[row.classification] =
        (byClassification[row.classification] ?? 0) + row.count;
      const statusKey =
        row.status_code == null ? "null" : String(row.status_code);
      byStatusCode[statusKey] = (byStatusCode[statusKey] ?? 0) + row.count;
    });

    const serializeTopRow = (row: {
      last_seen_at: Date;
      first_seen_at?: Date;
    }) => ({
      ...row,
      first_seen_at:
        row.first_seen_at instanceof Date
          ? row.first_seen_at.toISOString()
          : row.first_seen_at,
      last_seen_at:
        row.last_seen_at instanceof Date
          ? row.last_seen_at.toISOString()
          : row.last_seen_at,
    });

    const topBroken = await getTopLinksByClassification(
      scanRunId,
      "broken",
      20,
    );
    const topBlocked = await getTopLinksByClassification(
      scanRunId,
      "blocked",
      20,
    );

    return res.json({
      scanRun: serializeScanRun(run),
      summary: { byClassification, byStatusCode },
      topBroken: topBroken.map(serializeTopRow),
      topBlocked: topBlocked.map(serializeTopRow),
      generatedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    console.error("Error in GET /scan-runs/:scanRunId/report", err);
    return sendInternalError(res, "Failed to build report", err);
  }
});

// Cancel a scan run
// curl -X POST "http://localhost:3001/scan-runs/<scanRunId>/cancel"
app.post("/scan-runs/:scanRunId/cancel", async (req, res) => {
  const scanRunId = req.params.scanRunId;
  try {
    await cancelScanRun(scanRunId);
    return res.json({ ok: true });
  } catch (err: unknown) {
    console.error("Error in POST /scan-runs/:scanRunId/cancel", err);
    return sendInternalError(res, "Failed to cancel scan run", err);
  }
});

// Create a new site
app.post("/sites", async (req, res) => {
  try {
    const userId = (req.body.userId as string) ?? DEMO_USER_ID;
    const url = req.body.url as string | undefined;

    if (!url) {
      return sendApiError(res, 400, "missing_url", "Missing 'url' in body");
    }

    const site = await createSite(userId, url);

    res.status(201).json({ site });
  } catch (err: unknown) {
    console.error("Error creating site", err);
    return sendInternalError(res, "Failed to create site", err);
  }
});

// Trigger a new scan
app.post("/sites/:siteId/scans", async (req, res) => {
  const siteId = req.params.siteId;
  const body = req.body as { startUrl?: string };

  if (!body.startUrl || typeof body.startUrl !== "string") {
    return sendApiError(
      res,
      400,
      "invalid_start_url",
      "body.startUrl must be a non-empty string",
    );
  }

  try {
    // Get the scanRunId synchronously (from createScanRun)
    const { getScanRunIdOnly } =
      await import("../../../packages/crawler/src/scanService.js");
    const scanRunId = await getScanRunIdOnly(siteId, body.startUrl);

    // Return immediately with the scanRunId
    res.status(201).json({
      scanRunId,
      siteId,
      startUrl: body.startUrl,
    });

    // Run the scan in the background (fire-and-forget) with the same scanRunId
    // The frontend will poll /scan-runs/:scanRunId or use SSE for progress
    runScanForSite(siteId, body.startUrl, scanRunId).catch((err) => {
      console.error("Background scan error for site", siteId, ":", err);
    });
  } catch (err: unknown) {
    console.error("Error in POST /sites/:siteId/scans", err);
    return sendInternalError(res, "Failed to start scan", err);
  }
});

// Results for a scan run
app.get("/scan-runs/:scanRunId/results", async (req, res) => {
  const scanRunId = req.params.scanRunId;
  const limitRaw = req.query.limit;
  const offsetRaw = req.query.offset;
  const classificationRaw = req.query.classification;

  const limit = limitRaw ? Number(limitRaw) : 200;
  const offset = offsetRaw ? Number(offsetRaw) : 0;
  const classification = parseClassification(classificationRaw);

  if (Number.isNaN(limit) || limit <= 0) {
    return sendApiError(
      res,
      400,
      "invalid_limit",
      "limit must be a positive number",
    );
  }

  if (Number.isNaN(offset) || offset < 0) {
    return sendApiError(
      res,
      400,
      "invalid_offset",
      "offset must be 0 or greater",
    );
  }

  try {
    const paginatedResults = await getResultsForScanRun(scanRunId, {
      limit,
      offset,
      classification,
    });

    res.json({
      scanRunId,
      classification,
      countReturned: paginatedResults.countReturned,
      totalMatching: paginatedResults.totalMatching,
      results: paginatedResults.results,
    });
  } catch (err: unknown) {
    console.error("Error in GET /scan-runs/:scanRunId/results", err);
    return sendInternalError(res, "Failed to fetch scan results", err);
  }
});

// Get results summary (counts by classification + status_code)
app.get("/scan-runs/:scanRunId/results/summary", async (req, res) => {
  const scanRunId = req.params.scanRunId;

  try {
    const summary = await getResultsSummaryForScanRun(scanRunId);

    res.json({
      scanRunId,
      summary,
    });
  } catch (err: unknown) {
    console.error("Error in GET /scan-runs/:scanRunId/results/summary", err);
    return sendInternalError(res, "Failed to fetch results summary", err);
  }
});

// Summary for deduplicated scan links (excludes ignored)
app.get("/scan-runs/:scanRunId/links/summary", async (req, res) => {
  const scanRunId = req.params.scanRunId;
  try {
    const summary = await getScanLinksSummary(scanRunId);
    const noResponse = summary
      .filter((row) => row.status_code == null)
      .reduce((acc, row) => acc + row.count, 0);
    res.json({ scanRunId, summary, no_response: noResponse });
  } catch (err: unknown) {
    console.error("Error in GET /scan-runs/:scanRunId/links/summary", err);
    return sendInternalError(res, "Failed to fetch link summary", err);
  }
});

// Export deduplicated links as CSV
app.get("/scan-runs/:scanRunId/links/export.csv", async (req, res) => {
  const scanRunId = req.params.scanRunId;
  const classificationRaw = req.query.classification;
  const limitRaw = req.query.limit;
  const classification = parseExportClassification(classificationRaw);
  const limit = typeof limitRaw === "string" ? Number(limitRaw) : 5000;
  if (
    classificationRaw &&
    typeof classificationRaw === "string" &&
    !EXPORT_CLASSIFICATIONS.has(classificationRaw as ExportClassification)
  ) {
    return sendApiError(
      res,
      400,
      "invalid_classification",
      "classification must be a supported value",
    );
  }
  if (Number.isNaN(limit) || limit <= 0 || limit > 20000) {
    return sendApiError(
      res,
      400,
      "invalid_limit",
      "limit must be between 1 and 20000",
    );
  }

  try {
    await applyIgnoreRulesForScanRun(scanRunId);
    const rows = await getScanLinksForExport(scanRunId, classification, limit);
    const dateStamp = new Date().toISOString().split("T")[0];
    const filename = `scan-links-${scanRunId}-${classification}-${dateStamp}.csv`;
    const header = [
      "link_url",
      "classification",
      "status_code",
      "error_message",
      "occurrence_count",
      "first_seen_at",
      "last_seen_at",
    ];
    const csvRows = [
      header.map(csvEscape).join(","),
      ...rows.map((row) =>
        [
          row.link_url,
          row.classification,
          row.status_code ?? "",
          row.error_message ?? "",
          row.occurrence_count,
          row.first_seen_at instanceof Date
            ? row.first_seen_at.toISOString()
            : row.first_seen_at,
          row.last_seen_at instanceof Date
            ? row.last_seen_at.toISOString()
            : row.last_seen_at,
        ]
          .map(csvEscape)
          .join(","),
      ),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(csvRows);
  } catch (err: unknown) {
    console.error("Error in GET /scan-runs/:scanRunId/links/export.csv", err);
    return sendInternalError(res, "Failed to export links as CSV", err);
  }
});

// Export deduplicated links as JSON
app.get("/scan-runs/:scanRunId/links/export.json", async (req, res) => {
  const scanRunId = req.params.scanRunId;
  const classificationRaw = req.query.classification;
  const limitRaw = req.query.limit;
  const classification = parseExportClassification(classificationRaw);
  const limit = typeof limitRaw === "string" ? Number(limitRaw) : 5000;
  if (
    classificationRaw &&
    typeof classificationRaw === "string" &&
    !EXPORT_CLASSIFICATIONS.has(classificationRaw as ExportClassification)
  ) {
    return sendApiError(
      res,
      400,
      "invalid_classification",
      "classification must be a supported value",
    );
  }
  if (Number.isNaN(limit) || limit <= 0 || limit > 20000) {
    return sendApiError(
      res,
      400,
      "invalid_limit",
      "limit must be between 1 and 20000",
    );
  }

  try {
    await applyIgnoreRulesForScanRun(scanRunId);
    const rows = await getScanLinksForExport(scanRunId, classification, limit);
    const dateStamp = new Date().toISOString().split("T")[0];
    const filename = `scan-links-${scanRunId}-${classification}-${dateStamp}.json`;
    const payload = rows.map((row) => ({
      ...row,
      first_seen_at:
        row.first_seen_at instanceof Date
          ? row.first_seen_at.toISOString()
          : row.first_seen_at,
      last_seen_at:
        row.last_seen_at instanceof Date
          ? row.last_seen_at.toISOString()
          : row.last_seen_at,
    }));

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (err: unknown) {
    console.error("Error in GET /scan-runs/:scanRunId/links/export.json", err);
    return sendInternalError(res, "Failed to export links as JSON", err);
  }
});

// Diff between two scan runs (dedup links)
app.get("/scan-runs/:scanRunId/diff", async (req, res) => {
  const scanRunId = req.params.scanRunId;
  const compareTo =
    typeof req.query.compareTo === "string" ? req.query.compareTo : "";
  if (!compareTo) {
    return sendApiError(
      res,
      400,
      "missing_compareTo",
      "compareTo query param is required",
    );
  }

  try {
    const diff = await getDiffBetweenRuns(scanRunId, compareTo);
    const serializeRow = (row: { last_seen_at: Date }) => ({
      ...row,
      last_seen_at:
        row.last_seen_at instanceof Date
          ? row.last_seen_at.toISOString()
          : row.last_seen_at,
    });

    res.json({
      scanRunId,
      compareTo,
      diff: {
        ...diff,
        added: diff.added.map(serializeRow),
        removed: diff.removed.map(serializeRow),
        changed: diff.changed.map((item) => ({
          before: serializeRow(item.before),
          after: serializeRow(item.after),
        })),
      },
    });
  } catch (err: unknown) {
    console.error("Error in GET /scan-runs/:scanRunId/diff", err);
    return sendInternalError(res, "Failed to compute diff", err);
  }
});

// Ignored links for a scan run
app.get("/scan-runs/:scanRunId/ignored", async (req, res) => {
  const scanRunId = req.params.scanRunId;
  const limitRaw = req.query.limit;
  const offsetRaw = req.query.offset;

  const limit = limitRaw ? Number(limitRaw) : 50;
  const offset = offsetRaw ? Number(offsetRaw) : 0;

  if (Number.isNaN(limit) || limit <= 0) {
    return sendApiError(
      res,
      400,
      "invalid_limit",
      "limit must be a positive number",
    );
  }
  if (Number.isNaN(offset) || offset < 0) {
    return sendApiError(
      res,
      400,
      "invalid_offset",
      "offset must be 0 or greater",
    );
  }

  try {
    const result = await listIgnoredLinksForRun(scanRunId, limit, offset);
    const serialized = result.links.map((link) => ({
      ...link,
      first_seen_at:
        link.first_seen_at instanceof Date
          ? link.first_seen_at.toISOString()
          : link.first_seen_at,
      last_seen_at:
        link.last_seen_at instanceof Date
          ? link.last_seen_at.toISOString()
          : link.last_seen_at,
      created_at:
        link.created_at instanceof Date
          ? link.created_at.toISOString()
          : link.created_at,
    }));
    res.json({
      scanRunId,
      countReturned: result.countReturned,
      totalMatching: result.totalMatching,
      links: serialized,
    });
  } catch (err: unknown) {
    console.error("Error in GET /scan-runs/:scanRunId/ignored", err);
    return sendInternalError(res, "Failed to fetch ignored links", err);
  }
});

// Ignored occurrences drill-down
app.get(
  "/scan-runs/:scanRunId/ignored/:ignoredLinkId/occurrences",
  async (req, res) => {
    const scanRunId = req.params.scanRunId;
    const ignoredLinkId = req.params.ignoredLinkId;
    const limitRaw = req.query.limit;
    const offsetRaw = req.query.offset;

    const limit = limitRaw ? Number(limitRaw) : 50;
    const offset = offsetRaw ? Number(offsetRaw) : 0;

    if (Number.isNaN(limit) || limit <= 0) {
      return sendApiError(
        res,
        400,
        "invalid_limit",
        "limit must be a positive number",
      );
    }
    if (Number.isNaN(offset) || offset < 0) {
      return sendApiError(
        res,
        400,
        "invalid_offset",
        "offset must be 0 or greater",
      );
    }

    try {
      const result = await listIgnoredOccurrences(ignoredLinkId, limit, offset);
      const serialized = result.occurrences.map((occ) => ({
        ...occ,
        created_at:
          occ.created_at instanceof Date
            ? occ.created_at.toISOString()
            : occ.created_at,
      }));
      res.json({
        scanRunId,
        ignoredLinkId,
        countReturned: result.countReturned,
        totalMatching: result.totalMatching,
        occurrences: serialized,
      });
    } catch (err: unknown) {
      console.error(
        "Error in GET /scan-runs/:scanRunId/ignored/:ignoredLinkId/occurrences",
        err,
      );
      return sendInternalError(res, "Failed to fetch ignored occurrences", err);
    }
  },
);

// ✅ NEW: Get unique links (deduplicated) from a scan run
// curl -s "http://localhost:3001/scan-runs/<scanRunId>/links?classification=no_response&limit=5&offset=0"
app.get("/scan-runs/:scanRunId/links", async (req, res) => {
  const scanRunId = req.params.scanRunId;
  const limitRaw = req.query.limit;
  const offsetRaw = req.query.offset;
  const classificationRaw = req.query.classification;
  const statusGroupRaw = req.query.statusGroup;
  const showIgnoredRaw = req.query.showIgnored;

  const limit = limitRaw ? Number(limitRaw) : 200;
  const offset = offsetRaw ? Number(offsetRaw) : 0;
  const classification = parseClassification(classificationRaw);
  const statusGroup = parseStatusGroup(statusGroupRaw);
  const showIgnored = parseShowIgnored(showIgnoredRaw);

  if (Number.isNaN(limit) || limit <= 0) {
    return sendApiError(
      res,
      400,
      "invalid_limit",
      "limit must be a positive number",
    );
  }

  if (Number.isNaN(offset) || offset < 0) {
    return sendApiError(
      res,
      400,
      "invalid_offset",
      "offset must be 0 or greater",
    );
  }

  try {
    await applyIgnoreRulesForScanRun(scanRunId);

    const paginatedLinks = await getScanLinksForRun(scanRunId, {
      limit,
      offset,
      classification,
      statusGroup,
      includeIgnored: showIgnored,
    });

    // Serialize Date fields to ISO strings
    const serializedLinks = paginatedLinks.links.map((link) => ({
      ...link,
      first_seen_at:
        link.first_seen_at instanceof Date
          ? link.first_seen_at.toISOString()
          : link.first_seen_at,
      last_seen_at:
        link.last_seen_at instanceof Date
          ? link.last_seen_at.toISOString()
          : link.last_seen_at,
      created_at:
        link.created_at instanceof Date
          ? link.created_at.toISOString()
          : link.created_at,
      updated_at:
        link.updated_at instanceof Date
          ? link.updated_at.toISOString()
          : link.updated_at,
      ignored_at:
        link.ignored_at instanceof Date
          ? link.ignored_at.toISOString()
          : link.ignored_at,
    }));

    res.json({
      scanRunId,
      classification,
      statusGroup,
      showIgnored,
      countReturned: paginatedLinks.countReturned,
      totalMatching: paginatedLinks.totalMatching,
      links: serializedLinks,
    });
  } catch (err: unknown) {
    console.error("Error in GET /scan-runs/:scanRunId/links", err);
    return sendInternalError(res, "Failed to fetch scan links", err);
  }
});

// ✅ NEW: Get occurrences of a specific link by link_url
app.get(
  "/scan-runs/:scanRunId/links/:encodedLinkUrl/occurrences",
  async (req, res) => {
    const scanRunId = req.params.scanRunId;
    const encodedLinkUrl = req.params.encodedLinkUrl;
    const limitRaw = req.query.limit;
    const offsetRaw = req.query.offset;

    const limit = limitRaw ? Number(limitRaw) : 100;
    const offset = offsetRaw ? Number(offsetRaw) : 0;

    if (Number.isNaN(limit) || limit <= 0) {
      return sendApiError(
        res,
        400,
        "invalid_limit",
        "limit must be a positive number",
      );
    }

    if (Number.isNaN(offset) || offset < 0) {
      return sendApiError(
        res,
        400,
        "invalid_offset",
        "offset must be 0 or greater",
      );
    }

    try {
      const linkUrl = decodeURIComponent(encodedLinkUrl);
      const scanLink = await getScanLinkByRunAndUrl(scanRunId, linkUrl);
      const scanLinkId = scanLink?.id;
      const paginatedOccurrences = scanLinkId
        ? await getOccurrencesForScanLink(scanLinkId, { limit, offset })
        : {
            scanLinkId: scanLinkId ?? "",
            countReturned: 0,
            totalMatching: 0,
            occurrences: [],
          };

      // Serialize Date fields to ISO strings
      const serializedOccurrences = paginatedOccurrences.occurrences.map(
        (occ: ScanLinkOccurrenceRow) => ({
          ...occ,
          created_at:
            occ.created_at instanceof Date
              ? occ.created_at.toISOString()
              : occ.created_at,
        }),
      );

      res.json({
        scanRunId,
        scanLinkId: scanLinkId ?? null,
        link_url: scanLink?.link_url ?? linkUrl,
        countReturned: paginatedOccurrences.countReturned,
        totalMatching: paginatedOccurrences.totalMatching,
        occurrences: serializedOccurrences,
      });
    } catch (err: unknown) {
      console.error(
        "Error in GET /scan-runs/:scanRunId/links/:encodedLinkUrl/occurrences",
        err,
      );
      return sendInternalError(res, "Failed to fetch link occurrences", err);
    }
  },
);

// ✅ NEW: Get occurrences of a specific scan link (direct route without scanRunId)
// curl -s "http://localhost:3001/scan-links/<scanLinkId>/occurrences?limit=5&offset=0"
app.get("/scan-links/:scanLinkId/occurrences", async (req, res) => {
  const scanLinkId = req.params.scanLinkId;
  if (!scanLinkId) {
    return sendApiError(
      res,
      400,
      "missing_scan_link_id",
      "scanLinkId is required",
    );
  }
  const limitRaw = req.query.limit;
  const offsetRaw = req.query.offset;

  const limit = limitRaw ? Number(limitRaw) : 50;
  const offset = offsetRaw ? Number(offsetRaw) : 0;

  if (Number.isNaN(limit) || limit <= 0) {
    return sendApiError(
      res,
      400,
      "invalid_limit",
      "limit must be a positive number",
    );
  }

  if (Number.isNaN(offset) || offset < 0) {
    return sendApiError(
      res,
      400,
      "invalid_offset",
      "offset must be 0 or greater",
    );
  }

  try {
    const result = await getOccurrencesForScanLink(scanLinkId, {
      limit,
      offset,
    });

    // Serialize Date fields to ISO strings
    const serializedOccurrences = result.occurrences.map((occ) => ({
      ...occ,
      created_at:
        occ.created_at instanceof Date
          ? occ.created_at.toISOString()
          : occ.created_at,
    }));

    res.json({
      scanLinkId: result.scanLinkId,
      countReturned: result.countReturned,
      totalMatching: result.totalMatching,
      occurrences: serializedOccurrences,
    });
  } catch (err: unknown) {
    console.error("Error in GET /scan-links/:scanLinkId/occurrences", err);
    return sendInternalError(res, "Failed to fetch scan link occurrences", err);
  }
});

// Ignore rules (global list)
app.get("/ignore-rules", async (_req, res) => {
  try {
    const rules = await listIgnoreRules();
    res.json({ count: rules.length, rules });
  } catch (err: unknown) {
    console.error("Error in GET /ignore-rules", err);
    return sendInternalError(res, "Failed to fetch ignore rules", err);
  }
});

app.post("/ignore-rules", async (req, res) => {
  const pattern =
    typeof req.body?.pattern === "string" ? req.body.pattern.trim() : "";
  const enabled =
    typeof req.body?.enabled === "boolean" ? req.body.enabled : true;
  const ruleType = parseIgnoreRuleType(req.body?.ruleType) ?? "exact";
  const siteId = typeof req.body?.siteId === "string" ? req.body.siteId : null;

  if (!pattern) {
    return sendApiError(
      res,
      400,
      "invalid_pattern",
      "pattern must be a non-empty string",
    );
  }

  try {
    const rule = await createIgnoreRule(siteId, ruleType, pattern);
    if (!enabled) {
      const updated = await setIgnoreRuleEnabled(rule.id, false);
      return res.status(201).json({ rule: updated ?? rule });
    }
    res.status(201).json({ rule });
  } catch (err: unknown) {
    console.error("Error in POST /ignore-rules", err);
    return sendInternalError(res, "Failed to create ignore rule", err);
  }
});

// Ignore rules for a site
app.get("/sites/:siteId/ignore-rules", async (req, res) => {
  const siteId = req.params.siteId;
  try {
    const rules = await listIgnoreRules(siteId);
    res.json({ siteId, count: rules.length, rules });
  } catch (err: unknown) {
    console.error("Error in GET /sites/:siteId/ignore-rules", err);
    return sendInternalError(res, "Failed to fetch site ignore rules", err);
  }
});

app.post("/sites/:siteId/ignore-rules", async (req, res) => {
  const siteId = req.params.siteId;
  const ruleType = parseIgnoreRuleType(req.body?.ruleType);
  const pattern =
    typeof req.body?.pattern === "string" ? req.body.pattern.trim() : "";
  const scope = req.body?.scope === "global" ? "global" : "site";

  if (!ruleType) {
    return sendApiError(
      res,
      400,
      "invalid_rule_type",
      "ruleType must be valid",
    );
  }
  if (!pattern) {
    return sendApiError(
      res,
      400,
      "invalid_pattern",
      "pattern must be a non-empty string",
    );
  }

  try {
    const rule = await createIgnoreRule(
      scope === "global" ? null : siteId,
      ruleType,
      pattern,
    );
    res.status(201).json({ rule });
  } catch (err: unknown) {
    console.error("Error in POST /sites/:siteId/ignore-rules", err);
    return sendInternalError(res, "Failed to create ignore rule", err);
  }
});

app.patch("/ignore-rules/:ruleId", async (req, res) => {
  const ruleId = req.params.ruleId;
  const isEnabled = req.body?.isEnabled;
  if (typeof isEnabled !== "boolean") {
    return sendApiError(
      res,
      400,
      "invalid_isEnabled",
      "isEnabled must be boolean",
    );
  }
  try {
    const rule = await setIgnoreRuleEnabled(ruleId, isEnabled);
    if (!rule)
      return sendApiError(
        res,
        404,
        "ignore_rule_not_found",
        "Ignore rule not found",
      );
    res.json({ rule });
  } catch (err: unknown) {
    console.error("Error in PATCH /ignore-rules/:ruleId", err);
    return sendInternalError(res, "Failed to update ignore rule", err);
  }
});

app.delete("/ignore-rules/:ruleId", async (req, res) => {
  const ruleId = req.params.ruleId;
  try {
    await deleteIgnoreRule(ruleId);
    res.status(204).send();
  } catch (err: unknown) {
    console.error("Error in DELETE /ignore-rules/:ruleId", err);
    return sendInternalError(res, "Failed to delete ignore rule", err);
  }
});

// Ignore a link for this scan or create a site rule
app.post(
  "/scan-runs/:scanRunId/links/:encodedLinkUrl/ignore",
  async (req, res) => {
    const scanRunId = req.params.scanRunId;
    const encodedLinkUrl = req.params.encodedLinkUrl;
    const mode = req.body?.mode as
      | "this_scan"
      | "site_rule_contains"
      | "site_rule_exact"
      | "site_rule_regex"
      | undefined;
    const linkUrl = decodeURIComponent(encodedLinkUrl);

    if (!mode) {
      return sendApiError(res, 400, "invalid_mode", "mode must be provided");
    }

    try {
      const run = await getScanRunById(scanRunId);
      if (!run)
        return sendApiError(
          res,
          404,
          "scan_run_not_found",
          "Scan run not found",
        );

      if (mode === "this_scan") {
        await setScanLinkIgnoredForRun(scanRunId, linkUrl, true, {
          reason: "Manually ignored",
          source: "manual",
        });
        const scanLink = await getScanLinkByRunAndUrl(scanRunId, linkUrl);
        if (scanLink) {
          const ignored = await upsertIgnoredLink({
            scanRunId,
            linkUrl,
            ruleId: null,
            statusCode: scanLink.status_code,
            errorMessage: scanLink.error_message ?? undefined,
          });
          const occ = await getOccurrencesForScanLink(scanLink.id, {
            limit: 1,
            offset: 0,
          });
          const first = occ.occurrences[0];
          if (first) {
            await insertIgnoredOccurrence({
              scanIgnoredLinkId: ignored.id,
              scanRunId,
              linkUrl,
              sourcePage: first.source_page,
            });
          }
        }
        return res.json({ scanRunId, link_url: linkUrl, ignored: true });
      }

      const ruleType: IgnoreRuleType =
        mode === "site_rule_exact"
          ? "exact"
          : mode === "site_rule_regex"
            ? "regex"
            : "contains";
      const rule = await createIgnoreRule(run.site_id, ruleType, linkUrl);
      await applyIgnoreRulesForScanRun(scanRunId, { force: true });
      return res.json({ scanRunId, link_url: linkUrl, rule });
    } catch (err: unknown) {
      console.error(
        "Error in POST /scan-runs/:scanRunId/links/:encodedLinkUrl/ignore",
        err,
      );
      return sendInternalError(res, "Failed to ignore link", err);
    }
  },
);

// Ignore a link by scan_link_id to avoid encoded URL path issues
app.post(
  "/scan-runs/:scanRunId/scan-links/:scanLinkId/ignore",
  async (req, res) => {
    const scanRunId = req.params.scanRunId;
    const scanLinkId = req.params.scanLinkId;
    const mode = req.body?.mode as
      | "this_scan"
      | "site_rule_contains"
      | "site_rule_exact"
      | "site_rule_regex"
      | undefined;

    if (!mode) {
      return sendApiError(res, 400, "invalid_mode", "mode must be provided");
    }

    try {
      const run = await getScanRunById(scanRunId);
      if (!run)
        return sendApiError(
          res,
          404,
          "scan_run_not_found",
          "Scan run not found",
        );

      const link = await getScanLinkById(scanLinkId);
      if (!link || link.scan_run_id !== scanRunId) {
        return sendApiError(
          res,
          404,
          "scan_link_not_found",
          "Scan link not found",
        );
      }

      if (mode === "this_scan") {
        await setScanLinkIgnoredForRun(scanRunId, link.link_url, true, {
          reason: "Manually ignored",
          source: "manual",
        });
        const ignored = await upsertIgnoredLink({
          scanRunId,
          linkUrl: link.link_url,
          ruleId: null,
          statusCode: link.status_code,
          errorMessage: link.error_message ?? undefined,
        });
        const occ = await getOccurrencesForScanLink(link.id, {
          limit: 1,
          offset: 0,
        });
        const first = occ.occurrences[0];
        if (first) {
          await insertIgnoredOccurrence({
            scanIgnoredLinkId: ignored.id,
            scanRunId,
            linkUrl: link.link_url,
            sourcePage: first.source_page,
          });
        }
        return res.json({ scanRunId, link_url: link.link_url, ignored: true });
      }

      const ruleType: IgnoreRuleType =
        mode === "site_rule_exact"
          ? "exact"
          : mode === "site_rule_regex"
            ? "regex"
            : "contains";
      const rule = await createIgnoreRule(run.site_id, ruleType, link.link_url);
      await applyIgnoreRulesForScanRun(scanRunId, { force: true });
      return res.json({ scanRunId, link_url: link.link_url, rule });
    } catch (err: unknown) {
      console.error(
        "Error in POST /scan-runs/:scanRunId/scan-links/:scanLinkId/ignore",
        err,
      );
      return sendInternalError(res, "Failed to ignore scan link", err);
    }
  },
);

app.post(
  "/scan-runs/:scanRunId/links/:encodedLinkUrl/unignore",
  async (req, res) => {
    const scanRunId = req.params.scanRunId;
    const encodedLinkUrl = req.params.encodedLinkUrl;
    const linkUrl = decodeURIComponent(encodedLinkUrl);
    try {
      const link = await getScanLinkByRunAndUrl(scanRunId, linkUrl);
      if (!link)
        return sendApiError(
          res,
          404,
          "scan_link_not_found",
          "Scan link not found",
        );
      if (link.ignored_source !== "manual") {
        return sendApiError(
          res,
          400,
          "cannot_unignore_rule",
          "Only manually ignored links can be unignored",
        );
      }
      await setScanLinkIgnoredForRun(scanRunId, linkUrl, false, {
        source: "none",
      });
      return res.json({ scanRunId, link_url: linkUrl, ignored: false });
    } catch (err: unknown) {
      console.error(
        "Error in POST /scan-runs/:scanRunId/links/:encodedLinkUrl/unignore",
        err,
      );
      return sendInternalError(res, "Failed to unignore link", err);
    }
  },
);

app.post("/scan-runs/:scanRunId/reapply-ignore", async (req, res) => {
  const scanRunId = req.params.scanRunId;
  const force = req.query.force === "true" || req.query.force === "1";
  try {
    const result = await applyIgnoreRulesForScanRun(scanRunId, { force });
    res.json({ scanRunId, ...result });
  } catch (err: unknown) {
    console.error("Error in POST /scan-runs/:scanRunId/reapply-ignore", err);
    return sendInternalError(res, "Failed to reapply ignore rules", err);
  }
});

app.post(
  "/scan-runs/:scanRunId/scan-links/:scanLinkId/unignore",
  async (req, res) => {
    const scanRunId = req.params.scanRunId;
    const scanLinkId = req.params.scanLinkId;
    try {
      const link = await getScanLinkById(scanLinkId);
      if (!link || link.scan_run_id !== scanRunId) {
        return sendApiError(
          res,
          404,
          "scan_link_not_found",
          "Scan link not found",
        );
      }
      if (link.ignored_source !== "manual") {
        return sendApiError(
          res,
          400,
          "cannot_unignore_rule",
          "Only manually ignored links can be unignored",
        );
      }
      await setScanLinkIgnoredForRun(scanRunId, link.link_url, false, {
        source: "none",
      });
      return res.json({ scanRunId, link_url: link.link_url, ignored: false });
    } catch (err: unknown) {
      console.error(
        "Error in POST /scan-runs/:scanRunId/scan-links/:scanLinkId/unignore",
        err,
      );
      return sendInternalError(res, "Failed to unignore scan link", err);
    }
  },
);

// Delete a site (and its scans/results)
app.delete("/sites/:siteId", async (req, res) => {
  const siteId = req.params.siteId;
  const userId = (req.query.userId as string) ?? DEMO_USER_ID;

  try {
    const site = await getSiteById(siteId);
    if (!site || site.user_id !== userId) {
      return sendApiError(
        res,
        404,
        "site_not_found",
        `No site found with id ${siteId}`,
      );
    }

    const deleted = await deleteSite(siteId);

    if (!deleted) {
      return sendApiError(
        res,
        500,
        "delete_failed",
        `Could not delete site ${siteId}`,
      );
    }

    return res.status(204).send();
  } catch (err: unknown) {
    console.error("Error deleting site", err);
    return sendInternalError(res, "Failed to delete site", err);
  }
});

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:3001`);
});
