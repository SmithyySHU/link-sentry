import express from "express";
import cors from "cors";
import type { ScanRunRow } from "../../../packages/db/src/scans";



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

import { getResultsForScanRun } from "../../../packages/db/src/scanResults.js";
import { runScanForSite } from "../../../packages/crawler/src/scanService.js";

import { mountScanRunEvents } from "./routes/scanRunEvents";

const DEMO_USER_ID = "00000000-0000-0000-0000-000000000000";

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
  } catch (err: any) {
    console.error("Error fetching sites", err);
    res.status(500).json({
      error: "Failed to fetch sites",
      details: err?.message ?? String(err),
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
  } catch (err) {
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
  } catch (err) {
    console.error("Error in GET /sites/:siteId/scans/latest", err);
    res.status(500).json({ error: "internal_error" });
  }
});


// NEW: Get a scan run by id (live progress polling)
app.get("/scan-runs/:scanRunId", async (req, res) => {
  const scanRunId = req.params.scanRunId;
  console.log("[api] GET /scan-runs/:scanRunId", scanRunId);

  try {
    const run = await getScanRunById(scanRunId);

    if (!run) {
      console.log("[api] Scan run not found:", scanRunId);
      return res.status(404).json({
        error: "scan_run_not_found",
        message: `No scan run found with id ${scanRunId}`,
      });
    }

    const serialized = serializeScanRun(run);
    console.log("[api] Returning scan run:", serialized);
    return res.json(serialized);
  } catch (err) {
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
  } catch (err: any) {
    console.error("Error creating site", err);
    res.status(500).json({
      error: "Failed to create site",
      details: err?.message ?? String(err),
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
  } catch (err) {
    console.error("Error in POST /sites/:siteId/scans", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Results for a scan run
app.get("/scan-runs/:scanRunId/results", async (req, res) => {
  const scanRunId = req.params.scanRunId;
  const limitRaw = req.query.limit;
  const offsetRaw = req.query.offset;

  const limit = limitRaw ? Number(limitRaw) : 200;
  const offset = offsetRaw ? Number(offsetRaw) : 0;

  if (Number.isNaN(limit) || limit <= 0) {
    return res.status(400).json({ error: "invalid_limit" });
  }

  if (Number.isNaN(offset) || offset < 0) {
    return res.status(400).json({ error: "invalid_offset" });
  }

  try {
    const results = await getResultsForScanRun(scanRunId, { limit, offset });

    res.json({
      scanRunId,
      count: results.length,
      results,
    });
  } catch (err) {
    console.error("Error in GET /scan-runs/:scanRunId/results", err);
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
  } catch (err: any) {
    console.error("Error deleting site", err);
    return res.status(500).json({
      error: "Failed to delete site",
      details: err?.message ?? String(err),
    });
  }
});

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
