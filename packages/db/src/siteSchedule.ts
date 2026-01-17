import { ensureConnected } from "./client.js";

export type ScheduleFrequency = "daily" | "weekly";

export type SiteScheduleFields = {
  scheduleEnabled: boolean;
  scheduleFrequency: ScheduleFrequency;
  scheduleTimeUtc: string;
  scheduleDayOfWeek: number | null;
  nextScheduledAt: Date | null;
  lastScheduledAt: Date | null;
};

type ScheduleRow = {
  id: string;
  schedule_enabled: boolean;
  schedule_frequency: ScheduleFrequency;
  schedule_time_utc: string;
  schedule_day_of_week: number | null;
  next_scheduled_at: Date | null;
  last_scheduled_at: Date | null;
};

function parseTimeUtc(timeUtc: string) {
  const parts = timeUtc.split(":");
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (
    parts.length < 2 ||
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    throw new Error("timeUtc must be HH:MM (24h)");
  }
  return { hours, minutes };
}

export function computeNextScheduledAt(
  params: {
    frequency: ScheduleFrequency;
    timeUtc: string;
    dayOfWeek?: number | null;
  },
  now: Date = new Date(),
): Date {
  const { hours, minutes } = parseTimeUtc(params.timeUtc);
  const base = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hours,
      minutes,
      0,
      0,
    ),
  );

  if (params.frequency === "daily") {
    if (base <= now) {
      base.setUTCDate(base.getUTCDate() + 1);
    }
    return base;
  }

  const targetDay = typeof params.dayOfWeek === "number" ? params.dayOfWeek : 1;
  const currentDay = now.getUTCDay();
  let daysAhead = (targetDay - currentDay + 7) % 7;
  if (daysAhead === 0 && base <= now) {
    daysAhead = 7;
  }
  base.setUTCDate(base.getUTCDate() + daysAhead);
  return base;
}

export async function getSiteSchedule(
  siteId: string,
): Promise<SiteScheduleFields | null> {
  const client = await ensureConnected();
  const res = await client.query<ScheduleRow>(
    `
      SELECT id,
             schedule_enabled,
             schedule_frequency,
             schedule_time_utc,
             schedule_day_of_week,
             next_scheduled_at,
             last_scheduled_at
      FROM sites
      WHERE id = $1
    `,
    [siteId],
  );

  const row = res.rows[0];
  if (!row) return null;
  return {
    scheduleEnabled: row.schedule_enabled,
    scheduleFrequency: row.schedule_frequency,
    scheduleTimeUtc: row.schedule_time_utc,
    scheduleDayOfWeek: row.schedule_day_of_week,
    nextScheduledAt: row.next_scheduled_at,
    lastScheduledAt: row.last_scheduled_at,
  };
}

export async function updateSiteSchedule(
  siteId: string,
  fields: {
    scheduleEnabled: boolean;
    scheduleFrequency: ScheduleFrequency;
    scheduleTimeUtc: string;
    scheduleDayOfWeek: number | null;
  },
): Promise<SiteScheduleFields> {
  const client = await ensureConnected();
  const scheduleDay =
    fields.scheduleFrequency === "weekly"
      ? (fields.scheduleDayOfWeek ?? 1)
      : null;
  const nextScheduledAt = fields.scheduleEnabled
    ? computeNextScheduledAt(
        {
          frequency: fields.scheduleFrequency,
          timeUtc: fields.scheduleTimeUtc,
          dayOfWeek: scheduleDay,
        },
        new Date(),
      )
    : null;

  const res = await client.query<ScheduleRow>(
    `
      UPDATE sites
      SET schedule_enabled = $2,
          schedule_frequency = $3,
          schedule_time_utc = $4,
          schedule_day_of_week = $5,
          next_scheduled_at = $6
      WHERE id = $1
      RETURNING id,
                schedule_enabled,
                schedule_frequency,
                schedule_time_utc,
                schedule_day_of_week,
                next_scheduled_at,
                last_scheduled_at
    `,
    [
      siteId,
      fields.scheduleEnabled,
      fields.scheduleFrequency,
      fields.scheduleTimeUtc,
      scheduleDay,
      nextScheduledAt,
    ],
  );

  const row = res.rows[0];
  if (!row) throw new Error("site_not_found");
  return {
    scheduleEnabled: row.schedule_enabled,
    scheduleFrequency: row.schedule_frequency,
    scheduleTimeUtc: row.schedule_time_utc,
    scheduleDayOfWeek: row.schedule_day_of_week,
    nextScheduledAt: row.next_scheduled_at,
    lastScheduledAt: row.last_scheduled_at,
  };
}

export async function getDueSites(limit: number): Promise<
  Array<{
    id: string;
    url: string;
    schedule_frequency: ScheduleFrequency;
    schedule_time_utc: string;
    schedule_day_of_week: number | null;
    next_scheduled_at: Date | null;
    last_scheduled_at: Date | null;
  }>
> {
  const client = await ensureConnected();
  const res = await client.query(
    `
      SELECT id,
             url,
             schedule_frequency,
             schedule_time_utc,
             schedule_day_of_week,
             next_scheduled_at,
             last_scheduled_at
      FROM sites
      WHERE schedule_enabled = true
        AND next_scheduled_at IS NOT NULL
        AND next_scheduled_at <= NOW()
      ORDER BY next_scheduled_at ASC
      LIMIT $1
    `,
    [limit],
  );
  return res.rows;
}

export async function markSiteScheduled(
  siteId: string,
  runAt: Date,
): Promise<void> {
  const client = await ensureConnected();
  const res = await client.query<ScheduleRow>(
    `
      SELECT id,
             schedule_enabled,
             schedule_frequency,
             schedule_time_utc,
             schedule_day_of_week,
             next_scheduled_at,
             last_scheduled_at
      FROM sites
      WHERE id = $1
    `,
    [siteId],
  );
  const row = res.rows[0];
  if (!row || !row.schedule_enabled) return;

  const nextScheduledAt = computeNextScheduledAt(
    {
      frequency: row.schedule_frequency,
      timeUtc: row.schedule_time_utc,
      dayOfWeek: row.schedule_day_of_week,
    },
    runAt,
  );

  await client.query(
    `
      UPDATE sites
      SET last_scheduled_at = $2,
          next_scheduled_at = $3
      WHERE id = $1
    `,
    [siteId, runAt, nextScheduledAt],
  );
}
