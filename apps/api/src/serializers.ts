import type { ScanRunHistoryRow, ScanRunRow } from "@link-sentry/db";

type ScanRunInput = ScanRunRow | ScanRunHistoryRow;

export type SerializedScanRun = {
  id: string;
  site_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  updated_at: string | null;
  start_url: string;
  total_links: number;
  checked_links: number;
  broken_links: number;
};

export function serializeScanRun(run: ScanRunInput): SerializedScanRun {
  return {
    id: run.id,
    site_id: run.site_id,
    status: run.status,
    started_at:
      run.started_at instanceof Date
        ? run.started_at.toISOString()
        : run.started_at,
    finished_at:
      run.finished_at instanceof Date
        ? run.finished_at.toISOString()
        : run.finished_at,
    updated_at:
      run.updated_at instanceof Date
        ? run.updated_at.toISOString()
        : run.updated_at,
    start_url: run.start_url,
    total_links: run.total_links,
    checked_links: run.checked_links,
    broken_links: run.broken_links,
  };
}
