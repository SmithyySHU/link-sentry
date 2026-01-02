import express from "express";
import cors from "cors";
import {
  getLatestScanForSite,
  getScanHistoryForSite,
} from "../../../packages/db/src/scans.js";
import { runScanForSite } from "../../../packages/crawler/src/scanService.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "link-sentry-api" });
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

app.get("/sites/:siteId/scans", async (req, res) => {
  const siteId = req.params.siteId;
  const limitParam = req.query.limit;
  let limit = 20;

  if (typeof limitParam === "string") {
    const parsed = Number.parseInt(limitParam, 10);
    if (!Number.isNaN(parsed)) {
      limit = Math.min(Math.max(parsed, 1), 200);
    }
  }

  try {
    const scans = await getScanHistoryForSite(siteId, limit);
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

app.post("/sites/:siteId/scans", async (req, res) => {
  const siteId = req.params.siteId;
  const body = req.body ?? {};
  const startUrl = body.startUrl;

  if (!startUrl || typeof startUrl !== "string") {
    return res.status(400).json({
      error: "invalid_request",
      message: "startUrl is required in the request body",
    });
  }

  try {
    new URL(startUrl);
  } catch {
    return res.status(400).json({
      error: "invalid_url",
      message: "startUrl must be a valid URL",
    });
  }

  try {
    const summary = await runScanForSite(siteId, startUrl);

    res.status(202).json({
      scanRunId: summary.scanRunId,
      siteId,
      startUrl,
      totalLinks: summary.totalLinks,
      checkedLinks: summary.checkedLinks,
      brokenLinks: summary.brokenLinks,
    });
  } catch (err) {
    console.error("Error in POST /sites/:siteId/scans", err);
    res.status(500).json({ error: "scan_failed" });
  }
});

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
