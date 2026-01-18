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
  getSiteById,
  hasActiveJobForSite,
  markSiteScheduled,
  requeueExpiredScanJobs,
  setScanRunStatus,
  setScanJobRunId,
} from "@link-sentry/db";
import { runScanForSite } from "../../../packages/crawler/src/scanService.js";

const workerId = `${os.hostname()}-${process.pid}`;
const IDLE_WAIT_MS = 1200;
const SCHEDULE_TICK_MS = 60000;
const SCHEDULE_COOLDOWN_MS = 60000;
const CLAIM_LEASE_SECONDS = 120;
const REAPER_TICK_MS = 120000;
const API_BASE_URL = process.env.WORKER_API_BASE || "http://localhost:3001";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logJobEvent(
  event: string,
  job: { id: string; site_id: string; scan_run_id: string | null },
  details?: string,
) {
  const suffix = details ? ` ${details}` : "";
  console.log(
    `[worker ${workerId}] ${event} job=${job.id} site=${job.site_id} run=${job.scan_run_id ?? "none"}${suffix}`,
  );
}

async function processJob() {
  const job = await claimNextScanJob({
    workerId,
    leaseSeconds: CLAIM_LEASE_SECONDS,
  });
  if (!job) return false;

  logJobEvent("claimed", job, `attempts=${job.attempts}/${job.max_attempts}`);

  let scanRunId = job.scan_run_id;
  let run = scanRunId ? await getScanRunById(scanRunId) : null;
  if (!run) {
    const site = await getSiteById(job.site_id);
    if (!site) {
      const failedJob = await failScanJob(job.id, "site_not_found");
      if (failedJob) {
        logJobEvent("failed", failedJob, "error=site_not_found");
      }
      return true;
    }
    scanRunId = await createScanRun(site.id, site.url);
    await setScanJobRunId(job.id, scanRunId);
    run = await getScanRunById(scanRunId);
  }

  if (!run) {
    const failedJob = await failScanJob(job.id, "scan_run_not_found");
    if (failedJob) {
      logJobEvent("failed", failedJob, "error=scan_run_not_found");
    }
    return true;
  }

  await setScanRunStatus(run.id, "in_progress", {
    errorMessage: null,
    clearFinishedAt: true,
  });
  logJobEvent("started", { ...job, scan_run_id: run.id });

  try {
    await runScanForSite(run.site_id, run.start_url, run.id);
    const updatedRun = await getScanRunById(run.id);
    if (updatedRun?.status === "cancelled") {
      await cancelScanJob(job.id);
      logJobEvent("cancelled", { ...job, scan_run_id: run.id });
      return true;
    }
    if (updatedRun?.status === "failed") {
      const errorMessage = updatedRun.error_message ?? "scan_failed";
      const exhausted = job.attempts >= job.max_attempts;
      const failedJob = await failScanJob(job.id, errorMessage);
      if (failedJob) {
        logJobEvent(
          exhausted ? "failed" : "requeued",
          { ...failedJob, scan_run_id: run.id },
          `error=${errorMessage}`,
        );
      }
      if (exhausted) {
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
    const completedJob = await completeScanJob(job.id);
    if (completedJob) {
      logJobEvent("completed", { ...completedJob, scan_run_id: run.id });
    }
    await notifyScanRun(run.id);
    return true;
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "scan_failed_unexpected";
    const exhausted = job.attempts >= job.max_attempts;
    const failedJob = await failScanJob(job.id, errorMessage);
    if (failedJob) {
      logJobEvent(
        exhausted ? "failed" : "requeued",
        { ...failedJob, scan_run_id: run.id },
        `error=${errorMessage}`,
      );
    }
    if (exhausted) {
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
    const latestJob = await getJobForScanRun(run.id);
    if (latestJob?.status === "cancelled") {
      await setScanRunStatus(run.id, "cancelled", {
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

async function reapLoop() {
  console.log(`[reaper ${workerId}] started`);
  while (true) {
    const recovered = await requeueExpiredScanJobs();
    for (const job of recovered) {
      logJobEvent(
        "abandoned-recovered",
        job,
        `attempts=${job.attempts}/${job.max_attempts}`,
      );
    }
    await sleep(REAPER_TICK_MS);
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

    const hasActiveJob = await hasActiveJobForSite(site.id);
    if (hasActiveJob) {
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

reapLoop().catch((err) => {
  console.error(`[reaper ${workerId}] fatal`, err);
});

runSchedulerLoop().catch((err) => {
  console.error(`[scheduler ${workerId}] fatal`, err);
});
