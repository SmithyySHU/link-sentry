import { randomUUID } from "crypto";
import { ensureConnected } from "./client.js";

export interface DbSiteRow {
  id: string;
  user_id: string;
  url: string;
  created_at: Date;
  schedule_enabled: boolean;
  schedule_frequency: "daily" | "weekly";
  schedule_time_utc: string;
  schedule_day_of_week: number | null;
  next_scheduled_at: Date | null;
  last_scheduled_at: Date | null;
  notify_enabled: boolean;
  notify_email: string | null;
  notify_on: "always" | "issues" | "never";
  notify_include_csv: boolean;
  notify_only_on_change: boolean;
  notify_include_blocked: boolean;
  notify_include_broken: boolean;
  last_notified_scan_run_id: string | null;
}

export async function getSitesForUser(userId: string): Promise<DbSiteRow[]> {
  const db = await ensureConnected();

  const result = await db.query<DbSiteRow>(
    `
    SELECT id,
           user_id,
           url,
           created_at,
           schedule_enabled,
           schedule_frequency,
           schedule_time_utc,
           schedule_day_of_week,
           next_scheduled_at,
           last_scheduled_at,
           notify_enabled,
           notify_email,
           notify_on,
           notify_include_csv,
           notify_only_on_change,
           notify_include_blocked,
           notify_include_broken,
           last_notified_scan_run_id
    FROM sites
    WHERE user_id = $1
    ORDER BY created_at DESC
    `,
    [userId],
  );

  return result.rows;
}

export async function getAllSites(): Promise<DbSiteRow[]> {
  const db = await ensureConnected();

  const result = await db.query<DbSiteRow>(
    `
    SELECT id,
           user_id,
           url,
           created_at,
           schedule_enabled,
           schedule_frequency,
           schedule_time_utc,
           schedule_day_of_week,
           next_scheduled_at,
           last_scheduled_at,
           notify_enabled,
           notify_email,
           notify_on,
           notify_include_csv,
           notify_only_on_change,
           notify_include_blocked,
           notify_include_broken,
           last_notified_scan_run_id
    FROM sites
    ORDER BY created_at DESC
    `,
  );

  return result.rows;
}

export async function getSiteById(id: string): Promise<DbSiteRow | null> {
  const db = await ensureConnected();

  const result = await db.query<DbSiteRow>(
    `
    SELECT id,
           user_id,
           url,
           created_at,
           schedule_enabled,
           schedule_frequency,
           schedule_time_utc,
           schedule_day_of_week,
           next_scheduled_at,
           last_scheduled_at,
           notify_enabled,
           notify_email,
           notify_on,
           notify_include_csv,
           notify_only_on_change,
           notify_include_blocked,
           notify_include_broken,
           last_notified_scan_run_id
    FROM sites
    WHERE id = $1
    `,
    [id],
  );

  return result.rows[0] ?? null;
}

export async function createSite(
  userId: string | undefined,
  url: string,
): Promise<DbSiteRow> {
  if (typeof url !== "string" || !url.trim()) {
    throw new Error("url is required");
  }

  const db = await ensureConnected();
  const finalUserId = userId || randomUUID();

  const result = await db.query<DbSiteRow>(
    `
    INSERT INTO sites (user_id, url)
    VALUES ($1, $2)
    RETURNING id,
              user_id,
              url,
              created_at,
              schedule_enabled,
              schedule_frequency,
              schedule_time_utc,
              schedule_day_of_week,
              next_scheduled_at,
              last_scheduled_at,
              notify_enabled,
              notify_email,
              notify_on,
              notify_include_csv,
              notify_only_on_change,
              notify_include_blocked,
              notify_include_broken,
              last_notified_scan_run_id
    `,
    [finalUserId, url.trim()],
  );

  return result.rows[0];
}

// Delete a site and all its scan data.
// For now we ignore user scoping and just delete by site ID so you
// can clean up any stray test data.
export async function deleteSite(id: string): Promise<boolean> {
  const db = await ensureConnected();

  await db.query("BEGIN");
  try {
    // Remove scan results for all runs on this site
    await db.query(
      `
      DELETE FROM scan_results
      WHERE scan_run_id IN (
        SELECT id FROM scan_runs WHERE site_id = $1
      )
      `,
      [id],
    );

    // Remove scan runs for this site
    await db.query(
      `
      DELETE FROM scan_runs
      WHERE site_id = $1
      `,
      [id],
    );

    // Remove the site itself
    const result = await db.query<{ id: string }>(
      `
      DELETE FROM sites
      WHERE id = $1
      RETURNING id
      `,
      [id],
    );

    await db.query("COMMIT");
    return (result.rowCount ?? 0) > 0;
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

// Backwards-compatible wrapper if anything still calls deleteSiteForUser
export async function deleteSiteForUser(
  siteId: string,
  _userId: string,
): Promise<boolean> {
  return deleteSite(siteId);
}
