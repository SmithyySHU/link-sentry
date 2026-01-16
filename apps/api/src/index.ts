import express from "express";
import cors from "cors";
import type { ScanRunRow } from "../../../packages/db/src/scans";
import type { LinkClassification } from "../../../packages/db/src/scanRuns.js";
import type { ScanLinkOccurrenceRow } from "../../../packages/db/src/scanLinksDedup.js";

import {
  getLatestScanForSite,
  getRecentScansForSite,
  getScanRunById,
} from "../../../packages/db/src/scans";

import {
  getSitesForUser,
  getSiteById,
  createSite,
  deleteSite,
} from "../../../packages/db/src/sites.js";

import { getResultsForScanRun, getResultsSummaryForScanRun } from "../../../packages/db/src/scanResults.js";
import {
  getScanLinksForRun,
  getOccurrencesForScanLink,
} from "../../../packages/db/src/scanLinksDedup.js";
import { runScanForSite } from "../../../packages/crawler/src/scanService.js";

import { mountScanRunEvents } from "./routes/scanRunEvents";

const DEMO_USER_ID = "00000000-0000-0000-0000-000000000000";
const LINK_CLASSIFICATIONS = new Set<LinkClassification>(["ok", "broken", "blocked"]);

// Helper to serialize ScanRunRow for JSON response
function serializeScanRun(run: ScanRunRow) {
  return {
    id: run.id,
    site_id: run.site_id,
    status: run.status,
    started_at: run.started_at instanceof Date ? run.started_at.toISOString() : run.started_at,
    finished_at: run.finished_at instanceof Date ? run.finished_at.toISOString() : run.finished_at,
    start_url: run.start_url,
    total_links: run.total_links,
    checked_links: run.checked_links,
    broken_links: run.broken_links,
  };
}

function parseClassification(value: unknown): LinkClassification | undefined {
  if (typeof value !== "string") return undefined;
  return LINK_CLASSIFICATIONS.has(value as LinkClassification) ? (value as LinkClassification) : undefined;
}

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
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
    res.status(500).json({
      error: "Failed to fetch sites",
      details: getErrorMessage(err),
    });
  }
});

// Recent scans for a site
app.get("/sites/:siteId/scans", async (req, res) => {
  const siteId = req.params.siteId;
  const limitRaw = req.query.limit;
  const limit = limitRaw ? Number(limitRaw) : 10;

  if (Number.isNaN(limit) || limit <= 0) {
    return res.status(400).json({ error: "invalid_limit" });
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
    res.status(500).json({ error: "internal_error" });
  }
});

// Latest scan for a site
app.get("/sites/:siteId/scans/latest", async (req, res) => {
  const siteId = req.params.siteId;

  try {
    const latest = await getLatestScanForSite(siteId);

    if (!latest) {
      return res.status(404).json({
        error: "no_scans_for_site",
        message: `No scans found for site ${siteId}`,
      });
    }

    res.json(serializeScanRun(latest));
  } catch (err: unknown) {
    console.error("Error in GET /sites/:siteId/scans/latest", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// NEW: Get a scan run by id (live progress polling)
app.get("/scan-runs/:scanRunId", async (req, res) => {
  const scanRunId = req.params.scanRunId;

  try {
    const run = await getScanRunById(scanRunId);

    if (!run) {
      return res.status(404).json({
        error: "scan_run_not_found",
        message: `No scan run found with id ${scanRunId}`,
      });
    }

    const serialized = serializeScanRun(run);
    return res.json(serialized);
  } catch (err: unknown) {
    console.error("Error in GET /scan-runs/:scanRunId", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// Create a new site
app.post("/sites", async (req, res) => {
  try {
    const userId = (req.body.userId as string) ?? DEMO_USER_ID;
    const url = req.body.url as string | undefined;

    if (!url) {
      return res.status(400).json({
        error: "missing_url",
        message: "Missing 'url' in body",
      });
    }

    const site = await createSite(userId, url);

    res.status(201).json({ site });
  } catch (err: unknown) {
    console.error("Error creating site", err);
    res.status(500).json({
      error: "Failed to create site",
      details: getErrorMessage(err),
    });
  }
});

// Trigger a new scan
app.post("/sites/:siteId/scans", async (req, res) => {
  const siteId = req.params.siteId;
  const body = req.body as { startUrl?: string };

  if (!body.startUrl || typeof body.startUrl !== "string") {
    return res.status(400).json({
      error: "invalid_start_url",
      message: "body.startUrl must be a non-empty string",
    });
  }

  try {
    // Get the scanRunId synchronously (from createScanRun)
    const { getScanRunIdOnly } = await import("../../../packages/crawler/src/scanService.js");
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
    res.status(500).json({ error: "internal_error" });
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
    return res.status(400).json({ error: "invalid_limit" });
  }

  if (Number.isNaN(offset) || offset < 0) {
    return res.status(400).json({ error: "invalid_offset" });
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
    res.status(500).json({ error: "internal_error" });
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
    res.status(500).json({ error: "internal_error" });
  }
});

// ✅ NEW: Get unique links (deduplicated) from a scan run
app.get("/scan-runs/:scanRunId/links", async (req, res) => {
  const scanRunId = req.params.scanRunId;
  const limitRaw = req.query.limit;
  const offsetRaw = req.query.offset;
  const classificationRaw = req.query.classification;

  const limit = limitRaw ? Number(limitRaw) : 200;
  const offset = offsetRaw ? Number(offsetRaw) : 0;
  const classification = parseClassification(classificationRaw);

  if (Number.isNaN(limit) || limit <= 0) {
    return res.status(400).json({ error: "invalid_limit" });
  }

  if (Number.isNaN(offset) || offset < 0) {
    return res.status(400).json({ error: "invalid_offset" });
  }

  try {
    const paginatedLinks = await getScanLinksForRun(scanRunId, {
      limit,
      offset,
      classification,
    });

    // Serialize Date fields to ISO strings
    const serializedLinks = paginatedLinks.links.map((link) => ({
      ...link,
      first_seen_at: link.first_seen_at instanceof Date ? link.first_seen_at.toISOString() : link.first_seen_at,
      last_seen_at: link.last_seen_at instanceof Date ? link.last_seen_at.toISOString() : link.last_seen_at,
      created_at: link.created_at instanceof Date ? link.created_at.toISOString() : link.created_at,
      updated_at: link.updated_at instanceof Date ? link.updated_at.toISOString() : link.updated_at,
    }));

    res.json({
      scanRunId,
      classification,
      countReturned: paginatedLinks.countReturned,
      totalMatching: paginatedLinks.totalMatching,
      links: serializedLinks,
    });
  } catch (err: unknown) {
    console.error("Error in GET /scan-runs/:scanRunId/links", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// ✅ NEW: Get occurrences of a specific link
app.get("/scan-runs/:scanRunId/links/:scanLinkId/occurrences", async (req, res) => {
  const scanRunId = req.params.scanRunId;
  const scanLinkId = req.params.scanLinkId;
  const limitRaw = req.query.limit;
  const offsetRaw = req.query.offset;

  const limit = limitRaw ? Number(limitRaw) : 100;
  const offset = offsetRaw ? Number(offsetRaw) : 0;

  if (Number.isNaN(limit) || limit <= 0) {
    return res.status(400).json({ error: "invalid_limit" });
  }

  if (Number.isNaN(offset) || offset < 0) {
    return res.status(400).json({ error: "invalid_offset" });
  }

  try {
    const paginatedOccurrences = await getOccurrencesForScanLink(scanLinkId, {
      limit,
      offset,
    });

    // Serialize Date fields to ISO strings
    const serializedOccurrences = paginatedOccurrences.occurrences.map((occ: ScanLinkOccurrenceRow) => ({
      ...occ,
      created_at: occ.created_at instanceof Date ? occ.created_at.toISOString() : occ.created_at,
    }));

    res.json({
      scanRunId,
      scanLinkId,
      countReturned: paginatedOccurrences.countReturned,
      totalMatching: paginatedOccurrences.totalMatching,
      occurrences: serializedOccurrences,
    });
  } catch (err: unknown) {
    console.error("Error in GET /scan-runs/:scanRunId/links/:scanLinkId/occurrences", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// ✅ NEW: Get occurrences of a specific scan link (direct route without scanRunId)
// curl -s "http://localhost:3001/scan-links/<scanLinkId>/occurrences?limit=5&offset=0"
app.get("/scan-links/:scanLinkId/occurrences", async (req, res) => {
  const scanLinkId = req.params.scanLinkId;
  if (!scanLinkId) {
    return res.status(400).json({ error: "missing_scan_link_id" });
  }
  const limitRaw = req.query.limit;
  const offsetRaw = req.query.offset;

  const limit = limitRaw ? Number(limitRaw) : 50;
  const offset = offsetRaw ? Number(offsetRaw) : 0;

  if (Number.isNaN(limit) || limit <= 0) {
    return res.status(400).json({ error: "invalid_limit" });
  }

  if (Number.isNaN(offset) || offset < 0) {
    return res.status(400).json({ error: "invalid_offset" });
  }

  try {
    const result = await getOccurrencesForScanLink(scanLinkId, {
      limit,
      offset,
    });

    // Serialize Date fields to ISO strings
    const serializedOccurrences = result.occurrences.map((occ) => ({
      ...occ,
      created_at: occ.created_at instanceof Date ? occ.created_at.toISOString() : occ.created_at,
    }));

    res.json({
      scanLinkId: result.scanLinkId,
      countReturned: result.countReturned,
      totalMatching: result.totalMatching,
      occurrences: serializedOccurrences,
    });
  } catch (err: unknown) {
    console.error("Error in GET /scan-links/:scanLinkId/occurrences", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Delete a site (and its scans/results)
app.delete("/sites/:siteId", async (req, res) => {
  const siteId = req.params.siteId;
  const userId = (req.query.userId as string) ?? DEMO_USER_ID;

  try {
    const site = await getSiteById(siteId);
    if (!site || site.user_id !== userId) {
      return res.status(404).json({
        error: "site_not_found",
        message: `No site found with id ${siteId}`,
      });
    }

    const deleted = await deleteSite(siteId);

    if (!deleted) {
      return res.status(500).json({
        error: "delete_failed",
        message: `Could not delete site ${siteId}`,
      });
    }

    return res.status(204).send();
  } catch (err: unknown) {
    console.error("Error deleting site", err);
    return res.status(500).json({
      error: "Failed to delete site",
      details: getErrorMessage(err),
    });
  }
});

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:3001`);
});       