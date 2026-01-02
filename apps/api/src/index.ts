import express from "express";
import cors from "cors";

import {
  getLatestScanForSite,
  getRecentScansForSite,
} from "../../../packages/db/src/scans.js";
import { getResultsForScanRun } from "../../../packages/db/src/scanResults.js";
import { runScanForSite } from "../../../packages/crawler/src/scanService.js";

const API_BASE = "http://localhost:3001";
const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "link-sentry-api" });
});

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
      scans,
    });
  } catch (err) {
    console.error("Error in GET /sites/:siteId/scans", err);
    res.status(500).json({ error: "internal_error" });
  }
});

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

    res.json(latest);
  } catch (err) {
    console.error("Error in GET /sites/:siteId/scans/latest", err);
    res.status(500).json({ error: "internal_error" });
  }
});

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
    const summary = await runScanForSite(siteId, body.startUrl);

    res.status(201).json({
      scanRunId: summary.scanRunId,
      siteId,
      startUrl: body.startUrl,
      totalLinks: summary.totalLinks,
      checkedLinks: summary.checkedLinks,
      brokenLinks: summary.brokenLinks,
    });
  } catch (err) {
    console.error("Error in POST /sites/:siteId/scans", err);
    res.status(500).json({ error: "internal_error" });
  }
});

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

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
