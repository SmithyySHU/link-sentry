import {
  getLinkCountsForRun,
  getNewLinksSinceLastNotified,
  getPreviousCompletedRunId,
  getScanRunById,
  getSiteById,
  getSiteNotificationSettings,
  hasNotificationEvent,
  recordNotificationEvent,
  setLastNotifiedScanRunId,
} from "@link-sentry/db";
import { sendEmail } from "./email";

const APP_URL = process.env.APP_URL || "http://localhost:3000";

function formatCount(value: number) {
  return value === 1 ? "1 link" : `${value} links`;
}

function renderLinks(
  title: string,
  rows: Array<{
    link_url: string;
    status_code: number | null;
    error_message: string | null;
    occurrence_count: number;
  }>,
) {
  if (rows.length === 0) return "";
  const items = rows
    .map((row) => {
      const status = row.status_code ?? row.error_message ?? "No response";
      return `<li><code>${row.link_url}</code> — ${status} (${row.occurrence_count}x)</li>`;
    })
    .join("");
  return `<h3>${title}</h3><ul>${items}</ul>`;
}

export async function notifyIfNeeded(scanRunId: string): Promise<void> {
  const run = await getScanRunById(scanRunId);
  if (!run) return;

  const site = await getSiteById(run.site_id);
  if (!site) return;

  const settings = await getSiteNotificationSettings(run.site_id);
  if (!settings || !settings.notifyEnabled || !settings.notifyEmail) return;

  const toEmail = settings.notifyEmail;
  const alreadySent = await hasNotificationEvent({
    siteId: run.site_id,
    scanRunId: run.id,
    kind: run.status === "failed" ? "scan_failed" : "scan_completed",
  });
  if (alreadySent) return;

  if (run.status === "failed") {
    const subject = `Link-Sentry: ${site.url} — scan failed`;
    const html = `
      <p><strong>Scan failed</strong> for ${site.url}</p>
      <p>Started: ${run.started_at.toISOString()}</p>
      <p>Error: ${run.error_message ?? "Unknown error"}</p>
      <p><a href="${APP_URL}">View in dashboard</a></p>
    `;
    await sendEmail({ to: toEmail, subject, html });
    await recordNotificationEvent({
      siteId: run.site_id,
      scanRunId: run.id,
      kind: "scan_failed",
      toEmail,
      subject,
      payload: { status: run.status, error: run.error_message },
    });
    return;
  }

  if (run.status !== "completed") return;

  const previousRunId =
    settings.lastNotifiedScanRunId ||
    (await getPreviousCompletedRunId(run.site_id, run.id));
  const deltas = await getNewLinksSinceLastNotified(run.id, previousRunId, 50);
  const counts = await getLinkCountsForRun(run.id);

  const newBrokenCount = deltas.newBroken.length + deltas.newNoResponse.length;
  const newBlockedCount = deltas.newBlocked.length;

  const includeBroken = settings.notifyIncludeBroken;
  const includeBlocked = settings.notifyIncludeBlocked;
  const hasChanges =
    (includeBroken && newBrokenCount > 0) ||
    (includeBlocked && newBlockedCount > 0);

  if (settings.notifyOnlyOnChange && !hasChanges) return;

  const subject = `Link-Sentry: ${site.url} — ${newBrokenCount} new broken, ${newBlockedCount} new blocked`;
  const brokenRows = includeBroken
    ? [...deltas.newBroken, ...deltas.newNoResponse]
    : [];
  const blockedRows = includeBlocked ? deltas.newBlocked : [];

  const html = `
    <p><strong>Scan complete</strong> for ${site.url}</p>
    <p>Started: ${run.started_at.toISOString()}</p>
    <p>Totals: ${counts.brokenCount} broken, ${counts.blockedCount} blocked, ${
      counts.noResponseCount
    } no response</p>
    ${renderLinks("New broken / no response", brokenRows)}
    ${renderLinks("New blocked", blockedRows)}
    <p><a href="${APP_URL}">View in dashboard</a></p>
  `;

  await sendEmail({ to: toEmail, subject, html });
  await recordNotificationEvent({
    siteId: run.site_id,
    scanRunId: run.id,
    kind: "scan_completed",
    toEmail,
    subject,
    payload: {
      newBroken: newBrokenCount,
      newBlocked: newBlockedCount,
      totals: counts,
      previousRunId,
    },
  });
  await setLastNotifiedScanRunId(run.site_id, run.id);
}

export async function sendTestEmail(
  siteId: string,
  toEmail: string,
): Promise<void> {
  const site = await getSiteById(siteId);
  if (!site) throw new Error("site_not_found");
  const subject = `Link-Sentry: test email for ${site.url}`;
  const html = `
    <p>This is a test email for ${site.url}.</p>
    <p>If you see this, your email settings are working.</p>
    <p><a href="${APP_URL}">Open dashboard</a></p>
  `;
  await sendEmail({ to: toEmail, subject, html });
  await recordNotificationEvent({
    siteId,
    scanRunId: null,
    kind: "test",
    toEmail,
    subject,
    payload: { test: true },
  });
}
