export {
  createSite,
  deleteSite,
  getSiteById,
  getSitesForUser,
} from "./sites.js";
export type { DbSiteRow } from "./sites.js";

export {
  computeNextScheduledAt,
  getDueSites,
  getSiteSchedule,
  markSiteScheduled,
  updateSiteSchedule,
} from "./siteSchedule.js";
export type { SiteScheduleFields, ScheduleFrequency } from "./siteSchedule.js";

export {
  getLatestScanForSite,
  getRecentScansForSite,
  getScanRunById,
  setScanRunNotified,
} from "./scans.js";
export type { ScanRunRow, ScanStatus } from "./scans.js";

export {
  cancelScanRun,
  completeScanRun,
  createScanRun,
  getScanRunStatus,
  touchScanRun,
  setScanRunStatus,
  updateScanRunProgress,
} from "./scanRuns.js";
export type { LinkClassification, ScanRunSummary } from "./scanRuns.js";

export {
  getDiffBetweenRuns,
  getRecentScanRunsForSite,
} from "./scanRunsHistory.js";
export type {
  ScanLinkMinimalRow,
  ScanRunHistoryRow,
} from "./scanRunsHistory.js";

export {
  getResultsForScanRun,
  getResultsSummaryForScanRun,
  insertScanResult,
} from "./scanResults.js";
export type { ResultsSummary, ScanResultRow } from "./scanResults.js";

export {
  getOccurrencesForScanLink,
  getScanLinkById,
  getScanLinkByRunAndUrl,
  getScanLinksForExport,
  getScanLinksForExportFiltered,
  getScanLinksForRun,
  getScanLinksSummary,
  getTimeoutCountForRun,
  getTopLinksByClassification,
  insertScanLinkOccurrence,
  updateScanLinkAfterRecheck,
  setScanLinkIgnoredForRun,
  setScanLinksIgnoredByIds,
  upsertScanLink,
} from "./scanLinksDedup.js";
export type {
  ExportClassification,
  PaginatedOccurrences,
  ScanLink,
  ScanLinkExportRow,
  ScanLinkOccurrence,
  ScanLinkOccurrenceRow,
} from "./scanLinksDedup.js";

export { applyIgnoreRulesForScanRun } from "./scanLinksIgnoreApply.js";

export {
  cancelScanJob,
  claimNextScanJob,
  completeScanJob,
  enqueueScanJob,
  failScanJob,
  getJobForScanRun,
  hasActiveJobForSite,
  requeueExpiredScanJobs,
  setScanJobRunId,
} from "./scanJobs.js";
export type { ScanJobRow, ScanJobStatus } from "./scanJobs.js";

export {
  createIgnoreRule,
  deleteIgnoreRule,
  findMatchingIgnoreRule,
  getIgnoreRulesForSite,
  listIgnoreRules,
  listIgnoreRulesForSite,
  matchesIgnoreRules,
  setIgnoreRuleEnabled,
} from "./ignoreRules.js";
export type { IgnoreRule, IgnoreRuleType } from "./ignoreRules.js";

export {
  insertIgnoredOccurrence,
  listIgnoredLinksForRun,
  listIgnoredOccurrences,
  upsertIgnoredLink,
} from "./ignoredLinks.js";
export type { IgnoredLinkRow, IgnoredOccurrenceRow } from "./ignoredLinks.js";

export {
  getLinkCountsForRun,
  getNewLinksSinceLastNotified,
  getPreviousCompletedRunId,
  getSiteNotificationSettings,
  getLastNotifiedScanRunId,
  hasNotificationEvent,
  markScanRunNotified,
  recordNotificationEvent,
  setLastNotifiedScanRunId,
  updateSiteNotificationSettings,
} from "./notifications.js";
export type {
  LinkDeltaRow,
  NotificationEventKind,
  NotificationSettings,
} from "./notifications.js";
