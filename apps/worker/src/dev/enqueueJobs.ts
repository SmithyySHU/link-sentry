import { enqueueScanJob } from "@scanlark/db";

const siteId = process.env.SITE_ID;
const countRaw = process.env.JOBS_COUNT ?? "5";
const count = Number(countRaw);

if (!siteId) {
  console.error("SITE_ID must be set to enqueue test jobs.");
  process.exit(1);
}

const siteIdValue = siteId;

if (!Number.isFinite(count) || count <= 0) {
  console.error(`JOBS_COUNT must be a positive number (got ${countRaw}).`);
  process.exit(1);
}

async function main() {
  const now = Date.now();
  const jobIds: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const runAt = new Date(now + i * 1000);
    const jobId = await enqueueScanJob({
      siteId: siteIdValue,
      scanRunId: null,
      runAt,
    });
    jobIds.push(jobId);
  }
  console.log(`Enqueued ${jobIds.length} jobs for site=${siteIdValue}`);
  for (const jobId of jobIds) {
    console.log(`- ${jobId}`);
  }
}

main().catch((err) => {
  console.error("Failed to enqueue jobs", err);
  process.exit(1);
});
