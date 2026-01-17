import * as os from "node:os";
import {
  cancelScanJob,
  claimNextScanJob,
  completeScanJob,
  createScanRun,
  enqueueScanJob,
  failScanJob,
  getDueSites,
  getLatestScanForSite,
  getJobForScanRun,
  getScanRunById,
  markSiteScheduled,
  setScanRunStatus,
} from "@link-sentry/db";
import { runScanForSite } from "../../../packages/crawler/src/scanService.js";

const workerId = `${os.hostname()}-${process.pid}`;
const IDLE_WAIT_MS = 1200;
const SCHEDULE_TICK_MS = 60000;
const SCHEDULE_COOLDOWN_MS = 60000;
const API_BASE_URL = process.env.WORKER_API_BASE || "http://localhost:3001";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processJob() {
  const job = await claimNextScanJob({ workerId });
  if (!job) return false;

  const run = await getScanRunById(job.scan_run_id);
  if (!run) {
    await failScanJob(job.id, "scan_run_not_found");
    return true;
  }

  await setScanRunStatus(job.scan_run_id, "in_progress", {
    errorMessage: null,
    clearFinishedAt: true,
  });

  try {
    await runScanForSite(run.site_id, run.start_url, run.id);
    const updatedRun = await getScanRunById(run.id);
    if (updatedRun?.status === "cancelled") {
      await cancelScanJob(job.id);
      return true;
    }
    if (updatedRun?.status === "failed") {
      const errorMessage = updatedRun.error_message ?? "scan_failed";
      await failScanJob(job.id, errorMessage);
      if (job.attempts >= job.max_attempts) {
        await setScanRunStatus(run.id, "failed", {
          errorMessage,
          setFinishedAt: true,
        });
        await notifyScanRun(run.id);
      } else {
        await setScanRunStatus(run.id, "queued", {
          errorMessage,
          clearFinishedAt: true,
        });
      }
      return true;
    }
    await completeScanJob(job.id);
    await notifyScanRun(run.id);
    return true;
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "scan_failed_unexpected";
    await failScanJob(job.id, errorMessage);
    if (job.attempts >= job.max_attempts) {
      await setScanRunStatus(run.id, "failed", {
        errorMessage,
        setFinishedAt: true,
      });
      await notifyScanRun(run.id);
    } else {
      await setScanRunStatus(run.id, "queued", {
        errorMessage,
        clearFinishedAt: true,
      });
    }
    return true;
  } finally {
    const latestJob = await getJobForScanRun(job.scan_run_id);
    if (latestJob?.status === "cancelled") {
      await setScanRunStatus(job.scan_run_id, "cancelled", {
        errorMessage: latestJob.last_error ?? null,
        setFinishedAt: true,
      });
    }
  }
}

async function notifyScanRun(scanRunId: string) {
  try {
    const res = await fetch(
      `${API_BASE_URL}/scan-runs/${encodeURIComponent(scanRunId)}/notify`,
      { method: "POST" },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(
        `[worker ${workerId}] notify failed ${res.status}: ${text.slice(0, 120)}`,
      );
    }
  } catch (err) {
    console.warn(`[worker ${workerId}] notify error`, err);
  }
}

async function runLoop() {
  console.log(`[worker ${workerId}] started`);
  while (true) {
    const didWork = await processJob();
    if (!didWork) {
      await sleep(IDLE_WAIT_MS);
    }
  }
}

async function schedulerTick() {
  const now = new Date();
  const dueSites = await getDueSites(25);
  let enqueued = 0;
  let skipped = 0;

  for (const site of dueSites) {
    if (
      site.last_scheduled_at &&
      now.getTime() - site.last_scheduled_at.getTime() < SCHEDULE_COOLDOWN_MS
    ) {
      skipped += 1;
      continue;
    }

    const latestRun = await getLatestScanForSite(site.id);
    if (
      latestRun &&
      (latestRun.status === "queued" || latestRun.status === "in_progress")
    ) {
      skipped += 1;
      continue;
    }

    const scanRunId = await createScanRun(site.id, site.url);
    await enqueueScanJob({ scanRunId, siteId: site.id });
    await markSiteScheduled(site.id, now);
    enqueued += 1;
  }

  console.log(
    `[scheduler] due=${dueSites.length} enqueued=${enqueued} skipped=${skipped}`,
  );
}

async function runSchedulerLoop() {
  console.log(`[scheduler ${workerId}] started`);
  while (true) {
    try {
      await schedulerTick();
    } catch (err) {
      console.error(`[scheduler ${workerId}] error`, err);
    }
    await sleep(SCHEDULE_TICK_MS);
  }
}

runLoop().catch((err) => {
  console.error(`[worker ${workerId}] fatal`, err);
  process.exit(1);
});

runSchedulerLoop().catch((err) => {
  console.error(`[scheduler ${workerId}] fatal`, err);
});
