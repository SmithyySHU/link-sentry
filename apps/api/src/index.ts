import dotenv from "dotenv";
import express from "express";
import type { Response } from "express";
import cors from "cors";
import type {
  ExportClassification,
  IgnoreRuleType,
  LinkClassification,
  ScanLinkOccurrenceRow,
} from "@scanlark/db";
import {
  applyIgnoreRulesForScanRun,
  cancelScanJob,
  cancelScanRun,
  createSiteForUser,
  createIgnoreRule,
  createScanRun,
  deleteIgnoreRule,
  deleteSiteForUser,
  enqueueScanJob,
  getDiffBetweenRunsForUser,
  getJobForScanRun,
  getLatestScanForSiteForUser,
  getOccurrencesForScanLinkForUser,
  getRecentScanRunsForSiteForUser,
  getRecentScansForSiteForUser,
  getResultsForScanRunForUser,
  getResultsSummaryForScanRunForUser,
  getScanLinkByIdForUser,
  getScanLinkByRunAndUrlForUser,
  getScanLinksForExportFilteredForUser,
  getScanLinksForExportForUser,
  getScanLinksForRunForUser,
  getScanLinksSummaryForUser,
  getScanRunByIdForUser,
  getScanRunById,
  getSiteByIdForUser,
  getSiteById,
  getSiteNotificationSettingsForUser,
  listSitesForUser,
  getSiteScheduleForUser,
  getTimeoutCountForRunForUser,
  getTopLinksByClassificationForUser,
  insertIgnoredOccurrence,
  getIgnoreRuleByIdForUser,
  listIgnoreRulesForUser,
  listIgnoreRulesForSiteForUser,
  listIgnoredLinksForRunForUser,
  listIgnoredOccurrencesForUser,
  setIgnoreRuleEnabled,
  setScanLinkIgnoredForRun,
  setScanRunStatus,
  updateSiteNotificationSettingsForUser,
  updateSiteScheduleForUser,
  updateScanLinkAfterRecheck,
  upsertIgnoredLink,
} from "@scanlark/db";
import validateLink from "../../../packages/crawler/src/validateLink";
import { classifyStatus } from "../../../packages/crawler/src/classifyStatus";
import { mountScanRunEvents } from "./routes/scanRunEvents";
import { serializeScanRun } from "./serializers";
import { notifyIfNeeded, sendTestEmail } from "./notifyOnScanComplete";
import { authMiddleware, initDemoAuth } from "./authMiddleware";
import { sessionMiddleware } from "./auth";
import { mountAuthRoutes } from "./routes/auth";
import { initEventRelay, mountEventStream } from "./events";

dotenv.config({ path: new URL("../../../.env", import.meta.url) });

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
const STATUS_FILTERS = new Set(["401/403/429", "404", "5xx", "no_response"]);
const EXPORT_SORT_OPTIONS = new Set([
  "severity",
  "occ_desc",
  "status_asc",
  "status_desc",
  "recent",
]);
const SCHEDULE_FREQUENCIES = new Set(["daily", "weekly"]);
const NOTIFY_ON_OPTIONS = new Set(["always", "issues", "never"]);
const EMAIL_TEST_TO = process.env.EMAIL_TEST_TO;
const API_INTERNAL_TOKEN = process.env.API_INTERNAL_TOKEN;

function isValidTimeUtc(value: string) {
  const parts = value.split(":");
  if (parts.length < 2) return false;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return false;
  if (hours < 0 || hours > 23) return false;
  if (minutes < 0 || minutes > 59) return false;
  return true;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

type ExportSortOption =
  | "severity"
  | "occ_desc"
  | "status_asc"
  | "status_desc"
  | "recent";
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

function parseStatusFilters(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.filter((part) => STATUS_FILTERS.has(part));
}

function parseSortOption(value: unknown): ExportSortOption {
  if (typeof value !== "string") return "severity";
  return EXPORT_SORT_OPTIONS.has(value)
    ? (value as ExportSortOption)
    : "severity";
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

function sendNotFound(res: Response) {
  return sendApiError(res, 404, "not_found", "Not found");
}

async function requireSiteForUser(
  req: express.Request,
  res: express.Response,
  siteId: string,
) {
  const userId = req.user?.id;
  if (!userId) {
    sendApiError(res, 401, "unauthorized", "Unauthorized");
    return null;
  }
  const site = await getSiteByIdForUser(userId, siteId);
  if (!site) {
    sendNotFound(res);
    return null;
  }
  return site;
}

async function requireScanRunForUser(
  req: express.Request,
  res: express.Response,
  scanRunId: string,
) {
  const userId = req.user?.id;
  if (!userId) {
    sendApiError(res, 401, "unauthorized", "Unauthorized");
    return null;
  }
  const run = await getScanRunByIdForUser(userId, scanRunId);
  if (!run) {
    sendNotFound(res);
    return null;
  }
  return { run };
}

function parseShowIgnored(value: unknown): boolean {
  return value === "true" || value === "1";
}

function csvEscape(value: unknown): string {
  const str = value == null ? "" : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

const app = express();

const corsOrigins = new Set(
  [process.env.WEB_ORIGIN, "http://localhost:5173", "http://localhost:3000"]
    .filter(Boolean)
    .map((origin) => origin as string),
);

const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (corsOrigins.has(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
};

app.set("trust proxy", 1);
app.options("*", cors(corsOptions));
app.use(cors(corsOptions));
app.use(express.json());
app.use(sessionMiddleware);

if (process.env.DEV_BYPASS_AUTH === "true") {
  void initDemoAuth();
}

mountAuthRoutes(app);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "scanlark-api" });
});

app.use(authMiddleware);

mountEventStream(app);
mountScanRunEvents(app);

app.get("/me", (req, res) => {
  if (!req.user) {
    return sendApiError(res, 401, "unauthorized", "Unauthorized");
  }
  return res.json({
    id: req.user.id,
    email: req.user.email,
    name: req.user.name,
  });
});

app.get("/sites", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const sites = await listSitesForUser(userId);

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

app.get("/sites/:siteId/schedule", async (req, res) => {
  const siteId = req.params.siteId;
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const schedule = await getSiteScheduleForUser(userId, siteId);
    if (!schedule) {
      return sendNotFound(res);
    }
    res.json({ siteId, ...schedule });
  } catch (err: unknown) {
    console.error("Error in GET /sites/:siteId/schedule", err);
    sendInternalError(res, "Failed to fetch schedule", err);
  }
});

app.put("/sites/:siteId/schedule", async (req, res) => {
  const siteId = req.params.siteId;
  const { enabled, frequency, timeUtc, dayOfWeek } = req.body ?? {};

  if (typeof enabled !== "boolean") {
    return sendApiError(res, 400, "invalid_enabled", "enabled must be boolean");
  }
  if (typeof frequency !== "string" || !SCHEDULE_FREQUENCIES.has(frequency)) {
    return sendApiError(
      res,
      400,
      "invalid_frequency",
      "frequency must be daily or weekly",
    );
  }
  if (typeof timeUtc !== "string" || !isValidTimeUtc(timeUtc)) {
    return sendApiError(res, 400, "invalid_time", "timeUtc must be HH:MM");
  }
  const frequencyValue = frequency === "daily" ? "daily" : "weekly";
  let resolvedDay: number | null = null;
  if (frequencyValue === "weekly") {
    if (typeof dayOfWeek !== "number" || dayOfWeek < 0 || dayOfWeek > 6) {
      return sendApiError(
        res,
        400,
        "invalid_day",
        "dayOfWeek must be 0-6 for weekly schedules",
      );
    }
    resolvedDay = dayOfWeek;
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const schedule = await updateSiteScheduleForUser(userId, siteId, {
      scheduleEnabled: enabled,
      scheduleFrequency: frequencyValue,
      scheduleTimeUtc: timeUtc,
      scheduleDayOfWeek: resolvedDay,
    });
    res.json({ siteId, ...schedule });
  } catch (err: unknown) {
    console.error("Error in PUT /sites/:siteId/schedule", err);
    sendInternalError(res, "Failed to update schedule", err);
  }
});

async function handleGetNotificationSettings(
  req: express.Request,
  res: express.Response,
) {
  const siteId = req.params.siteId;
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const settings = await getSiteNotificationSettingsForUser(userId, siteId);
    if (!settings) {
      return sendNotFound(res);
    }
    res.json({ siteId, ...settings });
  } catch (err: unknown) {
    console.error("Error in GET /sites/:siteId/notification-settings", err);
    sendInternalError(res, "Failed to fetch notification settings", err);
  }
}

async function handlePatchNotificationSettings(
  req: express.Request,
  res: express.Response,
) {
  const siteId = req.params.siteId;
  const { enabled, email, notifyOn, includeCsv } = req.body ?? {};

  const patch: {
    notifyEnabled?: boolean;
    notifyEmail?: string | null;
    notifyOn?: "always" | "issues" | "never";
    notifyIncludeCsv?: boolean;
  } = {};

  if (enabled !== undefined) {
    if (typeof enabled !== "boolean") {
      return sendApiError(
        res,
        400,
        "invalid_enabled",
        "enabled must be boolean",
      );
    }
    patch.notifyEnabled = enabled;
  }
  if (email !== undefined) {
    if (email != null && typeof email !== "string") {
      return sendApiError(res, 400, "invalid_email", "email must be a string");
    }
    if (email && !isValidEmail(email)) {
      return sendApiError(res, 400, "invalid_email", "email is invalid");
    }
    patch.notifyEmail = email ?? null;
  }
  if (notifyOn !== undefined) {
    if (typeof notifyOn !== "string" || !NOTIFY_ON_OPTIONS.has(notifyOn)) {
      return sendApiError(
        res,
        400,
        "invalid_notify_on",
        "notifyOn must be always, issues, or never",
      );
    }
    patch.notifyOn = notifyOn as "always" | "issues" | "never";
  }
  if (includeCsv !== undefined) {
    if (typeof includeCsv !== "boolean") {
      return sendApiError(
        res,
        400,
        "invalid_include_csv",
        "includeCsv must be boolean",
      );
    }
    patch.notifyIncludeCsv = includeCsv;
  }

  if (Object.keys(patch).length === 0) {
    return sendApiError(res, 400, "empty_patch", "No fields to update");
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const updated = await updateSiteNotificationSettingsForUser(
      userId,
      siteId,
      patch,
    );
    res.json({ siteId, ...updated });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "site_not_found") {
      return sendNotFound(res);
    }
    if (err instanceof Error && err.message === "invalid_notify_email") {
      return sendApiError(
        res,
        400,
        "invalid_notify_email",
        "notify_email is required when notifications are enabled and notifyOn is not never",
      );
    }
    console.error("Error in PATCH /sites/:siteId/notification-settings", err);
    sendInternalError(res, "Failed to update notification settings", err);
  }
}

app.get("/sites/:siteId/notification-settings", handleGetNotificationSettings);
app.patch(
  "/sites/:siteId/notification-settings",
  handlePatchNotificationSettings,
);

// Backwards-compatible routes for older clients
app.get("/sites/:siteId/notifications", handleGetNotificationSettings);

app.put("/sites/:siteId/notifications", async (req, res) => {
  const { enabled, email, onlyOnChange } = req.body ?? {};
  const notifyOn = onlyOnChange === false ? "always" : "issues";
  req.body = { enabled, email, notifyOn };
  await handlePatchNotificationSettings(req, res);
});

app.post("/sites/:siteId/notifications/test", async (req, res) => {
  const siteId = req.params.siteId;
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const site = await requireSiteForUser(req, res, siteId);
    if (!site) return;
    const settings = await getSiteNotificationSettingsForUser(userId, siteId);
    if (!settings) {
      return sendNotFound(res);
    }
    const target = EMAIL_TEST_TO || settings.notifyEmail;
    if (!target) {
      return sendApiError(
        res,
        400,
        "missing_email",
        "notify_email is required",
      );
    }
    await sendTestEmail(userId, siteId, target);
    res.json({ ok: true });
  } catch (err: unknown) {
    console.error("Error in POST /sites/:siteId/notifications/test", err);
    sendInternalError(res, "Failed to send test email", err);
  }
});

app.post("/scan-runs/:scanRunId/notify", async (req, res) => {
  const scanRunId = req.params.scanRunId;
  try {
    let userId = req.user?.id;
    let run = null;

    if (!userId) {
      const internalToken =
        typeof req.headers["x-internal-token"] === "string"
          ? req.headers["x-internal-token"]
          : "";
      if (!API_INTERNAL_TOKEN || internalToken !== API_INTERNAL_TOKEN) {
        return sendApiError(res, 401, "unauthorized", "Unauthorized");
      }
      const internalRun = await getScanRunById(scanRunId);
      if (!internalRun) {
        return sendNotFound(res);
      }
      const site = await getSiteById(internalRun.site_id);
      if (!site || !site.user_id) {
        return sendNotFound(res);
      }
      userId = site.user_id;
      run = internalRun;
    } else {
      const result = await requireScanRunForUser(req, res, scanRunId);
      if (!result) return;
      run = result.run;
    }

    await notifyIfNeeded(userId, scanRunId);
    res.json({ ok: true, status: run.status });
  } catch (err: unknown) {
    console.error("Error in POST /scan-runs/:scanRunId/notify", err);
    sendInternalError(res, "Failed to notify", err);
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
    const site = await requireSiteForUser(req, res, siteId);
    if (!site) return;
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const scans = await getRecentScansForSiteForUser(userId, siteId, limit);

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
    const site = await requireSiteForUser(req, res, siteId);
    if (!site) return;
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const runs = await getRecentScanRunsForSiteForUser(userId, siteId, limit);
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
    const site = await requireSiteForUser(req, res, siteId);
    if (!site) return;
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const latest = await getLatestScanForSiteForUser(userId, siteId);

    if (!latest) {
      return sendNotFound(res);
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
    const result = await requireScanRunForUser(req, res, scanRunId);
    if (!result) return;
    const { run } = result;

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
    const result = await requireScanRunForUser(req, res, scanRunId);
    if (!result) return;
    const { run } = result;
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }

    await applyIgnoreRulesForScanRun(scanRunId);

    const summaryRows = await getScanLinksSummaryForUser(userId, scanRunId);
    const timeoutCount = await getTimeoutCountForRunForUser(userId, scanRunId);
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

    const topBroken = await getTopLinksByClassificationForUser(
      userId,
      scanRunId,
      "broken",
      20,
    );
    const topBlocked = await getTopLinksByClassificationForUser(
      userId,
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
    const result = await requireScanRunForUser(req, res, scanRunId);
    if (!result) return;
    const job = await getJobForScanRun(scanRunId);
    if (job && job.status !== "completed") {
      await cancelScanJob(job.id);
    }
    await cancelScanRun(scanRunId);
    return res.json({ ok: true, status: "cancelled" });
  } catch (err: unknown) {
    console.error("Error in POST /scan-runs/:scanRunId/cancel", err);
    return sendInternalError(res, "Failed to cancel scan run", err);
  }
});

app.post("/scan-runs/:scanRunId/retry", async (req, res) => {
  const scanRunId = req.params.scanRunId;
  try {
    const result = await requireScanRunForUser(req, res, scanRunId);
    if (!result) return;
    const { run } = result;
    if (run.status !== "failed" && run.status !== "cancelled") {
      return sendApiError(
        res,
        400,
        "scan_run_not_retryable",
        "Scan run must be failed or cancelled to retry",
      );
    }
    const jobId = await enqueueScanJob({
      scanRunId,
      siteId: run.site_id,
    });
    await setScanRunStatus(scanRunId, "queued", {
      errorMessage: null,
      clearFinishedAt: true,
    });
    return res.json({ scanRunId, jobId, status: "queued" });
  } catch (err: unknown) {
    console.error("Error in POST /scan-runs/:scanRunId/retry", err);
    return sendInternalError(res, "Failed to retry scan run", err);
  }
});

// Create a new site
app.post("/sites", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const url = req.body.url as string | undefined;

    if (!url) {
      return sendApiError(res, 400, "missing_url", "Missing 'url' in body");
    }

    const site = await createSiteForUser(userId, url);

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
    const site = await requireSiteForUser(req, res, siteId);
    if (!site) return;
    const scanRunId = await createScanRun(siteId, body.startUrl);
    const jobId = await enqueueScanJob({ scanRunId, siteId });

    res.status(201).json({
      scanRunId,
      jobId,
      siteId,
      startUrl: body.startUrl,
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
    const result = await requireScanRunForUser(req, res, scanRunId);
    if (!result) return;
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const paginatedResults = await getResultsForScanRunForUser(
      userId,
      scanRunId,
      {
        limit,
        offset,
        classification,
      },
    );

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
    const result = await requireScanRunForUser(req, res, scanRunId);
    if (!result) return;
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const summary = await getResultsSummaryForScanRunForUser(userId, scanRunId);

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
    const result = await requireScanRunForUser(req, res, scanRunId);
    if (!result) return;
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const summary = await getScanLinksSummaryForUser(userId, scanRunId);
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
  const statusGroupRaw = req.query.statusGroup;
  const statusFiltersRaw = req.query.statusFilters;
  const searchRaw = req.query.search;
  const minOccurrencesRaw = req.query.minOccurrencesOnly;
  const sortRaw = req.query.sort;
  const showIgnoredRaw = req.query.showIgnored;
  const ignoredOnlyRaw = req.query.ignoredOnly;
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
    const result = await requireScanRunForUser(req, res, scanRunId);
    if (!result) return;
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    await applyIgnoreRulesForScanRun(scanRunId);
    const statusGroup = parseStatusGroup(statusGroupRaw);
    const statusFilters = parseStatusFilters(statusFiltersRaw);
    const searchQuery = typeof searchRaw === "string" ? searchRaw.trim() : "";
    const minOccurrencesOnly = minOccurrencesRaw === "true";
    const sortOption = parseSortOption(sortRaw);
    const showIgnored = showIgnoredRaw === "true";
    const ignoredOnly = ignoredOnlyRaw === "true";
    const useFiltered =
      statusGroupRaw ||
      statusFiltersRaw ||
      searchQuery ||
      minOccurrencesRaw ||
      sortRaw ||
      showIgnoredRaw ||
      ignoredOnlyRaw;
    const rows = useFiltered
      ? await getScanLinksForExportFilteredForUser(userId, scanRunId, {
          classification,
          statusGroup,
          statusFilters,
          searchQuery,
          minOccurrencesOnly,
          sortOption,
          showIgnored,
          ignoredOnly,
          limit,
        })
      : await getScanLinksForExportForUser(
          userId,
          scanRunId,
          classification,
          limit,
        );
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
  const statusGroupRaw = req.query.statusGroup;
  const statusFiltersRaw = req.query.statusFilters;
  const searchRaw = req.query.search;
  const minOccurrencesRaw = req.query.minOccurrencesOnly;
  const sortRaw = req.query.sort;
  const showIgnoredRaw = req.query.showIgnored;
  const ignoredOnlyRaw = req.query.ignoredOnly;
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
    const result = await requireScanRunForUser(req, res, scanRunId);
    if (!result) return;
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    await applyIgnoreRulesForScanRun(scanRunId);
    const statusGroup = parseStatusGroup(statusGroupRaw);
    const statusFilters = parseStatusFilters(statusFiltersRaw);
    const searchQuery = typeof searchRaw === "string" ? searchRaw.trim() : "";
    const minOccurrencesOnly = minOccurrencesRaw === "true";
    const sortOption = parseSortOption(sortRaw);
    const showIgnored = showIgnoredRaw === "true";
    const ignoredOnly = ignoredOnlyRaw === "true";
    const useFiltered =
      statusGroupRaw ||
      statusFiltersRaw ||
      searchQuery ||
      minOccurrencesRaw ||
      sortRaw ||
      showIgnoredRaw ||
      ignoredOnlyRaw;
    const rows = useFiltered
      ? await getScanLinksForExportFilteredForUser(userId, scanRunId, {
          classification,
          statusGroup,
          statusFilters,
          searchQuery,
          minOccurrencesOnly,
          sortOption,
          showIgnored,
          ignoredOnly,
          limit,
        })
      : await getScanLinksForExportForUser(
          userId,
          scanRunId,
          classification,
          limit,
        );
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
    const result = await requireScanRunForUser(req, res, scanRunId);
    if (!result) return;
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const diff = await getDiffBetweenRunsForUser(userId, scanRunId, compareTo);
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
    const runCheck = await requireScanRunForUser(req, res, scanRunId);
    if (!runCheck) return;
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const ignoredResult = await listIgnoredLinksForRunForUser(
      userId,
      scanRunId,
      limit,
      offset,
    );
    const serialized = ignoredResult.links.map((link) => ({
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
      countReturned: ignoredResult.countReturned,
      totalMatching: ignoredResult.totalMatching,
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
      const runCheck = await requireScanRunForUser(req, res, scanRunId);
      if (!runCheck) return;
      const userId = req.user?.id;
      if (!userId) {
        return sendApiError(res, 401, "unauthorized", "Unauthorized");
      }
      const result = await listIgnoredOccurrencesForUser(
        userId,
        ignoredLinkId,
        limit,
        offset,
      );
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
    const runCheck = await requireScanRunForUser(req, res, scanRunId);
    if (!runCheck) return;
    await applyIgnoreRulesForScanRun(scanRunId);

    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const paginatedLinks = await getScanLinksForRunForUser(userId, scanRunId, {
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
      const runCheck = await requireScanRunForUser(req, res, scanRunId);
      if (!runCheck) return;
      const linkUrl = decodeURIComponent(encodedLinkUrl);
      const userId = req.user?.id;
      if (!userId) {
        return sendApiError(res, 401, "unauthorized", "Unauthorized");
      }
      const scanLink = await getScanLinkByRunAndUrlForUser(
        userId,
        scanRunId,
        linkUrl,
      );
      const scanLinkId = scanLink?.id;
      const paginatedOccurrences = scanLinkId
        ? await getOccurrencesForScanLinkForUser(userId, scanLinkId, {
            limit,
            offset,
          })
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
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const link = await getScanLinkByIdForUser(userId, scanLinkId);
    if (!link) {
      return sendNotFound(res);
    }
    const result = await getOccurrencesForScanLinkForUser(userId, scanLinkId, {
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

app.post("/scan-links/:scanLinkId/recheck", async (req, res) => {
  const scanLinkId = req.params.scanLinkId;
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const link = await getScanLinkByIdForUser(userId, scanLinkId);
    if (!link) {
      return sendNotFound(res);
    }
    if (link.ignored) {
      return sendApiError(
        res,
        400,
        "scan_link_ignored",
        "Ignored links cannot be rechecked",
      );
    }

    const result = await validateLink(link.link_url);
    const statusCode = result.ok ? result.status : result.status;
    const classification = classifyStatus(
      link.link_url,
      statusCode ?? undefined,
    );
    const errorMessage = result.ok ? null : result.error;

    const updated = await updateScanLinkAfterRecheck({
      scanLinkId,
      classification,
      statusCode,
      errorMessage,
    });
    if (!updated) {
      return sendApiError(
        res,
        500,
        "scan_link_update_failed",
        "Failed to update scan link",
      );
    }
    const serialized = {
      ...updated,
      first_seen_at:
        updated.first_seen_at instanceof Date
          ? updated.first_seen_at.toISOString()
          : updated.first_seen_at,
      last_seen_at:
        updated.last_seen_at instanceof Date
          ? updated.last_seen_at.toISOString()
          : updated.last_seen_at,
      created_at:
        updated.created_at instanceof Date
          ? updated.created_at.toISOString()
          : updated.created_at,
      updated_at:
        updated.updated_at instanceof Date
          ? updated.updated_at.toISOString()
          : updated.updated_at,
      ignored_at:
        updated.ignored_at instanceof Date
          ? updated.ignored_at.toISOString()
          : updated.ignored_at,
    };
    return res.json({ scanLink: serialized });
  } catch (err: unknown) {
    console.error("Error in POST /scan-links/:scanLinkId/recheck", err);
    return sendInternalError(res, "Failed to recheck scan link", err);
  }
});

// Ignore rules (global list)
app.get("/ignore-rules", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const rules = await listIgnoreRulesForUser(userId);
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
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    if (siteId) {
      const site = await requireSiteForUser(req, res, siteId);
      if (!site) return;
    }
    const rule = await createIgnoreRule(userId, siteId, ruleType, pattern);
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
    const site = await requireSiteForUser(req, res, siteId);
    if (!site) return;
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const rules = await listIgnoreRulesForSiteForUser(userId, siteId);
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
    const site = await requireSiteForUser(req, res, siteId);
    if (!site) return;
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const rule = await createIgnoreRule(
      userId,
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
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const existingRule = await getIgnoreRuleByIdForUser(userId, ruleId);
    if (!existingRule) {
      return sendNotFound(res);
    }
    const updatedRule = await setIgnoreRuleEnabled(ruleId, isEnabled);
    if (!updatedRule)
      return sendApiError(
        res,
        404,
        "ignore_rule_not_found",
        "Ignore rule not found",
      );
    res.json({ rule: updatedRule });
  } catch (err: unknown) {
    console.error("Error in PATCH /ignore-rules/:ruleId", err);
    return sendInternalError(res, "Failed to update ignore rule", err);
  }
});

app.delete("/ignore-rules/:ruleId", async (req, res) => {
  const ruleId = req.params.ruleId;
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const rule = await getIgnoreRuleByIdForUser(userId, ruleId);
    if (!rule) {
      return sendNotFound(res);
    }
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
      const runCheck = await requireScanRunForUser(req, res, scanRunId);
      if (!runCheck) return;
      const { run } = runCheck;
      const userId = req.user?.id;
      if (!userId) {
        return sendApiError(res, 401, "unauthorized", "Unauthorized");
      }

      if (mode === "this_scan") {
        await setScanLinkIgnoredForRun(scanRunId, linkUrl, true, {
          reason: "Manually ignored",
          source: "manual",
        });
        const scanLink = await getScanLinkByRunAndUrlForUser(
          userId,
          scanRunId,
          linkUrl,
        );
        if (scanLink) {
          const ignored = await upsertIgnoredLink({
            scanRunId,
            linkUrl,
            ruleId: null,
            statusCode: scanLink.status_code,
            errorMessage: scanLink.error_message ?? undefined,
          });
          const occ = await getOccurrencesForScanLinkForUser(
            userId,
            scanLink.id,
            {
              limit: 1,
              offset: 0,
            },
          );
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
      const rule = await createIgnoreRule(
        userId,
        run.site_id,
        ruleType,
        linkUrl,
      );
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
      const runCheck = await requireScanRunForUser(req, res, scanRunId);
      if (!runCheck) return;
      const { run } = runCheck;
      const userId = req.user?.id;
      if (!userId) {
        return sendApiError(res, 401, "unauthorized", "Unauthorized");
      }

      const link = await getScanLinkByIdForUser(userId, scanLinkId);
      if (!link || link.scan_run_id !== scanRunId) {
        return sendNotFound(res);
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
        const occ = await getOccurrencesForScanLinkForUser(userId, link.id, {
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
      const rule = await createIgnoreRule(
        userId,
        run.site_id,
        ruleType,
        link.link_url,
      );
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
      const runCheck = await requireScanRunForUser(req, res, scanRunId);
      if (!runCheck) return;
      const userId = req.user?.id;
      if (!userId) {
        return sendApiError(res, 401, "unauthorized", "Unauthorized");
      }
      const link = await getScanLinkByRunAndUrlForUser(
        userId,
        scanRunId,
        linkUrl,
      );
      if (!link) return sendNotFound(res);
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
    const runCheck = await requireScanRunForUser(req, res, scanRunId);
    if (!runCheck) return;
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
      const runCheck = await requireScanRunForUser(req, res, scanRunId);
      if (!runCheck) return;
      const userId = req.user?.id;
      if (!userId) {
        return sendApiError(res, 401, "unauthorized", "Unauthorized");
      }
      const link = await getScanLinkByIdForUser(userId, scanLinkId);
      if (!link || link.scan_run_id !== scanRunId) {
        return sendNotFound(res);
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
  const userId = req.user?.id;

  try {
    if (!userId) {
      return sendApiError(res, 401, "unauthorized", "Unauthorized");
    }
    const site = await getSiteByIdForUser(userId, siteId);
    if (!site) {
      return sendNotFound(res);
    }

    const deleted = await deleteSiteForUser(siteId, userId);

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

void initEventRelay().catch((err) => {
  console.error("Failed to start event relay", err);
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:3001`);
});
