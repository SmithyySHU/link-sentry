export {
  createSite,
  deleteSite,
  getSiteById,
  getSitesForUser,
} from "./sites.js";
export type { DbSiteRow } from "./sites.js";

export {
  getLatestScanForSite,
  getRecentScansForSite,
  getScanRunById,
} from "./scans.js";
export type { ScanRunRow, ScanStatus } from "./scans.js";

export {
  cancelScanRun,
  completeScanRun,
  createScanRun,
  getScanRunStatus,
  touchScanRun,
  updateScanRunProgress,
} from "./scanRuns.js";
export type { LinkClassification, ScanRunSummary } from "./scanRuns.js";

export {
  getDiffBetweenRuns,
  getRecentScanRunsForSite,
} from "./scanRunsHistory.js";
export type { ScanLinkMinimalRow, ScanRunHistoryRow } from "./scanRunsHistory.js";

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
  getScanLinksForRun,
  getScanLinksSummary,
  getTimeoutCountForRun,
  getTopLinksByClassification,
  insertScanLinkOccurrence,
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
