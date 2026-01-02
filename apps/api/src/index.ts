import express from "express";
import cors from "cors";
import {
  getLatestScanForSite,
  getScanHistoryForSite,
} from "../../../packages/db/src/scans.js";

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
    console.error("Error in /sites/:siteId/scans/latest", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.get("/sites/:siteId/scans", async (req, res) => {
  const siteId = req.params.siteId;
  const limitParam = req.query.limit;

  let limit = 20;
  if (typeof limitParam === "string") {
    const parsed = Number(limitParam);
    if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 200) {
      limit = parsed;
    }
  }

  try {
    const history = await getScanHistoryForSite(siteId, limit);

    res.json({
      siteId,
      count: history.length,
      scans: history,
    });
  } catch (err) {
    console.error("Error in /sites/:siteId/scans", err);
    res.status(500).json({ error: "internal_error" });
  }
});

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
