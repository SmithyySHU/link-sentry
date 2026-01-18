import { ensureConnected } from "./client";

export const SCAN_EVENT_CHANNEL = "scan_events";

type ScanStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";
type ScheduleFrequency = "daily" | "weekly";

export type ScanEventPayload = {
  type: "scan_started" | "scan_progress" | "scan_completed" | "scan_failed";
  user_id: string;
  site_id: string;
  scan_run_id: string;
  status: ScanStatus;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string | null;
  start_url?: string | null;
  total_links: number;
  checked_links: number;
  broken_links: number;
  error_message: string | null;
};

export type ScheduleEventPayload = {
  type: "schedule_updated";
  user_id: string;
  site_id: string;
  schedule_enabled: boolean;
  schedule_frequency: ScheduleFrequency;
  schedule_time_utc: string;
  schedule_day_of_week: number | null;
  next_scheduled_at: string | null;
  last_scheduled_at: string | null;
};

export type ScanEvent = ScanEventPayload | ScheduleEventPayload;

export async function emitScanEvent(event: ScanEvent): Promise<void> {
  const client = await ensureConnected();
  await client.query("SELECT pg_notify($1, $2)", [
    SCAN_EVENT_CHANNEL,
    JSON.stringify(event),
  ]);
}
