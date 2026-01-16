import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScanProgressBar } from "./components/ScanProgressBar";

type ScanStatus = "in_progress" | "completed" | "failed" | "cancelled";
type LinkClassification = "ok" | "broken" | "blocked" | "no_response";
type StatusGroup = "all" | "no_response" | "http_error";
type ThemeMode = "dark" | "light";
type ThemePreference = "system" | "dark" | "light";
type ActiveTab =
  | "all"
  | "broken"
  | "blocked"
  | "ok"
  | "no_response"
  | "ignored";
type SortOption =
  | "severity"
  | "occ_desc"
  | "status_asc"
  | "status_desc"
  | "recent";

interface Site {
  id: string;
  user_id: string;
  url: string;
  created_at: string;
}

interface SitesResponse {
  userId?: string;
  count: number;
  sites: Site[];
}

interface ScanRunSummary {
  id: string;
  site_id: string;
  status: ScanStatus;
  started_at: string;
  finished_at: string | null;
  updated_at?: string | null;
  start_url: string;
  total_links: number;
  checked_links: number;
  broken_links: number;
}

interface ScanHistoryResponse {
  siteId: string;
  count: number;
  scans: ScanRunSummary[];
}

interface ScanResultRow {
  id: string;
  scan_run_id: string;
  source_page: string;
  link_url: string;
  status_code: number | null;
  classification: LinkClassification;
  error_message: string | null;
  created_at: string;
}

interface ScanResultsResponse {
  scanRunId: string;
  classification?: string;
  countReturned: number;
  totalMatching: number;
  results: ScanResultRow[];
}

interface ScanLink {
  id: string;
  scan_run_id: string;
  link_url: string;
  classification: LinkClassification;
  status_code: number | null;
  error_message: string | null;
  ignored: boolean;
  ignored_by_rule_id: string | null;
  ignored_at: string | null;
  ignore_reason: string | null;
  ignored_source: "none" | "manual" | "rule";
  first_seen_at: string;
  last_seen_at: string;
  occurrence_count: number;
  created_at: string;
  updated_at: string;
}

interface ScanLinkOccurrence {
  id: string;
  scan_link_id: string;
  source_page: string;
  created_at: string;
}

interface ScanLinkOccurrencesResponse {
  scanLinkId: string;
  countReturned: number;
  totalMatching: number;
  occurrences: ScanLinkOccurrence[];
}

interface IgnoreRule {
  id: string;
  site_id: string | null;
  rule_type:
    | "contains"
    | "regex"
    | "exact"
    | "status_code"
    | "classification"
    | "domain"
    | "path_prefix";
  pattern: string;
  is_enabled: boolean;
  created_at: string;
}

interface ScanLinksResponse {
  scanRunId: string;
  classification?: LinkClassification;
  statusGroup?: StatusGroup;
  showIgnored?: boolean;
  countReturned: number;
  totalMatching: number;
  links: ScanLink[];
}

interface ReportLinkRow {
  link_url: string;
  classification: LinkClassification;
  status_code: number | null;
  error_message: string | null;
  occurrence_count: number;
  last_seen_at: string;
}

interface ScanReportResponse {
  scanRun: ScanRunSummary;
  summary: {
    byClassification: Record<string, number>;
    byStatusCode: Record<string, number>;
  };
  topBroken: ReportLinkRow[];
  topBlocked: ReportLinkRow[];
  generatedAt: string;
}

interface IgnoredLinkRow {
  id: string;
  scan_run_id: string;
  link_url: string;
  rule_id: string | null;
  rule_type: string | null;
  rule_pattern: string | null;
  status_code: number | null;
  error_message: string | null;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
}

interface IgnoredLinksResponse {
  scanRunId: string;
  countReturned: number;
  totalMatching: number;
  links: IgnoredLinkRow[];
}

interface IgnoredOccurrencesResponse {
  scanRunId: string;
  ignoredLinkId: string;
  countReturned: number;
  totalMatching: number;
  occurrences: ScanLinkOccurrence[];
}

interface DiffLinkRow {
  link_url: string;
  classification: LinkClassification;
  status_code: number | null;
  error_message: string | null;
  occurrence_count: number;
  last_seen_at: string;
}

interface DiffResponse {
  scanRunId: string;
  compareTo: string;
  diff: {
    added: DiffLinkRow[];
    removed: DiffLinkRow[];
    changed: Array<{ before: DiffLinkRow; after: DiffLinkRow }>;
    unchangedCount: number;
    totals: {
      a: { broken: number; blocked: number; ok: number; no_response: number };
      b: { broken: number; blocked: number; ok: number; no_response: number };
    };
  };
}

const API_BASE = "http://localhost:3001";
const POLL_MS = 1500;
const THEME_STORAGE_KEY = "theme";
const LINKS_PAGE_SIZE = 50;
const OCCURRENCES_PAGE_SIZE = 50;
const IGNORED_OCCURRENCES_LIMIT = 20;
const DIFF_OCCURRENCES_LIMIT = 20;
const PROGRESS_DISMISS_MS = 2000;

function isInProgress(status: ScanStatus | string | null | undefined) {
  return status === "in_progress";
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function percentBroken(total: number, broken: number) {
  if (!total) return "0.0%";
  const p = (broken / total) * 100;
  return `${p.toFixed(1)}%`;
}

function progressPercent(checked: number, total: number) {
  if (!total) return "0%";
  const pct = Math.min(100, Math.max(0, (checked / total) * 100));
  return `${pct.toFixed(0)}%`;
}

function formatRelative(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.max(0, Math.round(diffMs / 1000));
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  return `${diffHr}h ago`;
}

function formatDuration(
  start: string | null | undefined,
  end: string | null | undefined,
) {
  if (!start || !end) return "-";
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs)
    return "-";
  const diffMs = endMs - startMs;
  const diffSec = Math.round(diffMs / 1000);
  const minutes = Math.floor(diffSec / 60);
  const seconds = diffSec % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function getReportScanRunIdFromLocation() {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/report") {
    return url.searchParams.get("scanRunId");
  }
  return null;
}

function getErrorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  return fallback;
}

const STATUS_TOOLTIPS: Record<number, string> = {
  401: "Unauthorized (auth required)",
  403: "Forbidden (access denied)",
  404: "Not found",
  429: "Rate limited",
  500: "Server error",
};

function statusTooltip(status: number | null) {
  if (status == null) return "No HTTP response";
  if (status >= 500) return STATUS_TOOLTIPS[500];
  return STATUS_TOOLTIPS[status] ?? "";
}

function statusCodeGroup(status: number | null) {
  if (status == null) return "unknown";
  if (status >= 500) return "5xx";
  if (status === 404 || status === 410) return "404";
  if (status === 401 || status === 403 || status === 429) return "401/403/429";
  return "other";
}

function formatClassification(value: LinkClassification) {
  if (value === "no_response") return "Timed out";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getSystemTheme(): ThemeMode {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

function buildAppUrl(
  pathname: string,
  params?: Record<string, string | null | undefined>,
) {
  const url = new URL(window.location.href);
  url.pathname = pathname;
  url.search = "";
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value != null) url.searchParams.set(key, value);
    });
  }
  return url.toString();
}

function buildScanLinksUrl(
  runId: string,
  classification: LinkClassification,
  offset: number,
  statusGroup: StatusGroup,
  showIgnored: boolean,
  limit = LINKS_PAGE_SIZE,
) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    classification,
    statusGroup,
  });
  if (showIgnored) params.set("showIgnored", "true");
  return `${API_BASE}/scan-runs/${encodeURIComponent(runId)}/links?${params.toString()}`;
}

function buildIgnoredLinksUrl(
  runId: string,
  offset: number,
  limit = LINKS_PAGE_SIZE,
) {
  return `${API_BASE}/scan-runs/${encodeURIComponent(runId)}/ignored?limit=${limit}&offset=${offset}`;
}

type LoadHistoryOpts = {
  preserveSelection?: boolean;
  skipResultsWhileInProgress?: boolean;
};

const App: React.FC = () => {
  const scansRef = useRef<HTMLDivElement | null>(null);

  const pollHistoryRef = useRef<number | null>(null);
  const pollRunRef = useRef<number | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const sseRunIdRef = useRef<string | null>(null);
  const sseRetryTimerRef = useRef<number | null>(null);
  const copyTimersRef = useRef<Map<string, number>>(new Map());
  const runStatusRef = useRef<Map<string, ScanStatus>>(new Map());
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const filterDropdownRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const hamburgerRef = useRef<HTMLButtonElement | null>(null);
  const progressDismissRef = useRef<number | null>(null);
  const lastRunStatusRef = useRef<{
    id: string | null;
    status: ScanStatus | null;
  }>({ id: null, status: null });

  const selectedSiteIdRef = useRef<string | null>(null);
  const selectedRunIdRef = useRef<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);

  const [sites, setSites] = useState<Site[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);

  const [history, setHistory] = useState<ScanRunSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [results, setResults] = useState<ScanLink[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"dashboard" | "report">(() =>
    getReportScanRunIdFromLocation() ? "report" : "dashboard",
  );
  const [reportScanRunId, setReportScanRunId] = useState<string | null>(() =>
    getReportScanRunIdFromLocation(),
  );
  const [reportData, setReportData] = useState<ScanReportResponse | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);

  // Separate pagination tracking for broken and blocked
  const [brokenOffset, setBrokenOffset] = useState(0);
  const [brokenHasMore, setBrokenHasMore] = useState(false);
  const [blockedOffset, setBlockedOffset] = useState(0);
  const [blockedHasMore, setBlockedHasMore] = useState(false);
  const [okOffset, setOkOffset] = useState(0);
  const [okHasMore, setOkHasMore] = useState(false);
  const [noResponseOffset, setNoResponseOffset] = useState(0);
  const [noResponseHasMore, setNoResponseHasMore] = useState(false);
  const [ignoredResults, setIgnoredResults] = useState<IgnoredLinkRow[]>([]);
  const [ignoredOffset, setIgnoredOffset] = useState(0);
  const [ignoredHasMore, setIgnoredHasMore] = useState(false);
  const [ignoredLoading, setIgnoredLoading] = useState(false);
  const [ignoredError, setIgnoredError] = useState<string | null>(null);
  const [ignoredOccurrences, setIgnoredOccurrences] = useState<
    Record<string, ScanLinkOccurrence[]>
  >({});
  const [ignoredOccLoading, setIgnoredOccLoading] = useState<
    Record<string, boolean>
  >({});
  const [ignoredOccError, setIgnoredOccError] = useState<
    Record<string, string | null>
  >({});

  const [occurrencesByLinkId, setOccurrencesByLinkId] = useState<
    Record<string, ScanLinkOccurrence[]>
  >({});
  const [occurrencesOffsetByLinkId, setOccurrencesOffsetByLinkId] = useState<
    Record<string, number>
  >({});
  const [occurrencesHasMoreByLinkId, setOccurrencesHasMoreByLinkId] = useState<
    Record<string, boolean>
  >({});
  const [occurrencesLoadingByLinkId, setOccurrencesLoadingByLinkId] = useState<
    Record<string, boolean>
  >({});
  const [occurrencesTotalByLinkId, setOccurrencesTotalByLinkId] = useState<
    Record<string, number>
  >({});
  const [occurrencesErrorByLinkId, setOccurrencesErrorByLinkId] = useState<
    Record<string, string | null>
  >({});

  const [startUrl, setStartUrl] = useState("");
  const [triggeringScan, setTriggeringScan] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const [newSiteUrl, setNewSiteUrl] = useState("");
  const [creatingSite, setCreatingSite] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [deletingSiteId, setDeletingSiteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [lastProgressAtByRunId, setLastProgressAtByRunId] = useState<
    Record<string, number>
  >({});
  const [progressPhase, setProgressPhase] = useState<
    "hidden" | "running" | "completed"
  >("hidden");
  const [copyFeedback, setCopyFeedback] = useState<Record<string, boolean>>({});
  const [themePreference, setThemePreference] =
    useState<ThemePreference>("system");
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [paneWidth, setPaneWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("all");
  const [statusGroup, setStatusGroup] = useState<StatusGroup>("all");
  const [showIgnored, setShowIgnored] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilters, setStatusFilters] = useState<Record<string, boolean>>(
    {},
  );
  const [minOccurrencesOnly, setMinOccurrencesOnly] = useState(false);
  const [sortOption, setSortOption] = useState<SortOption>("severity");
  const [siteSearch, setSiteSearch] = useState("");
  const [toasts, setToasts] = useState<
    Array<{
      id: string;
      message: string;
      tone?: "success" | "warning" | "info";
    }>
  >([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [expandedRowIds, setExpandedRowIds] = useState<Record<string, boolean>>(
    {},
  );
  const [ignoreRulesOpen, setIgnoreRulesOpen] = useState(false);
  const [ignoreRules, setIgnoreRules] = useState<IgnoreRule[]>([]);
  const [ignoreRulesLoading, setIgnoreRulesLoading] = useState(false);
  const [ignoreRulesError, setIgnoreRulesError] = useState<string | null>(null);
  const [newRuleType, setNewRuleType] =
    useState<IgnoreRule["rule_type"]>("domain");
  const [newRulePattern, setNewRulePattern] = useState("");
  const [newRuleScope, setNewRuleScope] = useState<"site" | "global">("site");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [compareRunId, setCompareRunId] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffData, setDiffData] = useState<DiffResponse["diff"] | null>(null);
  const [diffTab, setDiffTab] = useState<"added" | "removed" | "changed">(
    "added",
  );
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffOccurrences, setDiffOccurrences] = useState<
    Record<string, ScanLinkOccurrence[]>
  >({});
  const [diffOccLoading, setDiffOccLoading] = useState<Record<string, boolean>>(
    {},
  );
  const [diffOccError, setDiffOccError] = useState<
    Record<string, string | null>
  >({});
  const [isNarrow, setIsNarrow] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const hasSites = sites.length > 0;

  useEffect(() => {
    selectedSiteIdRef.current = selectedSiteId;
  }, [selectedSiteId]);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  useEffect(() => {
    activeRunIdRef.current = activeRunId;
  }, [activeRunId]);

  useEffect(() => {
    const handlePopState = () => {
      const nextReportId = getReportScanRunIdFromLocation();
      setReportScanRunId(nextReportId);
      setViewMode(nextReportId ? "report" : "dashboard");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (exportMenuRef.current && !exportMenuRef.current.contains(target)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [exportMenuOpen]);

  const pinnedRunId = activeRunId ?? selectedRunId;

  const selectedRun = useMemo(() => {
    if (pinnedRunId) {
      const found = history.find((r) => r.id === pinnedRunId);
      if (found) return found;
    }
    return history.length > 0 ? history[0] : null;
  }, [history, pinnedRunId]);

  useEffect(() => {
    if (viewMode !== "report") return;
    if (!reportScanRunId) {
      setReportData(null);
      setReportError("Missing scan run id");
      return;
    }
    let cancelled = false;
    const loadReport = async () => {
      setReportLoading(true);
      setReportError(null);
      try {
        const res = await fetch(
          `${API_BASE}/scan-runs/${encodeURIComponent(reportScanRunId)}/report`,
          {
            cache: "no-store",
          },
        );
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(
            `Report failed: ${res.status}${text ? ` - ${text.slice(0, 200)}` : ""}`,
          );
        }
        const data = (await res.json()) as ScanReportResponse;
        if (!cancelled) {
          setReportData(data);
        }
      } catch (err) {
        if (!cancelled) {
          setReportError(getErrorMessage(err, "Failed to load report"));
        }
      } finally {
        if (!cancelled) setReportLoading(false);
      }
    };
    void loadReport();
    return () => {
      cancelled = true;
    };
  }, [reportScanRunId, viewMode]);

  const visibleResults = useMemo(
    () => (showIgnored ? results : results.filter((row) => !row.ignored)),
    [results, showIgnored],
  );

  const brokenResults = useMemo(
    () => visibleResults.filter((r) => r.classification === "broken"),
    [visibleResults],
  );

  const blockedResults = useMemo(
    () => visibleResults.filter((r) => r.classification === "blocked"),
    [visibleResults],
  );

  const filteredResults = useMemo(() => {
    const source =
      activeTab === "broken"
        ? brokenResults
        : activeTab === "blocked"
          ? blockedResults
          : activeTab === "ok"
            ? visibleResults.filter((row) => row.classification === "ok")
            : activeTab === "no_response"
              ? visibleResults.filter(
                  (row) => row.classification === "no_response",
                )
              : visibleResults;
    const query = searchQuery.trim().toLowerCase();
    const activeStatusFilters = Object.keys(statusFilters).filter(
      (key) => statusFilters[key],
    );

    let next = source.filter((row) => {
      if (statusGroup === "no_response" && row.status_code != null)
        return false;
      if (statusGroup === "http_error" && row.status_code == null) return false;
      if (query && !row.link_url.toLowerCase().includes(query)) return false;
      if (minOccurrencesOnly && row.occurrence_count <= 1) return false;
      if (
        activeStatusFilters.length > 0 &&
        !activeStatusFilters.includes(statusCodeGroup(row.status_code))
      )
        return false;
      return true;
    });

    const severityRank = (row: ScanLink) => {
      if (row.classification === "broken") return 0;
      if (row.classification === "blocked") return 1;
      if (row.classification === "no_response") return 2;
      return 3;
    };
    const lastSeenMs = (row: ScanLink) => {
      const parsed = Date.parse(row.last_seen_at);
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    next = [...next].sort((a, b) => {
      if (sortOption === "occ_desc")
        return b.occurrence_count - a.occurrence_count;
      if (sortOption === "status_asc")
        return (a.status_code ?? 0) - (b.status_code ?? 0);
      if (sortOption === "status_desc")
        return (b.status_code ?? 0) - (a.status_code ?? 0);
      if (sortOption === "recent") return lastSeenMs(b) - lastSeenMs(a);
      const diff = severityRank(a) - severityRank(b);
      if (diff !== 0) return diff;
      const occDiff = b.occurrence_count - a.occurrence_count;
      if (occDiff !== 0) return occDiff;
      return lastSeenMs(b) - lastSeenMs(a);
    });

    return next;
  }, [
    activeTab,
    brokenResults,
    blockedResults,
    visibleResults,
    searchQuery,
    statusFilters,
    minOccurrencesOnly,
    sortOption,
    statusGroup,
  ]);

  const hasActiveFilters =
    activeTab !== "all" ||
    statusGroup !== "all" ||
    showIgnored ||
    searchQuery.trim().length > 0 ||
    minOccurrencesOnly ||
    Object.values(statusFilters).some(Boolean);
  const exportDisabled = !selectedRunId;
  const exportLinksDisabled = !selectedRunId || activeTab === "ignored";

  const filteredSites = useMemo(() => {
    const query = siteSearch.trim().toLowerCase();
    if (!query) return sites;
    return sites.filter((site) => site.url.toLowerCase().includes(query));
  }, [sites, siteSearch]);

  const isSelectedRunInProgress = isInProgress(selectedRun?.status);
  const showProgress = progressPhase !== "hidden" && !!selectedRun;
  const lastProgressAt = useMemo(() => {
    if (!selectedRun) return null;
    if (selectedRun.updated_at) {
      const parsed = new Date(selectedRun.updated_at).getTime();
      if (!Number.isNaN(parsed)) return parsed;
    }
    return lastProgressAtByRunId[selectedRun.id] ?? null;
  }, [lastProgressAtByRunId, selectedRun]);

  useEffect(() => {
    if (progressDismissRef.current) {
      window.clearTimeout(progressDismissRef.current);
      progressDismissRef.current = null;
    }

    if (!selectedRun) {
      setProgressPhase("hidden");
      lastRunStatusRef.current = { id: null, status: null };
      return;
    }

    const prev = lastRunStatusRef.current;
    const isSameRun = prev.id === selectedRun.id;
    const prevStatus = isSameRun ? prev.status : null;

    if (selectedRun.status === "in_progress") {
      setProgressPhase("running");
    } else if (
      selectedRun.status === "completed" &&
      prevStatus === "in_progress"
    ) {
      setProgressPhase("completed");
      progressDismissRef.current = window.setTimeout(() => {
        setProgressPhase("hidden");
      }, PROGRESS_DISMISS_MS);
    } else {
      setProgressPhase("hidden");
    }

    lastRunStatusRef.current = {
      id: selectedRun.id,
      status: selectedRun.status,
    };

    return () => {
      if (progressDismissRef.current) {
        window.clearTimeout(progressDismissRef.current);
        progressDismissRef.current = null;
      }
    };
  }, [selectedRun?.id, selectedRun?.status]);

  type DiffItem = {
    key: string;
    row: DiffLinkRow;
    before: DiffLinkRow | null;
    after: DiffLinkRow | null;
  };

  const issueDiff = useMemo(() => {
    if (!diffData) return null;

    const isIssue = (row: DiffLinkRow) => row.classification !== "ok";
    const makeKey = (prefix: string, row: DiffLinkRow) =>
      `${prefix}:${row.link_url}`;
    const addUnique = (map: Map<string, DiffItem>, item: DiffItem) => {
      if (!map.has(item.key)) map.set(item.key, item);
    };

    const addedMap = new Map<string, DiffItem>();
    const removedMap = new Map<string, DiffItem>();
    const changedMap = new Map<string, DiffItem>();

    diffData.added.filter(isIssue).forEach((row) => {
      addUnique(addedMap, {
        key: makeKey("added", row),
        row,
        before: null,
        after: null,
      });
    });
    diffData.removed.filter(isIssue).forEach((row) => {
      addUnique(removedMap, {
        key: makeKey("removed", row),
        row,
        before: null,
        after: null,
      });
    });

    diffData.changed.forEach(({ before, after }) => {
      const beforeIssue = isIssue(before);
      const afterIssue = isIssue(after);
      if (!beforeIssue && afterIssue) {
        addUnique(addedMap, {
          key: makeKey("added", after),
          row: after,
          before,
          after,
        });
      } else if (beforeIssue && !afterIssue) {
        addUnique(removedMap, {
          key: makeKey("removed", before),
          row: before,
          before,
          after,
        });
      } else if (beforeIssue && afterIssue) {
        addUnique(changedMap, {
          key: makeKey("changed", after),
          row: after,
          before,
          after,
        });
      }
    });

    const added = Array.from(addedMap.values());
    const removed = Array.from(removedMap.values());
    const changed = Array.from(changedMap.values());
    const totalIssues =
      diffData.totals.a.broken +
      diffData.totals.a.blocked +
      diffData.totals.a.no_response;
    const unchangedCount = Math.max(
      0,
      totalIssues - added.length - changed.length,
    );

    return { added, removed, changed, unchangedCount };
  }, [diffData]);

  const diffSummary = useMemo(() => {
    if (!issueDiff) return null;
    return {
      addedIssues: issueDiff.added.length,
      removedIssues: issueDiff.removed.length,
      changed: issueDiff.changed.length,
      unchanged: issueDiff.unchangedCount,
    };
  }, [issueDiff]);
  const compareRun = useMemo(() => {
    if (!compareRunId) return null;
    return history.find((run) => run.id === compareRunId) ?? null;
  }, [compareRunId, history]);
  const hasDiffChanges =
    !!issueDiff &&
    (issueDiff.added.length > 0 ||
      issueDiff.removed.length > 0 ||
      issueDiff.changed.length > 0);
  const diffItems = useMemo(() => {
    if (!issueDiff) return [];
    if (diffTab === "added") return issueDiff.added;
    if (diffTab === "removed") return issueDiff.removed;
    return issueDiff.changed;
  }, [issueDiff, diffTab]);
  const reportView = viewMode === "report";
  const reportRun = reportData?.scanRun ?? null;
  const reportSite = reportRun
    ? (sites.find((site) => site.id === reportRun.site_id)?.url ??
      reportRun.site_id)
    : null;
  const reportSummary = reportData?.summary.byClassification ?? {};

  function markRunProgress(runId: string) {
    setLastProgressAtByRunId((prev) => ({
      ...prev,
      [runId]: Date.now(),
    }));
  }

  function stopPolling() {
    if (pollHistoryRef.current) {
      window.clearInterval(pollHistoryRef.current);
      pollHistoryRef.current = null;
    }
    if (pollRunRef.current) {
      window.clearInterval(pollRunRef.current);
      pollRunRef.current = null;
    }
  }

  function startPolling() {
    if (sseRef.current) return;
    stopPolling();

    pollHistoryRef.current = window.setInterval(() => {
      const siteId = selectedSiteIdRef.current;
      if (!siteId) return;
      if (activeRunIdRef.current) return;
      void loadHistory(siteId, { preserveSelection: true });
    }, POLL_MS);

    pollRunRef.current = window.setInterval(() => {
      const runId = activeRunIdRef.current ?? selectedRunIdRef.current;
      if (!runId) {
        return;
      }
      void refreshSelectedRun(runId);
    }, POLL_MS);
  }

  function stopSse() {
    if (sseRetryTimerRef.current) {
      window.clearTimeout(sseRetryTimerRef.current);
      sseRetryTimerRef.current = null;
    }
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    sseRunIdRef.current = null;
  }

  function scheduleSseRetry(scanRunId: string) {
    if (sseRetryTimerRef.current) {
      window.clearTimeout(sseRetryTimerRef.current);
    }
    sseRetryTimerRef.current = window.setTimeout(async () => {
      if (
        selectedRunIdRef.current !== scanRunId &&
        activeRunIdRef.current !== scanRunId
      )
        return;
      try {
        const res = await fetch(
          `${API_BASE}/scan-runs/${encodeURIComponent(scanRunId)}`,
          {
            cache: "no-store",
          },
        );
        if (!res.ok) return;
        const run: ScanRunSummary = await res.json();
        setHistory((prev) => {
          const idx = prev.findIndex((r) => r.id === run.id);
          if (idx === -1) return [run, ...prev];
          const copy = [...prev];
          copy[idx] = run;
          return copy;
        });
        if (isInProgress(run.status)) {
          startSse(scanRunId);
        }
      } catch {}
    }, 5000);
  }

  function startSse(scanRunId: string) {
    if (sseRef.current && sseRunIdRef.current === scanRunId) return;
    stopSse();
    stopPolling();

    const source = new EventSource(
      `${API_BASE}/scan-runs/${encodeURIComponent(scanRunId)}/events`,
    );
    sseRef.current = source;
    sseRunIdRef.current = scanRunId;

    const handleScanRunUpdate = (run: ScanRunSummary) => {
      setHistory((prev) => {
        const idx = prev.findIndex((r) => r.id === run.id);
        if (idx === -1) return [run, ...prev];
        const copy = [...prev];
        copy[idx] = run;
        return copy;
      });
      markRunProgress(run.id);
      maybeNotifyRunStatus(run);

      if (selectedRunIdRef.current !== run.id) {
        setSelectedRunId(run.id);
        selectedRunIdRef.current = run.id;
      }

      if (!isInProgress(run.status)) {
        stopSse();
        void refreshSelectedRun(run.id);
      }
    };

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as Partial<ScanRunSummary> & {
          scanRunId?: string;
        };
        if (data?.id) {
          handleScanRunUpdate(data as ScanRunSummary);
          return;
        }
        if (data?.scanRunId) {
          setHistory((prev) => {
            const idx = prev.findIndex((r) => r.id === data.scanRunId);
            if (idx === -1) return prev;
            const existing = prev[idx];
            const updated: ScanRunSummary = {
              ...existing,
              ...data,
              id: existing.id,
              site_id: existing.site_id,
            };
            const copy = [...prev];
            copy[idx] = updated;
            return copy;
          });
          markRunProgress(data.scanRunId);
        }
      } catch {}
    };

    source.addEventListener("scan_run", handleMessage as EventListener);
    source.addEventListener("run", handleMessage as EventListener);
    source.addEventListener("message", handleMessage as EventListener);
    source.addEventListener("done", () => {
      stopSse();
      void refreshSelectedRun(scanRunId);
    });

    source.onerror = () => {
      if (sseRef.current !== source) return;
      stopSse();
      startPolling();
      scheduleSseRetry(scanRunId);
    };
  }

  useEffect(() => {
    void loadSites();
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(
      THEME_STORAGE_KEY,
    ) as ThemePreference | null;
    if (stored === "dark" || stored === "light" || stored === "system") {
      setThemePreference(stored);
    } else {
      setThemePreference("system");
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("linksentry_pane_width");
    const value = stored ? Number(stored) : NaN;
    if (!Number.isNaN(value) && value >= 240 && value <= 520) {
      setPaneWidth(value);
    }
  }, []);

  useEffect(() => {
    if (themePreference === "system") {
      setThemeMode(getSystemTheme());
    } else {
      setThemeMode(themePreference);
    }
  }, [themePreference]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = themeMode;
    }
  }, [themeMode]);

  useEffect(() => {
    if (
      themePreference !== "system" ||
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setThemeMode(media.matches ? "dark" : "light");
    if (media.addEventListener) {
      media.addEventListener("change", handler);
      return () => media.removeEventListener("change", handler);
    }
    media.addListener?.(handler);
    return () => media.removeListener?.(handler);
  }, [themePreference]);

  useEffect(() => {
    if (!isResizing) return;
    const handleMove = (event: MouseEvent) => {
      const next = Math.min(520, Math.max(240, event.clientX - 24));
      setPaneWidth(next);
    };
    const handleUp = () => setIsResizing(false);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isResizing]);

  useEffect(() => {
    localStorage.setItem("linksentry_pane_width", String(paneWidth));
  }, [paneWidth]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (event.key === "/" && searchInputRef.current && !isTyping) {
        event.preventDefault();
        searchInputRef.current.focus();
      }
      if (event.key === "Escape") {
        setIsDrawerOpen(false);
        setIgnoreRulesOpen(false);
        setHistoryOpen(false);
        setFiltersOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    if (!filtersOpen) return;
    const handlePointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (filterDropdownRef.current?.contains(target)) return;
      setFiltersOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("touchstart", handlePointer);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("touchstart", handlePointer);
    };
  }, [filtersOpen]);

  useEffect(() => {
    if (!isDrawerOpen) return;
    const handlePointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (sidebarRef.current?.contains(target)) return;
      if (hamburgerRef.current?.contains(target)) return;
      setIsDrawerOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("touchstart", handlePointer);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("touchstart", handlePointer);
    };
  }, [isDrawerOpen]);

  useEffect(() => {
    const handleResize = () => setIsNarrow(window.innerWidth < 980);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    return () => {
      copyTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      copyTimersRef.current.clear();
      stopSse();
      stopPolling();
    };
  }, []);

  async function loadSites() {
    setSitesLoading(true);
    setSitesError(null);
    try {
      const res = await fetch(`${API_BASE}/sites`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data: SitesResponse = await res.json();

      setSites(data.sites);

      if (data.sites.length > 0) {
        const first = data.sites[0];
        setSelectedSiteId(first.id);
        selectedSiteIdRef.current = first.id;

        setStartUrl(first.url);

        setActiveRunId(null);
        activeRunIdRef.current = null;

        setSelectedRunId(null);
        selectedRunIdRef.current = null;

        setResults([]);
        resetOccurrencesState();
        setHistory([]);

        await loadHistory(first.id, { preserveSelection: false });
      } else {
        setSelectedSiteId(null);
        selectedSiteIdRef.current = null;

        setHistory([]);
        setSelectedRunId(null);
        selectedRunIdRef.current = null;

        setResults([]);
        resetOccurrencesState();
        setStartUrl("");

        setActiveRunId(null);
        activeRunIdRef.current = null;
      }
    } catch (err: unknown) {
      setSitesError(getErrorMessage(err, "Failed to load sites"));
    } finally {
      setSitesLoading(false);
    }
  }

  async function loadHistory(siteId: string, opts?: LoadHistoryOpts) {
    const preserveSelection = !!opts?.preserveSelection;
    const skipResultsWhileInProgress = !!opts?.skipResultsWhileInProgress;

    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(
        `${API_BASE}/sites/${encodeURIComponent(siteId)}/scans?limit=10`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      const data: ScanHistoryResponse = await res.json();
      let scans = data.scans ?? [];

      const pinned = activeRunIdRef.current;
      if (pinned) {
        const localPinned = history.find((r) => r.id === pinned);
        const exists = scans.some((r) => r.id === pinned);
        if (!exists && localPinned) {
          scans = [localPinned, ...scans];
        }
      }

      setHistory(scans);

      if (scans.length === 0) {
        if (!preserveSelection) {
          setSelectedRunId(null);
          selectedRunIdRef.current = null;
        }
        setResults([]);
        resetOccurrencesState();
        return;
      }

      const prevSelected = selectedRunIdRef.current;
      const activePinned = activeRunIdRef.current;

      let nextSelectedId: string;
      if (activePinned) {
        nextSelectedId = activePinned;
      } else if (
        preserveSelection &&
        prevSelected &&
        scans.some((r) => r.id === prevSelected)
      ) {
        nextSelectedId = prevSelected;
      } else {
        nextSelectedId = scans[0].id;
      }

      if (nextSelectedId !== selectedRunIdRef.current) {
        setSelectedRunId(nextSelectedId);
        selectedRunIdRef.current = nextSelectedId;
      }

      const run = scans.find((r) => r.id === nextSelectedId) ?? scans[0];

      if (skipResultsWhileInProgress && isInProgress(run.status)) {
        return;
      }

      if (!isInProgress(run.status)) {
        await loadResults(nextSelectedId);
      }
    } catch (err: unknown) {
      setHistoryError(getErrorMessage(err, "Failed to load history"));
    } finally {
      setHistoryLoading(false);
    }
  }

  async function fetchScanLinksPage(
    runId: string,
    classification: LinkClassification,
    offset: number,
    label: string,
  ): Promise<ScanLinksResponse> {
    const res = await fetch(
      buildScanLinksUrl(
        runId,
        classification,
        offset,
        statusGroup,
        showIgnored,
      ),
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error(`Failed to load ${label}: ${res.status}`);
    return (await res.json()) as ScanLinksResponse;
  }

  async function loadResults(runId: string) {
    setResultsLoading(true);
    setResultsError(null);
    setResults([]);
    resetOccurrencesState();
    setBrokenOffset(0);
    setBlockedOffset(0);
    setOkOffset(0);
    setNoResponseOffset(0);
    try {
      const brokenData = await fetchScanLinksPage(
        runId,
        "broken",
        0,
        "broken links",
      );
      const blockedData = await fetchScanLinksPage(
        runId,
        "blocked",
        0,
        "blocked links",
      );
      const okData = await fetchScanLinksPage(runId, "ok", 0, "ok links");
      const noResponseData = await fetchScanLinksPage(
        runId,
        "no_response",
        0,
        "no response links",
      );

      // Combine links for display (we keep both, but filter separately via useMemo)
      setResults([
        ...brokenData.links,
        ...blockedData.links,
        ...okData.links,
        ...noResponseData.links,
      ]);

      // Update pagination state for broken links
      setBrokenOffset(LINKS_PAGE_SIZE);
      setBrokenHasMore(brokenData.countReturned < brokenData.totalMatching);

      // Update pagination state for blocked links
      setBlockedOffset(LINKS_PAGE_SIZE);
      setBlockedHasMore(blockedData.countReturned < blockedData.totalMatching);

      // Update pagination state for ok links
      setOkOffset(LINKS_PAGE_SIZE);
      setOkHasMore(okData.countReturned < okData.totalMatching);

      // Update pagination state for no_response links
      setNoResponseOffset(LINKS_PAGE_SIZE);
      setNoResponseHasMore(
        noResponseData.countReturned < noResponseData.totalMatching,
      );

      setSelectedRunId(runId);
      selectedRunIdRef.current = runId;
    } catch (err: unknown) {
      setResultsError(getErrorMessage(err, "Failed to load scan links"));
    } finally {
      setResultsLoading(false);
    }
  }

  async function loadIgnoredResults(runId: string) {
    setIgnoredLoading(true);
    setIgnoredError(null);
    setIgnoredResults([]);
    setIgnoredOffset(0);
    try {
      const res = await fetch(buildIgnoredLinksUrl(runId, 0, LINKS_PAGE_SIZE), {
        cache: "no-store",
      });
      if (!res.ok)
        throw new Error(`Failed to load ignored links: ${res.status}`);
      const data: IgnoredLinksResponse = await res.json();
      setIgnoredResults(data.links ?? []);
      setIgnoredOffset(LINKS_PAGE_SIZE);
      setIgnoredHasMore(data.countReturned < data.totalMatching);
    } catch (err: unknown) {
      setIgnoredError(getErrorMessage(err, "Failed to load ignored links"));
    } finally {
      setIgnoredLoading(false);
    }
  }

  async function loadMoreBrokenResults(runId: string) {
    if (resultsLoading) return;

    setResultsLoading(true);
    try {
      const data = await fetchScanLinksPage(
        runId,
        "broken",
        brokenOffset,
        "more broken links",
      );
      setResults((prev) => [...prev, ...data.links]);
      const nextOffset = brokenOffset + data.countReturned;
      setBrokenOffset((prev) => prev + LINKS_PAGE_SIZE);
      setBrokenHasMore(nextOffset < data.totalMatching);
    } catch (err: unknown) {
      setResultsError(getErrorMessage(err, "Failed to load more broken links"));
    } finally {
      setResultsLoading(false);
    }
  }

  async function loadMoreBlockedResults(runId: string) {
    if (resultsLoading) return;

    setResultsLoading(true);
    try {
      const data = await fetchScanLinksPage(
        runId,
        "blocked",
        blockedOffset,
        "more blocked links",
      );
      setResults((prev) => [...prev, ...data.links]);
      const nextOffset = blockedOffset + data.countReturned;
      setBlockedOffset((prev) => prev + LINKS_PAGE_SIZE);
      setBlockedHasMore(nextOffset < data.totalMatching);
    } catch (err: unknown) {
      setResultsError(
        getErrorMessage(err, "Failed to load more blocked links"),
      );
    } finally {
      setResultsLoading(false);
    }
  }

  async function loadMoreOkResults(runId: string) {
    if (resultsLoading) return;

    setResultsLoading(true);
    try {
      const data = await fetchScanLinksPage(
        runId,
        "ok",
        okOffset,
        "more ok links",
      );
      setResults((prev) => [...prev, ...data.links]);
      const nextOffset = okOffset + data.countReturned;
      setOkOffset((prev) => prev + LINKS_PAGE_SIZE);
      setOkHasMore(nextOffset < data.totalMatching);
    } catch (err: unknown) {
      setResultsError(getErrorMessage(err, "Failed to load more ok links"));
    } finally {
      setResultsLoading(false);
    }
  }

  async function loadMoreNoResponseResults(runId: string) {
    if (resultsLoading) return;

    setResultsLoading(true);
    try {
      const data = await fetchScanLinksPage(
        runId,
        "no_response",
        noResponseOffset,
        "more no response links",
      );
      setResults((prev) => [...prev, ...data.links]);
      const nextOffset = noResponseOffset + data.countReturned;
      setNoResponseOffset((prev) => prev + LINKS_PAGE_SIZE);
      setNoResponseHasMore(nextOffset < data.totalMatching);
    } catch (err: unknown) {
      setResultsError(
        getErrorMessage(err, "Failed to load more no response links"),
      );
    } finally {
      setResultsLoading(false);
    }
  }

  async function loadMoreIgnoredResults(runId: string) {
    if (ignoredLoading) return;
    setIgnoredLoading(true);
    try {
      const res = await fetch(
        buildIgnoredLinksUrl(runId, ignoredOffset, LINKS_PAGE_SIZE),
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      const data: IgnoredLinksResponse = await res.json();
      setIgnoredResults((prev) => [...prev, ...data.links]);
      setIgnoredOffset((prev) => prev + data.countReturned);
      setIgnoredHasMore(
        ignoredOffset + data.countReturned < data.totalMatching,
      );
    } catch (err: unknown) {
      setIgnoredError(
        getErrorMessage(err, "Failed to load more ignored links"),
      );
    } finally {
      setIgnoredLoading(false);
    }
  }

  async function loadMoreAllResults(runId: string) {
    if (resultsLoading) return;

    setResultsLoading(true);
    try {
      const loadMoreByClassification = async (
        classification: "broken" | "blocked" | "ok" | "no_response",
        offset: number,
        setOffset: React.Dispatch<React.SetStateAction<number>>,
        setHasMore: React.Dispatch<React.SetStateAction<boolean>>,
      ) => {
        const res = await fetch(
          buildScanLinksUrl(
            runId,
            classification,
            offset,
            statusGroup,
            showIgnored,
          ),
          {
            cache: "no-store",
          },
        );
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);

        const data: ScanLinksResponse = await res.json();
        setResults((prev) => [...prev, ...data.links]);
        const nextOffset = offset + data.countReturned;
        setOffset(nextOffset);
        setHasMore(nextOffset < data.totalMatching);
      };

      if (brokenHasMore) {
        await loadMoreByClassification(
          "broken",
          brokenOffset,
          setBrokenOffset,
          setBrokenHasMore,
        );
      }
      if (blockedHasMore) {
        await loadMoreByClassification(
          "blocked",
          blockedOffset,
          setBlockedOffset,
          setBlockedHasMore,
        );
      }
      if (okHasMore) {
        await loadMoreByClassification(
          "ok",
          okOffset,
          setOkOffset,
          setOkHasMore,
        );
      }
      if (noResponseHasMore) {
        await loadMoreByClassification(
          "no_response",
          noResponseOffset,
          setNoResponseOffset,
          setNoResponseHasMore,
        );
      }
    } catch (err: unknown) {
      setResultsError(getErrorMessage(err, "Failed to load more results"));
    } finally {
      setResultsLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedSiteId) {
      stopPolling();
      return;
    }

    const shouldPoll = !!activeRunId || isSelectedRunInProgress;

    if (shouldPoll && !sseRef.current) startPolling();
    else if (!shouldPoll) stopPolling();

    return () => stopPolling();
  }, [selectedSiteId, activeRunId, selectedRun?.id, selectedRun?.status]);

  useEffect(() => {
    if (selectedRun && isInProgress(selectedRun.status)) {
      startSse(selectedRun.id);
      return;
    }

    if (sseRef.current && sseRunIdRef.current === selectedRun?.id) {
      stopSse();
    }
  }, [selectedRun?.id, selectedRun?.status]);

  useEffect(() => {
    if (!selectedRunId) return;
    if (isInProgress(selectedRun?.status)) return;
    void loadResults(selectedRunId);
  }, [selectedRunId, statusGroup, showIgnored]);

  useEffect(() => {
    if (!selectedRunId) return;
    if (activeTab !== "ignored") return;
    void loadIgnoredResults(selectedRunId);
  }, [activeTab, selectedRunId]);

  useEffect(() => {
    if (!ignoreRulesOpen || !selectedSiteId) return;
    void loadIgnoreRules(selectedSiteId);
  }, [ignoreRulesOpen, selectedSiteId]);

  useEffect(() => {
    if (!selectedSiteId) {
      setIgnoreRulesOpen(false);
    }
  }, [selectedSiteId]);

  useEffect(() => {
    if (!selectedSiteId) {
      setHistoryOpen(false);
    }
  }, [selectedSiteId]);

  useEffect(() => {
    if (!selectedRunId || history.length === 0) {
      setCompareRunId(null);
      setDiffData(null);
      return;
    }
    const idx = history.findIndex((run) => run.id === selectedRunId);
    const fallback = history[idx + 1]?.id ?? null;
    if (fallback && fallback !== compareRunId) {
      setCompareRunId(fallback);
    } else if (!fallback) {
      setCompareRunId(null);
    }
  }, [history, selectedRunId]);

  useEffect(() => {
    setDiffOpen(false);
  }, [compareRunId, selectedRunId]);

  useEffect(() => {
    if (!selectedRunId || !compareRunId) {
      setDiffData(null);
      return;
    }
    void loadDiff(selectedRunId, compareRunId);
  }, [selectedRunId, compareRunId]);

  async function refreshSelectedRun(runId: string) {
    try {
      const res = await fetch(
        `${API_BASE}/scan-runs/${encodeURIComponent(runId)}`,
        {
          cache: "no-store",
        },
      );
      if (!res.ok) {
        return;
      }

      const run: ScanRunSummary = await res.json();

      setHistory((prev) => {
        const idx = prev.findIndex((r) => r.id === run.id);
        if (idx === -1) {
          return [run, ...prev];
        }
        const copy = [...prev];
        copy[idx] = run;
        return copy;
      });
      markRunProgress(run.id);
      maybeNotifyRunStatus(run);

      if (selectedRunIdRef.current !== run.id) {
        setSelectedRunId(run.id);
        selectedRunIdRef.current = run.id;
      }

      if (!isInProgress(run.status)) {
        setActiveRunId(null);
        activeRunIdRef.current = null;

        stopSse();
        stopPolling();
        await loadHistory(run.site_id, { preserveSelection: true });
        await loadResults(run.id);
      }
    } catch {}
  }

  async function handleSelectSite(site: Site) {
    if (site.id === selectedSiteId) return;

    stopPolling();
    stopSse();
    setIsDrawerOpen(false);

    setActiveRunId(null);
    activeRunIdRef.current = null;

    setHistory([]);
    setResults([]);
    resetOccurrencesState();

    setSelectedRunId(null);
    selectedRunIdRef.current = null;

    setSelectedSiteId(site.id);
    selectedSiteIdRef.current = site.id;

    setStartUrl(site.url);

    await loadHistory(site.id, { preserveSelection: false });
  }

  async function handleRunScan() {
    await handleRunScanWithUrl(startUrl);
  }

  async function handleCancelScan() {
    if (!selectedRunId) return;
    try {
      await fetch(
        `${API_BASE}/scan-runs/${encodeURIComponent(selectedRunId)}/cancel`,
        {
          method: "POST",
        },
      );
      setHistory((prev) =>
        prev.map((run) =>
          run.id === selectedRunId
            ? {
                ...run,
                status: "cancelled",
                finished_at: new Date().toISOString(),
              }
            : run,
        ),
      );
      pushToast("Cancelling scan…", "info");
    } catch (err: unknown) {
      pushToast(getErrorMessage(err, "Failed to cancel scan"), "warning");
    }
  }

  async function handleCreateSite() {
    const url = newSiteUrl.trim();
    if (!url) return;

    setCreatingSite(true);
    setCreateError(null);
    try {
      const res = await fetch(`${API_BASE}/sites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Create failed: ${res.status}${text ? ` - ${text.slice(0, 200)}` : ""}`,
        );
      }

      setNewSiteUrl("");
      await loadSites();
    } catch (err: unknown) {
      setCreateError(getErrorMessage(err, "Failed to create site"));
    } finally {
      setCreatingSite(false);
    }
  }

  async function handleDeleteSite(siteId: string) {
    const site = sites.find((s) => s.id === siteId);
    const label = site?.url ? `\n\n${site.url}` : "";

    const ok = window.confirm(
      `Delete this site and all scans/results?${label}`,
    );
    if (!ok) return;

    setDeletingSiteId(siteId);
    setDeleteError(null);
    try {
      const res = await fetch(
        `${API_BASE}/sites/${encodeURIComponent(siteId)}`,
        {
          method: "DELETE",
        },
      );

      if (res.status === 404) {
        setDeleteError("Site not found (maybe already deleted).");
        await loadSites();
        return;
      }

      if (!res.ok && res.status !== 204) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Delete failed: ${res.status}${text ? ` - ${text.slice(0, 200)}` : ""}`,
        );
      }

      if (selectedSiteId === siteId) {
        stopPolling();
        stopSse();

        setSelectedSiteId(null);
        selectedSiteIdRef.current = null;

        setHistory([]);
        setResults([]);
        resetOccurrencesState();

        setSelectedRunId(null);
        selectedRunIdRef.current = null;

        setStartUrl("");

        setActiveRunId(null);
        activeRunIdRef.current = null;
      }

      await loadSites();
    } catch (err: unknown) {
      setDeleteError(getErrorMessage(err, "Failed to delete site"));
    } finally {
      setDeletingSiteId(null);
    }
  }

  async function fetchOccurrencesForLink(scanLinkId: string, offset: number) {
    setOccurrencesLoadingByLinkId((prev) => ({ ...prev, [scanLinkId]: true }));
    setOccurrencesErrorByLinkId((prev) => ({ ...prev, [scanLinkId]: null }));

    try {
      const res = await fetch(
        `${API_BASE}/scan-links/${encodeURIComponent(scanLinkId)}/occurrences?limit=${OCCURRENCES_PAGE_SIZE}&offset=${offset}`,
        { cache: "no-store" },
      );

      if (!res.ok) {
        throw new Error(`Failed to fetch occurrences: ${res.status}`);
      }

      const data: ScanLinkOccurrencesResponse = await res.json();
      setOccurrencesByLinkId((prev) => ({
        ...prev,
        [scanLinkId]:
          offset === 0
            ? data.occurrences
            : [...(prev[scanLinkId] ?? []), ...data.occurrences],
      }));
      setOccurrencesOffsetByLinkId((prev) => ({
        ...prev,
        [scanLinkId]: offset + data.countReturned,
      }));
      setOccurrencesTotalByLinkId((prev) => ({
        ...prev,
        [scanLinkId]: data.totalMatching,
      }));
      setOccurrencesHasMoreByLinkId((prev) => ({
        ...prev,
        [scanLinkId]: offset + data.countReturned < data.totalMatching,
      }));
      setOccurrencesLoadingByLinkId((prev) => ({
        ...prev,
        [scanLinkId]: false,
      }));
    } catch (err: unknown) {
      const errorMsg = getErrorMessage(err, "Failed to load occurrences");
      setOccurrencesLoadingByLinkId((prev) => ({
        ...prev,
        [scanLinkId]: false,
      }));
      setOccurrencesErrorByLinkId((prev) => ({
        ...prev,
        [scanLinkId]: errorMsg,
      }));
    }
  }

  async function handleLoadMoreOccurrences(scanLinkId: string) {
    const offset = occurrencesOffsetByLinkId[scanLinkId] ?? 0;
    await fetchOccurrencesForLink(scanLinkId, offset);
  }

  async function toggleExpandLink(scanLinkId: string) {
    const nextExpanded = !expandedRowIds[scanLinkId];
    setExpandedRowIds((prev) => ({ ...prev, [scanLinkId]: nextExpanded }));
    if (nextExpanded && !occurrencesByLinkId[scanLinkId]) {
      await fetchOccurrencesForLink(scanLinkId, 0);
    }
    if (nextExpanded) {
      window.setTimeout(() => {
        document.getElementById(`scan-link-${scanLinkId}`)?.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      }, 0);
    }
  }

  function resetOccurrencesState() {
    setExpandedRowIds({});
    setOccurrencesByLinkId({});
    setOccurrencesOffsetByLinkId({});
    setOccurrencesHasMoreByLinkId({});
    setOccurrencesLoadingByLinkId({});
    setOccurrencesTotalByLinkId({});
    setOccurrencesErrorByLinkId({});
  }

  function showCopyFeedback(key: string) {
    setCopyFeedback((prev) => ({ ...prev, [key]: true }));
    const existing = copyTimersRef.current.get(key);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      setCopyFeedback((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      copyTimersRef.current.delete(key);
    }, 1200);
    copyTimersRef.current.set(key, timer);
  }

  async function copyToClipboard(
    text: string,
    feedbackKey?: string,
    toastMessage = "Copied to clipboard",
  ) {
    try {
      await navigator.clipboard.writeText(text);
      if (feedbackKey) showCopyFeedback(feedbackKey);
      pushToast(toastMessage, "success");
    } catch (err) {
      pushToast("Copy failed", "warning");
    }
  }

  function getExportClassification(): LinkClassification | "all" {
    if (
      activeTab === "broken" ||
      activeTab === "blocked" ||
      activeTab === "ok" ||
      activeTab === "no_response"
    ) {
      return activeTab;
    }
    return "all";
  }

  function buildReportLink(scanRunId: string) {
    return buildAppUrl("/report", { scanRunId });
  }

  function openReport(scanRunId: string) {
    const url = buildReportLink(scanRunId);
    window.history.pushState({}, "", url);
    setReportScanRunId(scanRunId);
    setReportData(null);
    setReportError(null);
    setViewMode("report");
  }

  function backToDashboard() {
    const url = buildAppUrl("/");
    window.history.pushState({}, "", url);
    setReportScanRunId(null);
    setReportData(null);
    setReportError(null);
    setViewMode("dashboard");
  }

  function triggerExport(
    format: "csv" | "json",
    classificationOverride?: string,
  ) {
    if (!selectedRunId) return;
    const classification = classificationOverride ?? getExportClassification();
    const url = `${API_BASE}/scan-runs/${encodeURIComponent(selectedRunId)}/links/export.${format}?classification=${encodeURIComponent(classification)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setExportMenuOpen(false);
    pushToast("Export started", "info");
  }

  async function handleRetryScan() {
    const retryUrl = selectedRun?.start_url ?? startUrl;
    if (!selectedRun || !retryUrl.trim()) return;
    setStartUrl(retryUrl);
    setResults([]);
    resetOccurrencesState();
    await handleRunScanWithUrl(retryUrl);
  }

  async function handleIgnoreLink(
    row: ScanLink,
    mode:
      | "this_scan"
      | "site_rule_contains"
      | "site_rule_exact"
      | "site_rule_regex",
  ) {
    if (!selectedRunId) return;
    try {
      setResults((prev) => prev.filter((item) => item.id !== row.id));
      setExpandedRowIds((prev) => {
        const copy = { ...prev };
        delete copy[row.id];
        return copy;
      });
      setOccurrencesByLinkId((prev) => {
        const copy = { ...prev };
        delete copy[row.id];
        return copy;
      });
      setOccurrencesOffsetByLinkId((prev) => {
        const copy = { ...prev };
        delete copy[row.id];
        return copy;
      });
      setOccurrencesHasMoreByLinkId((prev) => {
        const copy = { ...prev };
        delete copy[row.id];
        return copy;
      });
      setOccurrencesLoadingByLinkId((prev) => {
        const copy = { ...prev };
        delete copy[row.id];
        return copy;
      });
      setOccurrencesTotalByLinkId((prev) => {
        const copy = { ...prev };
        delete copy[row.id];
        return copy;
      });
      setOccurrencesErrorByLinkId((prev) => {
        const copy = { ...prev };
        delete copy[row.id];
        return copy;
      });

      const res = await fetch(
        `${API_BASE}/scan-runs/${encodeURIComponent(selectedRunId)}/scan-links/${encodeURIComponent(row.id)}/ignore`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode }),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Ignore failed: ${res.status}${text ? ` - ${text.slice(0, 200)}` : ""}`,
        );
      }

      if (selectedRunId) {
        await loadResults(selectedRunId);
        await loadIgnoredResults(selectedRunId);
      }
      pushToast("Ignored link", "info");
    } catch (err: unknown) {
      if (selectedRunId) {
        await loadResults(selectedRunId);
      }
      pushToast(getErrorMessage(err, "Failed to ignore link"), "warning");
    }
  }

  async function loadIgnoreRules(siteId: string) {
    setIgnoreRulesLoading(true);
    setIgnoreRulesError(null);
    try {
      const res = await fetch(
        `${API_BASE}/sites/${encodeURIComponent(siteId)}/ignore-rules`,
        {
          cache: "no-store",
        },
      );
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = await res.json();
      setIgnoreRules(data.rules ?? []);
    } catch (err: unknown) {
      setIgnoreRulesError(getErrorMessage(err, "Failed to load ignore rules"));
    } finally {
      setIgnoreRulesLoading(false);
    }
  }

  async function loadDiff(runId: string, compareTo: string) {
    setDiffLoading(true);
    setDiffError(null);
    try {
      const res = await fetch(
        `${API_BASE}/scan-runs/${encodeURIComponent(runId)}/diff?compareTo=${encodeURIComponent(compareTo)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data: DiffResponse = await res.json();
      setDiffData(data.diff);
    } catch (err: unknown) {
      setDiffError(getErrorMessage(err, "Failed to load diff"));
      setDiffData(null);
    } finally {
      setDiffLoading(false);
    }
  }

  async function toggleDiffOccurrences(runId: string, linkUrl: string) {
    const key = `${runId}:${linkUrl}`;
    if (diffOccurrences[key]) {
      setDiffOccurrences((prev) => {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      return;
    }

    setDiffOccLoading((prev) => ({ ...prev, [key]: true }));
    setDiffOccError((prev) => ({ ...prev, [key]: null }));
    try {
      const res = await fetch(
        `${API_BASE}/scan-runs/${encodeURIComponent(runId)}/links/${encodeURIComponent(linkUrl)}/occurrences?limit=${DIFF_OCCURRENCES_LIMIT}&offset=0`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data: ScanLinkOccurrencesResponse = await res.json();
      setDiffOccurrences((prev) => ({
        ...prev,
        [key]: data.occurrences ?? [],
      }));
    } catch (err: unknown) {
      setDiffOccError((prev) => ({
        ...prev,
        [key]: getErrorMessage(err, "Failed to load occurrences"),
      }));
    } finally {
      setDiffOccLoading((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function toggleIgnoredOccurrences(
    ignoredLinkId: string,
    scanRunId: string,
  ) {
    if (ignoredOccurrences[ignoredLinkId]) {
      setIgnoredOccurrences((prev) => {
        const copy = { ...prev };
        delete copy[ignoredLinkId];
        return copy;
      });
      return;
    }

    setIgnoredOccLoading((prev) => ({ ...prev, [ignoredLinkId]: true }));
    setIgnoredOccError((prev) => ({ ...prev, [ignoredLinkId]: null }));
    try {
      const res = await fetch(
        `${API_BASE}/scan-runs/${encodeURIComponent(scanRunId)}/ignored/${encodeURIComponent(ignoredLinkId)}/occurrences?limit=${IGNORED_OCCURRENCES_LIMIT}&offset=0`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data: IgnoredOccurrencesResponse = await res.json();
      setIgnoredOccurrences((prev) => ({
        ...prev,
        [ignoredLinkId]: data.occurrences ?? [],
      }));
    } catch (err: unknown) {
      setIgnoredOccError((prev) => ({
        ...prev,
        [ignoredLinkId]: getErrorMessage(err, "Failed to load occurrences"),
      }));
    } finally {
      setIgnoredOccLoading((prev) => ({ ...prev, [ignoredLinkId]: false }));
    }
  }
  async function reapplyIgnoreRules(runId: string) {
    await fetch(
      `${API_BASE}/scan-runs/${encodeURIComponent(runId)}/reapply-ignore?force=1`,
      {
        method: "POST",
      },
    );
  }

  async function handleCreateIgnoreRule() {
    if (!selectedSiteId) return;
    const pattern = newRulePattern.trim();
    if (!pattern) return;
    try {
      const res = await fetch(
        `${API_BASE}/sites/${encodeURIComponent(selectedSiteId)}/ignore-rules`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ruleType: newRuleType,
            pattern,
            scope: newRuleScope,
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Create failed: ${res.status}${text ? ` - ${text.slice(0, 200)}` : ""}`,
        );
      }
      setNewRulePattern("");
      await loadIgnoreRules(selectedSiteId);
      if (selectedRunId) await reapplyIgnoreRules(selectedRunId);
      pushToast("Ignore rule created", "success");
    } catch (err: unknown) {
      pushToast(
        getErrorMessage(err, "Failed to create ignore rule"),
        "warning",
      );
    }
  }

  async function handleToggleIgnoreRule(rule: IgnoreRule) {
    try {
      const res = await fetch(
        `${API_BASE}/ignore-rules/${encodeURIComponent(rule.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isEnabled: !rule.is_enabled }),
        },
      );
      if (!res.ok) throw new Error(`Update failed: ${res.status}`);
      if (selectedSiteId) await loadIgnoreRules(selectedSiteId);
      if (selectedRunId) await reapplyIgnoreRules(selectedRunId);
      pushToast(rule.is_enabled ? "Rule disabled" : "Rule enabled", "info");
    } catch (err: unknown) {
      pushToast(getErrorMessage(err, "Failed to update rule"), "warning");
    }
  }

  async function handleDeleteIgnoreRule(rule: IgnoreRule) {
    try {
      const res = await fetch(
        `${API_BASE}/ignore-rules/${encodeURIComponent(rule.id)}`,
        {
          method: "DELETE",
        },
      );
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      if (selectedSiteId) await loadIgnoreRules(selectedSiteId);
      if (selectedRunId) await reapplyIgnoreRules(selectedRunId);
      pushToast("Rule deleted", "info");
    } catch (err: unknown) {
      pushToast(getErrorMessage(err, "Failed to delete rule"), "warning");
    }
  }

  async function handleRunScanWithUrl(url: string) {
    if (!selectedSiteId || !url.trim()) return;

    setTriggeringScan(true);
    setTriggerError(null);
    try {
      const res = await fetch(
        `${API_BASE}/sites/${encodeURIComponent(selectedSiteId)}/scans`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ startUrl: url }),
        },
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Scan trigger failed: ${res.status}${text ? ` - ${text.slice(0, 200)}` : ""}`,
        );
      }

      const data = await res.json();
      const scanRunId: string | undefined = data.scanRunId;

      if (scanRunId) {
        const optimistic: ScanRunSummary = {
          id: scanRunId,
          site_id: selectedSiteId,
          status: "in_progress",
          started_at: new Date().toISOString(),
          finished_at: null,
          start_url: url,
          total_links: 0,
          checked_links: 0,
          broken_links: 0,
        };

        setHistory((prev) => {
          const without = prev.filter((r) => r.id !== scanRunId);
          return [optimistic, ...without];
        });

        setResults([]);
        resetOccurrencesState();

        setSelectedRunId(scanRunId);
        selectedRunIdRef.current = scanRunId;

        setActiveRunId(scanRunId);
        activeRunIdRef.current = scanRunId;
        markRunProgress(scanRunId);

        startSse(scanRunId);
        void refreshSelectedRun(scanRunId);
        pushToast("Scan started", "info");
      } else {
        await loadHistory(selectedSiteId, { preserveSelection: false });
      }
    } catch (err: unknown) {
      setTriggerError(getErrorMessage(err, "Failed to start scan"));
    } finally {
      setTriggeringScan(false);
    }
  }

  function handleThemeChange(next: ThemePreference) {
    setThemePreference(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
  }

  function handleThemeToggle() {
    const next = themeMode === "dark" ? "light" : "dark";
    handleThemeChange(next);
  }

  function pushToast(
    message: string,
    tone: "success" | "warning" | "info" = "info",
  ) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 2200);
  }

  function maybeNotifyRunStatus(run: ScanRunSummary) {
    const prev = runStatusRef.current.get(run.id);
    if (prev === run.status) return;
    runStatusRef.current.set(run.id, run.status);
    if (run.status === "completed") pushToast("Scan completed", "success");
    if (run.status === "failed") pushToast("Scan failed", "warning");
  }

  function toggleStatusFilter(key: string) {
    setStatusFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  type LinkRowTheme = {
    accent: string;
    border: string;
    copyBorder: string;
    copyColor: string;
    panelBg: string;
    loadMoreBg: string;
    loadMoreColor: string;
  };

  function renderLinkRows(
    rows: ScanLink[],
    themeForRow: (row: ScanLink) => LinkRowTheme,
  ) {
    return rows.map((row) => {
      const theme = themeForRow(row);
      const isExpanded = !!expandedRowIds[row.id];
      const occurrences = occurrencesByLinkId[row.id] ?? [];
      const occurrencesTotal =
        occurrencesTotalByLinkId[row.id] ?? row.occurrence_count;
      const occurrencesLoading = occurrencesLoadingByLinkId[row.id] ?? false;
      const occurrencesError = occurrencesErrorByLinkId[row.id];
      const occurrencesHasMore = occurrencesHasMoreByLinkId[row.id] ?? false;
      const linkCopyKey = `link:${row.id}`;
      const sourceCopyKey = `source:${row.id}`;
      const firstSource = occurrences[0]?.source_page;
      const canCopySource = !!firstSource;
      const host = safeHost(row.link_url);
      const statusChipBg =
        row.status_code == null
          ? "var(--border)"
          : row.status_code >= 500
            ? "var(--danger)"
            : row.status_code === 404 || row.status_code === 410
              ? "var(--danger)"
              : row.status_code === 401 ||
                  row.status_code === 403 ||
                  row.status_code === 429
                ? "var(--warning)"
                : "var(--success)";
      const statusChipText = row.status_code == null ? "var(--muted)" : "white";

      return (
        <div
          id={`scan-link-${row.id}`}
          key={row.id}
          className={`result-row ${isExpanded ? "expanded" : ""}`}
          style={{
            borderRadius: "10px",
            border: `1px solid ${theme.border}`,
            background: theme.panelBg,
            display: "flex",
            flexDirection: "column",
            boxShadow: isExpanded ? "0 0 0 2px var(--accent)" : "none",
            opacity: row.ignored ? 0.75 : 1,
          }}
        >
          <div
            style={{
              padding: "8px 10px",
              display: "flex",
              gap: "8px",
              alignItems: "flex-start",
            }}
          >
            <button
              onClick={() => toggleExpandLink(row.id)}
              style={{
                background: "transparent",
                border: "none",
                color: theme.accent,
                cursor: "pointer",
                padding: "0 4px",
                fontSize: "16px",
                lineHeight: "1.2",
                marginTop: "2px",
              }}
              title={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? "▼" : "▶"}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  flexWrap: "wrap",
                  marginBottom: "6px",
                }}
              >
                <span style={{ fontWeight: 600, fontSize: "13px" }}>
                  {host}
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    padding: "2px 6px",
                    borderRadius: "999px",
                    background: statusChipBg,
                    color: statusChipText,
                    maxWidth: "100%",
                  }}
                  title={statusTooltip(row.status_code)}
                >
                  {row.status_code ?? "No HTTP response"}
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    padding: "2px 6px",
                    borderRadius: "999px",
                    background: "var(--chip-bg)",
                    color: "var(--chip-text)",
                    border: `1px solid ${theme.border}`,
                    textTransform: "capitalize",
                  }}
                >
                  {formatClassification(row.classification)}
                </span>
                {row.classification === "no_response" && row.error_message && (
                  <span
                    style={{
                      fontSize: "11px",
                      padding: "2px 6px",
                      borderRadius: "999px",
                      background: "var(--panel)",
                      color: "var(--muted)",
                      border: "1px solid var(--border)",
                      maxWidth: "100%",
                    }}
                    title={row.error_message}
                  >
                    {row.error_message}
                  </span>
                )}
                {row.ignored && (
                  <span
                    style={{
                      fontSize: "11px",
                      padding: "2px 6px",
                      borderRadius: "999px",
                      background: "var(--panel)",
                      color: "var(--muted)",
                      border: "1px dashed var(--border)",
                    }}
                  >
                    Ignored
                  </span>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  minWidth: 0,
                }}
              >
                <a
                  href={row.link_url}
                  target="_blank"
                  rel="noreferrer"
                  title={row.link_url}
                  style={{
                    color: theme.accent,
                    textDecoration: "underline",
                    fontSize: "12px",
                    flex: 1,
                    minWidth: 0,
                    maxWidth: "100%",
                    overflowWrap: "anywhere",
                    wordBreak: "break-word",
                    whiteSpace: "normal",
                  }}
                >
                  {row.link_url}
                </a>
                <div className="row-actions">
                  <button
                    onClick={() => copyToClipboard(row.link_url, linkCopyKey)}
                    className="icon-button"
                    style={{
                      borderColor: theme.copyBorder,
                      color: theme.copyColor,
                    }}
                    aria-label="Copy link"
                    title="Copy link"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      aria-hidden="true"
                    >
                      <rect
                        x="9"
                        y="9"
                        width="10"
                        height="10"
                        rx="2"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      />
                      <rect
                        x="5"
                        y="5"
                        width="10"
                        height="10"
                        rx="2"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      />
                    </svg>
                  </button>
                  <button
                    onClick={() =>
                      firstSource && copyToClipboard(firstSource, sourceCopyKey)
                    }
                    className="icon-button"
                    style={{
                      borderColor: theme.copyBorder,
                      color: theme.copyColor,
                    }}
                    disabled={!canCopySource}
                    aria-label="Copy source"
                    title={
                      canCopySource ? "Copy source page" : "Source not loaded"
                    }
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      aria-hidden="true"
                    >
                      <path
                        d="M4 6h10a2 2 0 0 1 2 2v10H6a2 2 0 0 1-2-2V6z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      />
                      <path
                        d="M8 4h10a2 2 0 0 1 2 2v10"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      />
                    </svg>
                  </button>
                  <button
                    onClick={() =>
                      window.open(row.link_url, "_blank", "noopener,noreferrer")
                    }
                    className="icon-button"
                    style={{
                      borderColor: theme.copyBorder,
                      color: theme.copyColor,
                    }}
                    aria-label="Open link"
                    title="Open link"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      aria-hidden="true"
                    >
                      <path
                        d="M9 5h10v10"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      />
                      <path
                        d="M19 5l-9 9"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      />
                      <path
                        d="M5 9v10h10"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleIgnoreLink(row, "site_rule_exact")}
                    className="icon-button"
                    style={{
                      borderColor: theme.copyBorder,
                      color: theme.copyColor,
                    }}
                    disabled={row.ignored}
                    aria-label="Ignore link"
                    title={row.ignored ? "Already ignored" : "Ignore link"}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      aria-hidden="true"
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="9"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      />
                      <path
                        d="M7 7l10 10"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              {row.error_message && (
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--muted)",
                    marginTop: "4px",
                    overflowWrap: "anywhere",
                  }}
                >
                  {row.error_message}
                </div>
              )}
              <div
                style={{
                  fontSize: "11px",
                  color: "var(--muted)",
                  marginTop: "2px",
                }}
              >
                found on {row.occurrence_count}{" "}
                {row.occurrence_count === 1 ? "page" : "pages"}
              </div>
            </div>
          </div>

          {isExpanded && (
            <div
              className="expand-panel"
              style={{
                marginTop: "6px",
                padding: "10px 12px",
                borderTop: `1px solid ${theme.border}`,
                background: "var(--panel)",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                Seen on {occurrencesTotal}{" "}
                {occurrencesTotal === 1 ? "page" : "pages"}
              </div>
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--muted)",
                  overflowWrap: "anywhere",
                }}
              >
                <a
                  href={row.link_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--text)", textDecoration: "underline" }}
                >
                  {row.link_url}
                </a>{" "}
                · status{" "}
                <span title={statusTooltip(row.status_code)}>
                  {row.status_code ?? "No HTTP response"}
                </span>{" "}
                {row.error_message ? `· ${row.error_message}` : ""}
              </div>
              {row.ignored && (
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--muted)",
                    display: "flex",
                    gap: "8px",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <span>
                    {row.ignored_source === "rule"
                      ? "Ignored by rule"
                      : "Manually ignored"}
                    {row.ignore_reason ? ` · ${row.ignore_reason}` : ""}
                  </span>
                  {row.ignored_source === "rule" && row.ignored_by_rule_id && (
                    <button
                      onClick={() => setIgnoreRulesOpen(true)}
                      style={{
                        padding: "2px 6px",
                        borderRadius: "6px",
                        border: "1px solid var(--border)",
                        background: "var(--panel)",
                        fontSize: "10px",
                        cursor: "pointer",
                      }}
                    >
                      Manage rules
                    </button>
                  )}
                </div>
              )}
              {occurrencesLoading && occurrences.length === 0 && (
                <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                  Loading occurrences...
                </div>
              )}
              {occurrencesError && (
                <div style={{ fontSize: "12px", color: "var(--warning)" }}>
                  {occurrencesError}
                </div>
              )}
              {occurrences.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  {occurrences.map((occ) => (
                    <div
                      key={occ.id}
                      style={{
                        padding: "6px 8px",
                        borderRadius: "8px",
                        border: "1px solid var(--border)",
                        background: "var(--panel-elev)",
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                      }}
                    >
                      <a
                        href={occ.source_page}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          flex: 1,
                          minWidth: 0,
                          color: "var(--text)",
                          textDecoration: "underline",
                          overflowWrap: "anywhere",
                          wordBreak: "break-word",
                        }}
                      >
                        {occ.source_page}
                      </a>
                      <button
                        onClick={() =>
                          copyToClipboard(occ.source_page, `occ:${occ.id}`)
                        }
                        style={{
                          padding: "2px 6px",
                          borderRadius: "6px",
                          border: "1px solid var(--border)",
                          background: "var(--panel)",
                          fontSize: "10px",
                          cursor: "pointer",
                        }}
                      >
                        {copyFeedback[`occ:${occ.id}`] ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  ))}
                  {occurrencesHasMore && (
                    <button
                      onClick={() => handleLoadMoreOccurrences(row.id)}
                      disabled={occurrencesLoading}
                      style={{
                        padding: "6px 10px",
                        borderRadius: "8px",
                        border: "1px solid var(--border)",
                        background: "var(--panel)",
                        cursor: occurrencesLoading ? "default" : "pointer",
                        fontSize: "11px",
                      }}
                    >
                      {occurrencesLoading
                        ? "Loading..."
                        : "Load more occurrences"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      );
    });
  }

  const brokenTheme: LinkRowTheme = {
    accent: "var(--danger)",
    border: "var(--danger)",
    copyBorder: "var(--danger)",
    copyColor: "var(--danger)",
    panelBg: "var(--panel-elev)",
    loadMoreBg: "var(--danger)",
    loadMoreColor: "white",
  };

  const blockedTheme: LinkRowTheme = {
    accent: "var(--warning)",
    border: "var(--warning)",
    copyBorder: "var(--warning)",
    copyColor: "var(--warning)",
    panelBg: "var(--panel-elev)",
    loadMoreBg: "var(--warning)",
    loadMoreColor: "white",
  };

  const okTheme: LinkRowTheme = {
    accent: "var(--success)",
    border: "var(--success)",
    copyBorder: "var(--success)",
    copyColor: "var(--success)",
    panelBg: "var(--panel-elev)",
    loadMoreBg: "var(--success)",
    loadMoreColor: "white",
  };

  const noResponseTheme: LinkRowTheme = {
    accent: "var(--muted)",
    border: "var(--border)",
    copyBorder: "var(--border)",
    copyColor: "var(--muted)",
    panelBg: "var(--panel-elev)",
    loadMoreBg: "var(--border)",
    loadMoreColor: "var(--text)",
  };

  return (
    <div
      className="app-shell"
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--text)",
        padding: "24px",
        maxWidth: "100%",
        overflowX: "hidden",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        :root[data-theme="dark"] {
          --bg: #0b1220;
          --panel: #0f172a;
          --panel-elev: #111827;
          --text: #e5e7eb;
          --muted: #9ca3af;
          --border: #1f2937;
          --accent: #60a5fa;
          --danger: #ef4444;
          --warning: #f59e0b;
          --success: #22c55e;
          --shadow: 0 12px 30px rgba(0, 0, 0, 0.28);
          --chip-bg: #111827;
          --chip-text: #e5e7eb;
          --ghost: #0b1220;
        }
        :root[data-theme="light"] {
          --bg: #f8fafc;
          --panel: #ffffff;
          --panel-elev: #f1f5f9;
          --text: #0f172a;
          --muted: #64748b;
          --border: #e2e8f0;
          --accent: #2563eb;
          --danger: #dc2626;
          --warning: #d97706;
          --success: #16a34a;
          --shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
          --chip-bg: #f1f5f9;
          --chip-text: #0f172a;
          --ghost: #ffffff;
        }
        html, body, * {
          transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
        }
        .app-container {
          max-width: 1240px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 24px;
          font-family: "Inter", system-ui, -apple-system, sans-serif;
        }
        .app-shell {
          background: radial-gradient(1200px 400px at 10% -10%, rgba(59, 130, 246, 0.18), transparent 60%),
            radial-gradient(800px 300px at 90% 0%, rgba(14, 165, 233, 0.12), transparent 60%),
            var(--bg);
        }
        .shell {
          display: flex;
          gap: 16px;
          align-items: stretch;
        }
        .top-nav {
          position: sticky;
          top: 0;
          z-index: 20;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          padding: 12px 16px;
          border: 1px solid var(--border);
          border-radius: 14px;
          background: var(--panel);
          box-shadow: var(--shadow);
        }
        .hamburger {
          display: none;
        }
        .drawer-close {
          display: none;
        }
        .drawer-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.5);
          z-index: 30;
        }
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.45);
          z-index: 60;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }
        .modal {
          width: min(560px, 100%);
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 14px;
          box-shadow: var(--shadow);
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .sidebar.drawer {
          transition: transform 180ms ease;
        }
        .sidebar.drawer.open {
          transform: translateX(0);
        }
        .sidebar {
          width: 320px;
          min-width: 240px;
          max-width: 520px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .main {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .resizer {
          width: 6px;
          cursor: col-resize;
          background: var(--border);
          border-radius: 999px;
          align-self: stretch;
        }
        .results-layout {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        .result-row {
          transition: transform 140ms ease, box-shadow 140ms ease;
          position: relative;
          overflow: visible;
        }
        .result-row:hover {
          transform: translateY(-2px);
        }
        .result-row.expanded,
        .result-row.expanded:hover {
          transform: none;
          z-index: 2;
        }
        .row-actions {
          display: inline-flex;
          gap: 6px;
          opacity: 0;
          transition: opacity 140ms ease;
        }
        .result-row:hover .row-actions {
          opacity: 1;
        }
        .icon-button {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text);
          cursor: pointer;
          padding: 4px;
          border-radius: 6px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .icon-button:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }
        .expand-panel {
          animation: expandFade 160ms ease;
        }
        @keyframes expandFade {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (max-width: 980px) {
          .row-actions {
            opacity: 1;
          }
        }
        .results-layout.drawer-open {
          grid-template-columns: minmax(0, 1fr) minmax(280px, 380px);
        }
        .drawer {
          position: sticky;
          top: 16px;
          align-self: start;
          max-height: calc(100vh - 120px);
          overflow: hidden;
        }
        .toast-stack {
          position: fixed;
          right: 24px;
          bottom: 24px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          z-index: 50;
        }
        .toast {
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--panel);
          color: var(--text);
          box-shadow: var(--shadow);
          font-size: 12px;
        }
        .skeleton {
          height: 44px;
          border-radius: 10px;
          background: linear-gradient(90deg, var(--panel-elev), var(--panel), var(--panel-elev));
          background-size: 200% 100%;
          animation: shimmer 1.2s ease-in-out infinite;
        }
        .scan-progress {
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 12px 14px;
          background: var(--panel-elev);
          display: flex;
          flex-direction: column;
          gap: 10px;
          box-shadow: var(--shadow);
        }
        .scan-progress.completed {
          border-color: rgba(34, 197, 94, 0.6);
        }
        .scan-progress.stopped {
          border-color: rgba(239, 68, 68, 0.6);
        }
        .scan-progress__header {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
          flex-wrap: wrap;
        }
        .scan-progress__title {
          font-weight: 600;
          color: var(--text);
          font-size: 14px;
        }
        .scan-progress__subtitle {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          font-size: 12px;
          color: var(--muted);
        }
        .scan-progress__percent {
          font-weight: 600;
          color: var(--text);
          font-size: 14px;
        }
        .scan-progress__state {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 600;
        }
        .scan-progress__state--complete {
          color: var(--success);
        }
        .scan-progress__state--stopped {
          color: var(--danger);
        }
        .scan-progress__check {
          width: 18px;
          height: 18px;
          border-radius: 999px;
          background: var(--success);
          color: white;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          line-height: 1;
        }
        .scan-progress__track {
          position: relative;
          height: 8px;
          background: var(--border);
          border-radius: 999px;
          overflow: hidden;
        }
        .scan-progress__fill {
          height: 100%;
          background: linear-gradient(90deg, rgba(59, 130, 246, 0.2), var(--accent), rgba(59, 130, 246, 0.2));
          border-radius: inherit;
          transition: width 420ms ease;
        }
        .scan-progress.running .scan-progress__fill {
          background-size: 200% 100%;
          animation: scanProgressGlow 1.8s linear infinite;
        }
        .scan-progress.completed .scan-progress__fill {
          background: linear-gradient(90deg, rgba(34, 197, 94, 0.2), var(--success), rgba(34, 197, 94, 0.2));
        }
        .scan-progress.stopped .scan-progress__fill {
          background: linear-gradient(90deg, rgba(239, 68, 68, 0.2), var(--danger), rgba(239, 68, 68, 0.2));
        }
        .scan-progress__track.indeterminate .scan-progress__fill {
          position: absolute;
          width: 40%;
          animation: progressSlide 1.2s ease-in-out infinite, scanProgressGlow 1.8s linear infinite;
        }
        .scan-progress__hint {
          font-size: 12px;
          color: var(--muted);
        }
        .filter-dropdown {
          position: relative;
        }
        .filter-dropdown__panel {
          position: absolute;
          top: calc(100% + 8px);
          left: 0;
          min-width: 260px;
          max-width: 360px;
          padding: 10px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--panel);
          box-shadow: var(--shadow);
          z-index: 20;
        }
        .filter-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 8px;
        }
        .filter-row:last-child {
          margin-bottom: 0;
        }
        @media (max-width: 720px) {
          .filter-dropdown__panel {
            right: 0;
            left: auto;
            max-width: 90vw;
          }
        }
        @keyframes scanProgressGlow {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
        @keyframes progressSlide {
          0% { transform: translateX(-60%); }
          50% { transform: translateX(40%); }
          100% { transform: translateX(160%); }
        }
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        .tab-pill {
          padding: 6px 12px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: transparent;
          color: var(--muted);
          cursor: pointer;
          font-size: 12px;
        }
        .tab-pill.active {
          background: var(--accent);
          color: white;
          border-color: var(--accent);
        }
        @media (max-width: 1100px) {
          .shell {
            flex-direction: column;
          }
          .sidebar {
            width: 100%;
            max-width: 100%;
          }
          .resizer {
            display: none;
          }
          .results-layout.drawer-open {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 1200px) {
          .shell {
            flex-direction: column;
          }
          .sidebar {
            display: none;
          }
          .sidebar.drawer {
            display: flex;
            position: fixed;
            left: 0;
            top: 0;
            height: 100%;
            z-index: 40;
            transform: translateX(-100%);
          }
          .sidebar.drawer.open {
            transform: translateX(0);
          }
          .hamburger {
            display: inline-flex;
          }
          .drawer-close {
            display: inline-flex;
          }
        }
        @media (max-width: 860px) {
          .results-layout.drawer-open {
            grid-template-columns: 1fr;
          }
        }
        .top-grid {
          display: grid;
          grid-template-columns: minmax(280px, 1.1fr) minmax(280px, 1.6fr) minmax(280px, 1.3fr);
          gap: 16px;
        }
        .bottom-grid {
          display: grid;
          grid-template-columns: minmax(320px, 1.5fr) minmax(320px, 1fr) minmax(320px, 1fr);
          gap: 16px;
        }
        .card {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 16px;
          box-shadow: var(--shadow);
        }
        .focus-ring:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        button:focus-visible,
        input:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        .scroll-y {
          overflow-y: auto;
          overflow-x: hidden;
        }
        .report-page {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .report-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          flex-wrap: wrap;
        }
        .report-title {
          font-size: 20px;
          font-weight: 700;
        }
        .report-subtitle {
          font-size: 12px;
          color: var(--muted);
        }
        .report-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .report-button {
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: var(--panel);
          color: var(--text);
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
        }
        .report-card {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 12px;
          box-shadow: var(--shadow);
        }
        .report-meta {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 12px;
        }
        .report-meta-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }
        .report-label {
          font-size: 11px;
          color: var(--muted);
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .report-value {
          font-size: 13px;
          color: var(--text);
          word-break: break-word;
        }
        .report-summary-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 12px;
        }
        .report-summary-card {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .report-metric {
          font-size: 22px;
          font-weight: 700;
          color: var(--text);
        }
        .report-table-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 12px;
        }
        .report-table-title {
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 8px;
        }
        .report-table-wrap {
          overflow-x: auto;
        }
        .report-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        .report-table th,
        .report-table td {
          padding: 8px;
          border-bottom: 1px solid var(--border);
          text-align: left;
        }
        .report-table th {
          font-size: 10px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .report-empty {
          padding: 12px;
          text-align: center;
          color: var(--muted);
        }
        .report-footer {
          font-size: 12px;
          color: var(--muted);
          text-align: right;
        }
        @media print {
          .report-actions {
            display: none;
          }
          .app-shell {
            padding: 0;
          }
        }
        @media (max-width: 1100px) {
          .top-grid {
            grid-template-columns: 1fr;
          }
          .bottom-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
      <div className="app-container">
        {reportView ? (
          <div className="report-page">
            <div className="report-header">
              <div>
                <div className="report-title">Link Sentry</div>
                <div className="report-subtitle">Scan Report</div>
              </div>
              <div className="report-actions">
                <button className="report-button" onClick={backToDashboard}>
                  Back to dashboard
                </button>
                <button
                  className="report-button"
                  onClick={() =>
                    reportScanRunId &&
                    copyToClipboard(
                      buildReportLink(reportScanRunId),
                      undefined,
                      "Copied link",
                    )
                  }
                  disabled={!reportScanRunId}
                >
                  Copy report link
                </button>
              </div>
            </div>

            <div className="report-card report-meta">
              <div className="report-meta-item">
                <div className="report-label">Site</div>
                <div className="report-value">{reportSite ?? "-"}</div>
              </div>
              <div className="report-meta-item">
                <div className="report-label">Start URL</div>
                <div className="report-value">
                  {reportRun?.start_url ?? "-"}
                </div>
              </div>
              <div className="report-meta-item">
                <div className="report-label">Status</div>
                <div className="report-value">{reportRun?.status ?? "-"}</div>
              </div>
              <div className="report-meta-item">
                <div className="report-label">Started</div>
                <div className="report-value">
                  {formatDate(reportRun?.started_at ?? null)}
                </div>
              </div>
              <div className="report-meta-item">
                <div className="report-label">Finished</div>
                <div className="report-value">
                  {formatDate(reportRun?.finished_at ?? null)}
                </div>
              </div>
              <div className="report-meta-item">
                <div className="report-label">Duration</div>
                <div className="report-value">
                  {formatDuration(
                    reportRun?.started_at,
                    reportRun?.finished_at,
                  )}
                </div>
              </div>
            </div>

            {reportLoading && (
              <div
                className="report-card"
                style={{ fontSize: "13px", color: "var(--muted)" }}
              >
                Loading report…
              </div>
            )}
            {reportError && (
              <div
                className="report-card"
                style={{ fontSize: "13px", color: "var(--warning)" }}
              >
                {reportError}
              </div>
            )}

            {!reportLoading && reportData && (
              <>
                <div className="report-summary-grid">
                  <div className="report-card report-summary-card">
                    <div className="report-label">Broken</div>
                    <div className="report-metric">
                      {reportSummary.broken ?? 0}
                    </div>
                  </div>
                  <div className="report-card report-summary-card">
                    <div className="report-label">Blocked</div>
                    <div className="report-metric">
                      {reportSummary.blocked ?? 0}
                    </div>
                  </div>
                  <div className="report-card report-summary-card">
                    <div className="report-label">No response</div>
                    <div className="report-metric">
                      {reportSummary.no_response ?? 0}
                    </div>
                  </div>
                  <div className="report-card report-summary-card">
                    <div className="report-label">Timeout</div>
                    <div className="report-metric">
                      {reportSummary.timeout ?? 0}
                    </div>
                  </div>
                  <div className="report-card report-summary-card">
                    <div className="report-label">OK</div>
                    <div className="report-metric">{reportSummary.ok ?? 0}</div>
                  </div>
                </div>

                <div className="report-table-grid">
                  <div className="report-card">
                    <div className="report-table-title">Top broken links</div>
                    <div className="report-table-wrap">
                      <table className="report-table">
                        <thead>
                          <tr>
                            <th>Link</th>
                            <th>Status</th>
                            <th>Error</th>
                            <th>Occurrences</th>
                            <th>Last seen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.topBroken.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="report-empty">
                                No broken links found.
                              </td>
                            </tr>
                          ) : (
                            reportData.topBroken.map((row) => (
                              <tr key={`${row.link_url}-${row.last_seen_at}`}>
                                <td>{row.link_url}</td>
                                <td>{row.status_code ?? "-"}</td>
                                <td>{row.error_message ?? "-"}</td>
                                <td>{row.occurrence_count}</td>
                                <td>{formatDate(row.last_seen_at)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="report-card">
                    <div className="report-table-title">Top blocked links</div>
                    <div className="report-table-wrap">
                      <table className="report-table">
                        <thead>
                          <tr>
                            <th>Link</th>
                            <th>Status</th>
                            <th>Error</th>
                            <th>Occurrences</th>
                            <th>Last seen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.topBlocked.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="report-empty">
                                No blocked links found.
                              </td>
                            </tr>
                          ) : (
                            reportData.topBlocked.map((row) => (
                              <tr key={`${row.link_url}-${row.last_seen_at}`}>
                                <td>{row.link_url}</td>
                                <td>{row.status_code ?? "-"}</td>
                                <td>{row.error_message ?? "-"}</td>
                                <td>{row.occurrence_count}</td>
                                <td>{formatDate(row.last_seen_at)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="report-footer">
                  Generated {formatDate(reportData.generatedAt)}
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <nav className="top-nav">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  minWidth: 0,
                }}
              >
                <button
                  ref={hamburgerRef}
                  onClick={() => setIsDrawerOpen(true)}
                  className="hamburger"
                  style={{
                    border: "1px solid var(--border)",
                    background: "var(--panel)",
                    borderRadius: "10px",
                    padding: "6px 8px",
                    cursor: "pointer",
                    fontSize: "14px",
                  }}
                  title="Open menu"
                >
                  ☰
                </button>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "16px" }}>
                    Link Sentry
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                    Link integrity monitor
                  </div>
                </div>
              </div>

              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: "center",
                  fontSize: "12px",
                  color: "var(--muted)",
                  padding: "0 8px",
                }}
              >
                Dashboard
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  flexWrap: "wrap",
                }}
              >
                <button
                  onClick={handleThemeToggle}
                  style={{
                    position: "relative",
                    width: "44px",
                    height: "24px",
                    borderRadius: "999px",
                    border: "1px solid var(--border)",
                    background:
                      themeMode === "dark"
                        ? "var(--panel-elev)"
                        : "var(--accent)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                  title="Toggle theme"
                >
                  <span
                    style={{
                      position: "absolute",
                      top: "2px",
                      left: themeMode === "dark" ? "2px" : "22px",
                      width: "20px",
                      height: "20px",
                      borderRadius: "999px",
                      background: "var(--panel)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "12px",
                      transition: "left 160ms ease",
                    }}
                  >
                    {themeMode === "dark" ? "🌙" : "☀️"}
                  </span>
                </button>

                <button
                  style={{
                    padding: "6px 10px",
                    borderRadius: "10px",
                    border: "1px solid var(--border)",
                    background: "var(--panel)",
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  Login
                </button>
                <button
                  style={{
                    padding: "6px 10px",
                    borderRadius: "10px",
                    border: "1px solid var(--border)",
                    background: "var(--panel)",
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  Register
                </button>
                {/* TODO: replace auth placeholders with user menu */}
              </div>
            </nav>

            <div className="shell">
              <aside
                ref={sidebarRef}
                className={`sidebar card drawer ${isDrawerOpen ? "open" : ""}`}
                style={{ width: paneWidth }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <h1
                      style={{
                        margin: 0,
                        fontSize: "20px",
                        letterSpacing: "-0.02em",
                      }}
                    >
                      Link Sentry
                    </h1>
                    <p
                      style={{
                        margin: 0,
                        color: "var(--muted)",
                        fontSize: "12px",
                      }}
                    >
                      Link integrity monitor
                    </p>
                  </div>
                  <button
                    onClick={() => setIsDrawerOpen(false)}
                    className="drawer-close"
                    style={{
                      border: "1px solid var(--border)",
                      background: "var(--panel)",
                      borderRadius: "10px",
                      padding: "4px 6px",
                      cursor: "pointer",
                      fontSize: "12px",
                    }}
                    title="Close menu"
                  >
                    ✕
                  </button>
                </div>

                <label style={{ fontSize: "12px", color: "var(--muted)" }}>
                  Search sites
                  <input
                    value={siteSearch}
                    onChange={(e) => setSiteSearch(e.target.value)}
                    placeholder="Search by URL"
                    style={{
                      marginTop: "6px",
                      width: "100%",
                      padding: "6px 8px",
                      borderRadius: "10px",
                      border: "1px solid var(--border)",
                      background: "var(--panel)",
                      color: "var(--text)",
                      boxSizing: "border-box",
                    }}
                  />
                </label>

                <div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--muted)",
                      marginBottom: "6px",
                    }}
                  >
                    Add site
                  </div>
                  <input
                    value={newSiteUrl}
                    onChange={(e) => setNewSiteUrl(e.target.value)}
                    placeholder="https://example.com"
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      borderRadius: "10px",
                      border: "1px solid var(--border)",
                      background: "var(--panel)",
                      color: "var(--text)",
                      boxSizing: "border-box",
                    }}
                  />
                  <button
                    onClick={handleCreateSite}
                    disabled={creatingSite || !newSiteUrl.trim()}
                    style={{
                      marginTop: "8px",
                      padding: "6px 10px",
                      borderRadius: "999px",
                      border: "none",
                      background: creatingSite
                        ? "var(--panel-elev)"
                        : "var(--accent)",
                      color: "white",
                      fontWeight: 600,
                      cursor:
                        creatingSite || !newSiteUrl.trim()
                          ? "not-allowed"
                          : "pointer",
                      fontSize: "12px",
                    }}
                  >
                    {creatingSite ? "Adding..." : "Add site"}
                  </button>
                  {createError && (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--warning)",
                        marginTop: "6px",
                      }}
                    >
                      {createError}
                    </div>
                  )}
                </div>

                <div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--muted)",
                      marginBottom: "8px",
                    }}
                  >
                    Sites
                  </div>
                  {sitesLoading && (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--muted)",
                        marginBottom: "6px",
                      }}
                    >
                      Loading sites...
                    </div>
                  )}
                  {sitesError && (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--warning)",
                        marginBottom: "6px",
                      }}
                    >
                      {sitesError}
                    </div>
                  )}
                  <div
                    className="scroll-y"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      maxHeight: "220px",
                    }}
                  >
                    {filteredSites.map((site) => {
                      const isSelected = site.id === selectedSiteId;
                      const isDeleting = deletingSiteId === site.id;

                      return (
                        <div
                          key={site.id}
                          style={{
                            borderRadius: "12px",
                            border: "1px solid var(--border)",
                            background: isSelected
                              ? "var(--panel-elev)"
                              : "var(--panel)",
                            padding: "8px 10px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                          }}
                        >
                          <button
                            onClick={() => handleSelectSite(site)}
                            style={{
                              textAlign: "left",
                              border: "none",
                              background: "transparent",
                              color: "var(--text)",
                              cursor: "pointer",
                              padding: 0,
                            }}
                          >
                            <div
                              style={{
                                fontSize: "13px",
                                fontWeight: 600,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {site.url}
                            </div>
                            <div
                              style={{
                                fontSize: "11px",
                                color: "var(--muted)",
                                marginTop: "2px",
                              }}
                            >
                              created {formatDate(site.created_at)}
                            </div>
                          </button>

                          <div
                            style={{
                              display: "flex",
                              justifyContent: "flex-end",
                            }}
                          >
                            <button
                              onClick={() => handleDeleteSite(site.id)}
                              disabled={isDeleting}
                              style={{
                                padding: "4px 8px",
                                borderRadius: "999px",
                                border: "1px solid var(--danger)",
                                background: isDeleting
                                  ? "var(--panel-elev)"
                                  : "var(--panel)",
                                color: "var(--danger)",
                                cursor: isDeleting ? "not-allowed" : "pointer",
                                fontSize: "11px",
                              }}
                            >
                              {isDeleting ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {!sitesLoading && filteredSites.length === 0 && (
                      <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                        No sites match.
                      </div>
                    )}
                  </div>
                  {deleteError && (
                    <p
                      style={{
                        color: "var(--warning)",
                        fontSize: "12px",
                        marginTop: "8px",
                      }}
                    >
                      {deleteError}
                    </p>
                  )}
                </div>

                <div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--muted)",
                      marginBottom: "8px",
                    }}
                  >
                    Recent scans
                  </div>
                  <div
                    className="scroll-y"
                    style={{
                      maxHeight: "220px",
                      borderRadius: "12px",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: "12px",
                      }}
                    >
                      <thead
                        style={{
                          position: "sticky",
                          top: 0,
                          background: "var(--panel)",
                          zIndex: 1,
                        }}
                      >
                        <tr>
                          <th
                            style={{
                              textAlign: "left",
                              padding: "6px 8px",
                              borderBottom: "1px solid var(--border)",
                              color: "var(--muted)",
                              fontWeight: 500,
                            }}
                          >
                            Started
                          </th>
                          <th
                            style={{
                              textAlign: "right",
                              padding: "6px 8px",
                              borderBottom: "1px solid var(--border)",
                              color: "var(--muted)",
                              fontWeight: 500,
                            }}
                          >
                            Broken
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((run) => {
                          const isSelected = run.id === pinnedRunId;
                          const brokenPct = percentBroken(
                            run.checked_links || run.total_links,
                            run.broken_links,
                          );
                          return (
                            <tr
                              key={run.id}
                              onClick={() => {
                                setResults([]);
                                resetOccurrencesState();
                                setSelectedRunId(run.id);
                                selectedRunIdRef.current = run.id;

                                if (isInProgress(run.status)) {
                                  setActiveRunId(run.id);
                                  activeRunIdRef.current = run.id;
                                  startSse(run.id);
                                  void refreshSelectedRun(run.id);
                                } else {
                                  setActiveRunId(null);
                                  activeRunIdRef.current = null;
                                  stopSse();
                                  void loadResults(run.id);
                                }
                              }}
                              style={{
                                cursor: "pointer",
                                background: isSelected
                                  ? "var(--panel-elev)"
                                  : "transparent",
                              }}
                            >
                              <td
                                style={{
                                  padding: "6px 8px",
                                  borderBottom: "1px solid var(--border)",
                                }}
                              >
                                {formatDate(run.started_at)}
                              </td>
                              <td
                                style={{
                                  padding: "6px 8px",
                                  borderBottom: "1px solid var(--border)",
                                  textAlign: "right",
                                }}
                              >
                                {run.broken_links} ({brokenPct})
                              </td>
                            </tr>
                          );
                        })}
                        {history.length === 0 && !historyLoading && (
                          <tr>
                            <td
                              colSpan={2}
                              style={{
                                padding: "10px",
                                textAlign: "center",
                                color: "var(--muted)",
                              }}
                            >
                              No scans yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </aside>

              <div
                className="resizer"
                onMouseDown={() => setIsResizing(true)}
                title="Drag to resize"
              />

              <main className="main">
                <div
                  className="card"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "16px",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "22px", fontWeight: 700 }}>
                      {startUrl ? safeHost(startUrl) : "No site selected"}
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--muted)",
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        title={startUrl}
                        style={{
                          maxWidth: "520px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {startUrl || "Select a site to begin"}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => startUrl && copyToClipboard(startUrl)}
                      disabled={!startUrl}
                      style={{
                        padding: "6px 10px",
                        borderRadius: "999px",
                        border: "1px solid var(--border)",
                        background: "var(--panel)",
                        fontSize: "12px",
                        cursor: startUrl ? "pointer" : "not-allowed",
                      }}
                    >
                      Copy URL
                    </button>
                    <button
                      onClick={() => setIgnoreRulesOpen(true)}
                      disabled={!selectedSiteId}
                      style={{
                        padding: "6px 10px",
                        borderRadius: "999px",
                        border: "1px solid var(--border)",
                        background: "var(--panel)",
                        fontSize: "12px",
                        cursor: selectedSiteId ? "pointer" : "not-allowed",
                        opacity: selectedSiteId ? 1 : 0.6,
                      }}
                    >
                      Ignore rules
                    </button>
                    <button
                      onClick={handleRunScan}
                      disabled={!selectedSiteId || triggeringScan}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "999px",
                        border: "none",
                        background: triggeringScan
                          ? "var(--panel-elev)"
                          : "var(--success)",
                        color: "white",
                        fontWeight: 600,
                        cursor:
                          triggeringScan || !selectedSiteId
                            ? "not-allowed"
                            : "pointer",
                      }}
                    >
                      {triggeringScan ? "Running..." : "New scan"}
                    </button>
                    <a
                      href={startUrl || "#"}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        padding: "6px 10px",
                        borderRadius: "999px",
                        border: "1px solid var(--border)",
                        background: "var(--panel)",
                        fontSize: "12px",
                        color: "var(--text)",
                        textDecoration: "none",
                        pointerEvents: startUrl ? "auto" : "none",
                        opacity: startUrl ? 1 : 0.6,
                      }}
                    >
                      Open site
                    </a>
                  </div>
                </div>

                <div ref={scansRef} className="card" style={{ padding: "0" }}>
                  {showProgress && selectedRun && (
                    <div
                      style={{
                        padding: "16px 16px 0 16px",
                        display: "flex",
                        gap: "12px",
                        alignItems: "flex-start",
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: "240px" }}>
                        <ScanProgressBar
                          status={
                            progressPhase === "completed"
                              ? "completed"
                              : selectedRun.status
                          }
                          totalLinks={selectedRun.total_links}
                          checkedLinks={selectedRun.checked_links}
                          brokenLinks={selectedRun.broken_links}
                          blockedLinks={blockedResults.length}
                          noResponseLinks={
                            visibleResults.filter(
                              (row) => row.classification === "no_response",
                            ).length
                          }
                          lastUpdateAt={lastProgressAt ?? null}
                        />
                      </div>
                      {selectedRun.status === "in_progress" && (
                        <button
                          onClick={handleCancelScan}
                          style={{
                            padding: "10px 14px",
                            borderRadius: "10px",
                            border: "1px solid var(--danger)",
                            background: "var(--danger)",
                            color: "white",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Cancel scan
                        </button>
                      )}
                    </div>
                  )}
                  {!showProgress && (
                    <div style={{ padding: "16px 16px 0 16px" }}>
                      <div className="card" style={{ padding: "12px 14px" }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: "12px",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600 }}>Diff</div>
                            <div
                              style={{
                                fontSize: "12px",
                                color: "var(--muted)",
                              }}
                            >
                              {compareRun
                                ? `Comparing to ${formatRelative(compareRun.started_at)}`
                                : compareRunId
                                  ? "Comparing to selected run"
                                  : "Run another scan to enable comparisons"}
                            </div>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              gap: "10px",
                              flexWrap: "wrap",
                              alignItems: "center",
                            }}
                          >
                            {diffSummary && (
                              <div
                                style={{
                                  display: "flex",
                                  gap: "10px",
                                  fontSize: "12px",
                                  color: "var(--muted)",
                                  flexWrap: "wrap",
                                }}
                              >
                                <span>
                                  New issues {diffSummary.addedIssues}
                                </span>
                                <span>Fixed {diffSummary.removedIssues}</span>
                                <span>Changed {diffSummary.changed}</span>
                                <span>Unchanged {diffSummary.unchanged}</span>
                              </div>
                            )}
                            {hasDiffChanges && (
                              <button
                                onClick={() => setDiffOpen((prev) => !prev)}
                                style={{
                                  padding: "4px 8px",
                                  borderRadius: "8px",
                                  border: "1px solid var(--border)",
                                  background: "var(--panel)",
                                  fontSize: "11px",
                                  cursor: "pointer",
                                }}
                              >
                                {diffOpen ? "Hide details" : "Show details"}
                              </button>
                            )}
                          </div>
                        </div>
                        {diffLoading && (
                          <div
                            style={{
                              fontSize: "12px",
                              color: "var(--muted)",
                              marginTop: "8px",
                            }}
                          >
                            Loading diff…
                          </div>
                        )}
                        {diffError && (
                          <div
                            style={{
                              fontSize: "12px",
                              color: "var(--warning)",
                              marginTop: "8px",
                            }}
                          >
                            {diffError}
                          </div>
                        )}
                        {issueDiff && !hasDiffChanges && (
                          <div
                            style={{
                              fontSize: "12px",
                              color: "var(--muted)",
                              marginTop: "8px",
                            }}
                          >
                            No issue changes since last run.
                          </div>
                        )}
                        {issueDiff && hasDiffChanges && diffOpen && (
                          <div style={{ marginTop: "10px" }}>
                            <div
                              style={{
                                display: "flex",
                                gap: "8px",
                                flexWrap: "wrap",
                                marginBottom: "10px",
                              }}
                            >
                              {(["added", "removed", "changed"] as const).map(
                                (tab) => (
                                  <button
                                    key={tab}
                                    className={`tab-pill ${diffTab === tab ? "active" : ""}`}
                                    onClick={() => setDiffTab(tab)}
                                  >
                                    {tab === "added"
                                      ? `Added (${issueDiff.added.length})`
                                      : tab === "removed"
                                        ? `Fixed (${issueDiff.removed.length})`
                                        : `Changed (${issueDiff.changed.length})`}
                                  </button>
                                ),
                              )}
                            </div>
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "8px",
                              }}
                            >
                              {diffItems.length === 0 && (
                                <div
                                  style={{
                                    fontSize: "12px",
                                    color: "var(--muted)",
                                  }}
                                >
                                  Nothing in this category.
                                </div>
                              )}
                              {diffItems.map((item) => {
                                const runIdForOcc =
                                  diffTab === "removed"
                                    ? (compareRunId ?? selectedRunId)
                                    : selectedRunId;
                                const row = item.row;
                                const key = `${runIdForOcc}:${row.link_url}`;
                                const isOpen = !!diffOccurrences[key];
                                return (
                                  <div
                                    key={item.key}
                                    style={{
                                      border: "1px solid var(--border)",
                                      borderRadius: "10px",
                                      padding: "8px",
                                      background: "var(--panel-elev)",
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "8px",
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <span
                                        style={{
                                          fontSize: "11px",
                                          padding: "2px 6px",
                                          borderRadius: "999px",
                                          background: "var(--chip-bg)",
                                          color: "var(--chip-text)",
                                        }}
                                      >
                                        {formatClassification(
                                          row.classification,
                                        )}
                                      </span>
                                      <span
                                        style={{
                                          fontSize: "11px",
                                          color: "var(--muted)",
                                        }}
                                      >
                                        {row.status_code ?? "No response"}
                                      </span>
                                      <span
                                        style={{
                                          fontSize: "11px",
                                          color: "var(--muted)",
                                        }}
                                      >
                                        {row.occurrence_count}x
                                      </span>
                                      {item.before && item.after && (
                                        <span
                                          style={{
                                            fontSize: "11px",
                                            color: "var(--muted)",
                                          }}
                                        >
                                          {formatClassification(
                                            item.before.classification,
                                          )}{" "}
                                          {item.before.status_code ??
                                            "No response"}{" "}
                                          →{" "}
                                          {formatClassification(
                                            item.after.classification,
                                          )}{" "}
                                          {item.after.status_code ??
                                            "No response"}
                                        </span>
                                      )}
                                    </div>
                                    <div
                                      style={{
                                        marginTop: "6px",
                                        fontSize: "12px",
                                        color: "var(--text)",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                      }}
                                      title={row.link_url}
                                    >
                                      {row.link_url}
                                    </div>
                                    <div style={{ marginTop: "6px" }}>
                                      <button
                                        onClick={() =>
                                          runIdForOcc &&
                                          toggleDiffOccurrences(
                                            runIdForOcc,
                                            row.link_url,
                                          )
                                        }
                                        style={{
                                          padding: "4px 8px",
                                          borderRadius: "8px",
                                          border: "1px solid var(--border)",
                                          background: "var(--panel)",
                                          fontSize: "11px",
                                          cursor: "pointer",
                                        }}
                                      >
                                        {isOpen
                                          ? "Hide occurrences"
                                          : "View occurrences"}
                                      </button>
                                    </div>
                                    {isOpen && (
                                      <div
                                        style={{
                                          marginTop: "8px",
                                          display: "flex",
                                          flexDirection: "column",
                                          gap: "6px",
                                        }}
                                      >
                                        {diffOccLoading[key] && (
                                          <div
                                            style={{
                                              fontSize: "12px",
                                              color: "var(--muted)",
                                            }}
                                          >
                                            Loading…
                                          </div>
                                        )}
                                        {diffOccError[key] && (
                                          <div
                                            style={{
                                              fontSize: "12px",
                                              color: "var(--warning)",
                                            }}
                                          >
                                            {diffOccError[key]}
                                          </div>
                                        )}
                                        {(diffOccurrences[key] ?? []).map(
                                          (occ) => (
                                            <div
                                              key={occ.id}
                                              style={{
                                                fontSize: "12px",
                                                color: "var(--muted)",
                                                overflowWrap: "anywhere",
                                              }}
                                            >
                                              {occ.source_page}
                                            </div>
                                          ),
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "12px",
                      flexWrap: "wrap",
                      marginBottom: "12px",
                    }}
                  >
                    <div
                      style={{
                        position: "sticky",
                        top: 70,
                        zIndex: 10,
                        background: "var(--panel)",
                        padding: "14px 16px",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "12px",
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        {!isSelectedRunInProgress && (
                          <div
                            style={{ fontSize: "12px", color: "var(--muted)" }}
                          >
                            Checked {selectedRun?.checked_links ?? 0} /{" "}
                            {selectedRun?.total_links ?? 0} • Broken{" "}
                            {selectedRun?.broken_links ?? 0} • Blocked{" "}
                            {blockedResults.length} • Timed out{" "}
                            {
                              visibleResults.filter(
                                (row) => row.classification === "no_response",
                              ).length
                            }
                          </div>
                        )}
                        {hasActiveFilters && (
                          <span
                            style={{ fontSize: "12px", color: "var(--accent)" }}
                          >
                            Filters active
                          </span>
                        )}
                        <div
                          style={{
                            display: "flex",
                            gap: "8px",
                            flexWrap: "wrap",
                            alignItems: "center",
                          }}
                        >
                          {(
                            [
                              "all",
                              "broken",
                              "blocked",
                              "no_response",
                              "ok",
                              "ignored",
                            ] as const
                          ).map((tab) => (
                            <button
                              key={tab}
                              className={`tab-pill ${activeTab === tab ? "active" : ""}`}
                              onClick={() => setActiveTab(tab)}
                            >
                              {tab === "ok"
                                ? "OK"
                                : tab === "no_response"
                                  ? "Timed out"
                                  : tab === "ignored"
                                    ? "Ignored"
                                    : tab[0].toUpperCase() + tab.slice(1)}
                            </button>
                          ))}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: "8px",
                            flexWrap: "wrap",
                            alignItems: "center",
                          }}
                        >
                          <div
                            className="filter-dropdown"
                            ref={filterDropdownRef}
                          >
                            <button
                              onClick={() => setFiltersOpen((prev) => !prev)}
                              className={`tab-pill ${hasActiveFilters ? "active" : ""}`}
                            >
                              Filters {filtersOpen ? "▴" : "▾"}
                            </button>
                            {filtersOpen && (
                              <div className="filter-dropdown__panel">
                                <div className="filter-row">
                                  {(["all", "http_error"] as const).map(
                                    (group) => (
                                      <button
                                        key={group}
                                        onClick={() => setStatusGroup(group)}
                                        className={`tab-pill ${statusGroup === group ? "active" : ""}`}
                                      >
                                        {group === "all"
                                          ? "All responses"
                                          : "HTTP response"}
                                      </button>
                                    ),
                                  )}
                                </div>
                                <div className="filter-row">
                                  {["401/403/429", "404", "5xx"].map((key) => (
                                    <button
                                      key={key}
                                      onClick={() => toggleStatusFilter(key)}
                                      className={`tab-pill ${statusFilters[key] ? "active" : ""}`}
                                    >
                                      {key}
                                    </button>
                                  ))}
                                  <button
                                    onClick={() =>
                                      setMinOccurrencesOnly((prev) => !prev)
                                    }
                                    className={`tab-pill ${minOccurrencesOnly ? "active" : ""}`}
                                  >
                                    Occurrences &gt; 1
                                  </button>
                                  <button
                                    onClick={() =>
                                      setShowIgnored((prev) => !prev)
                                    }
                                    className={`tab-pill ${showIgnored ? "active" : ""}`}
                                  >
                                    {showIgnored
                                      ? "Showing ignored"
                                      : "Show ignored"}
                                  </button>
                                </div>
                                <div className="filter-row">
                                  <button
                                    onClick={() => {
                                      setStatusFilters({});
                                      setMinOccurrencesOnly(false);
                                      setSearchQuery("");
                                      setActiveTab("all");
                                      setStatusGroup("all");
                                      setShowIgnored(false);
                                    }}
                                    className="tab-pill"
                                  >
                                    Reset filters
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                          <input
                            ref={searchInputRef}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search links"
                            style={{
                              padding: "6px 8px",
                              borderRadius: "10px",
                              border: "1px solid var(--border)",
                              background: "var(--panel)",
                              color: "var(--text)",
                              width: "180px",
                            }}
                          />
                          <select
                            value={sortOption}
                            onChange={(e) =>
                              setSortOption(e.target.value as typeof sortOption)
                            }
                            style={{
                              padding: "6px 8px",
                              borderRadius: "10px",
                              border: "1px solid var(--border)",
                              background: "var(--panel)",
                              color: "var(--text)",
                            }}
                          >
                            <option value="severity">Severity</option>
                            <option value="occ_desc">Occurrences</option>
                            <option value="status_asc">Status code ↑</option>
                            <option value="status_desc">Status code ↓</option>
                            <option value="recent">Recently seen</option>
                          </select>
                          {isSelectedRunInProgress && (
                            <span
                              style={{
                                fontSize: "12px",
                                color: "var(--muted)",
                              }}
                            >
                              Updating…
                            </span>
                          )}
                          <button
                            onClick={() => setHistoryOpen(true)}
                            style={{
                              padding: "6px 10px",
                              borderRadius: "999px",
                              border: "1px solid var(--border)",
                              background: "var(--panel)",
                              color: "var(--text)",
                              cursor: "pointer",
                              fontSize: "12px",
                              fontWeight: 600,
                            }}
                          >
                            History
                          </button>
                          <div
                            ref={exportMenuRef}
                            style={{ position: "relative" }}
                          >
                            <button
                              onClick={() => setExportMenuOpen((prev) => !prev)}
                              disabled={exportDisabled}
                              style={{
                                padding: "6px 10px",
                                borderRadius: "999px",
                                border: "1px solid var(--border)",
                                background: "var(--panel)",
                                color: "var(--text)",
                                cursor: exportDisabled
                                  ? "not-allowed"
                                  : "pointer",
                                fontSize: "12px",
                                fontWeight: 600,
                              }}
                            >
                              Export
                            </button>
                            {exportMenuOpen && !exportDisabled && (
                              <div
                                className="export-menu"
                                style={{
                                  position: "absolute",
                                  right: 0,
                                  top: "calc(100% + 6px)",
                                  background: "var(--panel)",
                                  border: "1px solid var(--border)",
                                  borderRadius: "12px",
                                  boxShadow: "var(--shadow)",
                                  padding: "6px",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "4px",
                                  minWidth: "180px",
                                  zIndex: 30,
                                }}
                              >
                                <button
                                  onClick={() => triggerExport("csv")}
                                  disabled={exportLinksDisabled}
                                  style={{
                                    padding: "8px 10px",
                                    borderRadius: "10px",
                                    border: "1px solid transparent",
                                    background: "transparent",
                                    textAlign: "left",
                                    cursor: exportLinksDisabled
                                      ? "not-allowed"
                                      : "pointer",
                                    color: "var(--text)",
                                  }}
                                >
                                  Export CSV (current filter)
                                </button>
                                <button
                                  onClick={() => triggerExport("json")}
                                  disabled={exportLinksDisabled}
                                  style={{
                                    padding: "8px 10px",
                                    borderRadius: "10px",
                                    border: "1px solid transparent",
                                    background: "transparent",
                                    textAlign: "left",
                                    cursor: exportLinksDisabled
                                      ? "not-allowed"
                                      : "pointer",
                                    color: "var(--text)",
                                  }}
                                >
                                  Export JSON (current filter)
                                </button>
                                <button
                                  onClick={() => {
                                    if (!selectedRunId) return;
                                    openReport(selectedRunId);
                                    setExportMenuOpen(false);
                                  }}
                                  style={{
                                    padding: "8px 10px",
                                    borderRadius: "10px",
                                    border: "1px solid transparent",
                                    background: "transparent",
                                    textAlign: "left",
                                    cursor: "pointer",
                                    color: "var(--text)",
                                  }}
                                >
                                  Open Report
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    className={`results-layout ${historyOpen && !isNarrow ? "drawer-open" : ""}`}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        className="scroll-y"
                        style={{
                          maxHeight: "560px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "10px",
                          padding: "16px",
                        }}
                      >
                        {activeTab !== "ignored" && (
                          <>
                            {(activeTab === "broken" ||
                              activeTab === "blocked") && (
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  gap: "8px",
                                }}
                              >
                                <div
                                  style={{ fontSize: "12px", fontWeight: 600 }}
                                >
                                  {activeTab === "broken"
                                    ? "Broken links"
                                    : "Blocked links"}
                                </div>
                                <button
                                  onClick={() =>
                                    triggerExport("csv", activeTab)
                                  }
                                  disabled={!selectedRunId}
                                  style={{
                                    padding: "4px 8px",
                                    borderRadius: "999px",
                                    border: "1px solid var(--border)",
                                    background: "var(--panel)",
                                    fontSize: "11px",
                                    cursor: !selectedRunId
                                      ? "not-allowed"
                                      : "pointer",
                                  }}
                                >
                                  Export CSV
                                </button>
                              </div>
                            )}
                            {resultsError && (
                              <div
                                style={{
                                  padding: "10px 12px",
                                  borderRadius: "10px",
                                  border: "1px solid var(--border)",
                                  color: "var(--warning)",
                                }}
                              >
                                {resultsError}
                              </div>
                            )}
                            {resultsLoading &&
                              Array.from({ length: 6 }).map((_, idx) => (
                                <div key={idx} className="skeleton" />
                              ))}
                            {!resultsLoading &&
                              filteredResults.length === 0 &&
                              results.length > 0 && (
                                <div
                                  style={{
                                    padding: "20px",
                                    borderRadius: "12px",
                                    border: "1px dashed var(--border)",
                                    textAlign: "center",
                                    color: "var(--muted)",
                                  }}
                                >
                                  <div style={{ marginBottom: "8px" }}>
                                    No results match these filters.
                                  </div>
                                  <button
                                    onClick={() => {
                                      setStatusFilters({});
                                      setMinOccurrencesOnly(false);
                                      setSearchQuery("");
                                      setActiveTab("all");
                                      setStatusGroup("all");
                                      setShowIgnored(false);
                                    }}
                                    style={{
                                      padding: "6px 10px",
                                      borderRadius: "999px",
                                      border: "1px solid var(--border)",
                                      background: "var(--panel)",
                                      fontSize: "12px",
                                      cursor: "pointer",
                                    }}
                                  >
                                    Clear filters
                                  </button>
                                </div>
                              )}
                            {!resultsLoading &&
                              filteredResults.length === 0 &&
                              results.length === 0 && (
                                <div
                                  style={{
                                    padding: "20px",
                                    borderRadius: "12px",
                                    border: "1px dashed var(--border)",
                                    textAlign: "center",
                                    color: "var(--muted)",
                                  }}
                                >
                                  No results yet. Run a scan to populate this
                                  list.
                                </div>
                              )}
                            {renderLinkRows(filteredResults, (row) => {
                              if (row.classification === "blocked")
                                return blockedTheme;
                              if (row.classification === "ok") return okTheme;
                              if (row.classification === "no_response")
                                return noResponseTheme;
                              return brokenTheme;
                            })}
                          </>
                        )}

                        {activeTab === "ignored" && (
                          <>
                            {ignoredError && (
                              <div
                                style={{
                                  padding: "10px 12px",
                                  borderRadius: "10px",
                                  border: "1px solid var(--border)",
                                  color: "var(--warning)",
                                }}
                              >
                                {ignoredError}
                              </div>
                            )}
                            {ignoredLoading &&
                              Array.from({ length: 6 }).map((_, idx) => (
                                <div key={idx} className="skeleton" />
                              ))}
                            {!ignoredLoading && ignoredResults.length === 0 && (
                              <div
                                style={{
                                  padding: "20px",
                                  borderRadius: "12px",
                                  border: "1px dashed var(--border)",
                                  textAlign: "center",
                                  color: "var(--muted)",
                                }}
                              >
                                No ignored links yet.
                              </div>
                            )}
                            {ignoredResults.map((row) => {
                              const isOpen = !!ignoredOccurrences[row.id];
                              return (
                                <div
                                  key={row.id}
                                  className="result-row"
                                  style={{
                                    borderRadius: "10px",
                                    border: "1px solid var(--border)",
                                    background: "var(--panel-elev)",
                                    display: "flex",
                                    flexDirection: "column",
                                  }}
                                >
                                  <div
                                    style={{
                                      padding: "8px 10px",
                                      display: "flex",
                                      gap: "8px",
                                      alignItems: "flex-start",
                                    }}
                                  >
                                    <button
                                      onClick={() =>
                                        selectedRunId &&
                                        toggleIgnoredOccurrences(
                                          row.id,
                                          selectedRunId,
                                        )
                                      }
                                      style={{
                                        background: "transparent",
                                        border: "none",
                                        cursor: "pointer",
                                        fontSize: "16px",
                                      }}
                                    >
                                      {isOpen ? "▼" : "▶"}
                                    </button>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div
                                        style={{
                                          display: "flex",
                                          gap: "8px",
                                          alignItems: "center",
                                          flexWrap: "wrap",
                                          marginBottom: "6px",
                                        }}
                                      >
                                        <span
                                          style={{
                                            fontSize: "11px",
                                            padding: "2px 6px",
                                            borderRadius: "999px",
                                            background: "var(--chip-bg)",
                                            color: "var(--chip-text)",
                                          }}
                                        >
                                          Ignored
                                        </span>
                                        {row.rule_type && row.rule_pattern && (
                                          <span
                                            style={{
                                              fontSize: "11px",
                                              padding: "2px 6px",
                                              borderRadius: "999px",
                                              background: "var(--panel)",
                                              color: "var(--muted)",
                                              border: "1px solid var(--border)",
                                            }}
                                          >
                                            {row.rule_type}: {row.rule_pattern}
                                          </span>
                                        )}
                                        <span
                                          style={{
                                            fontSize: "11px",
                                            color: "var(--muted)",
                                          }}
                                        >
                                          {row.status_code ??
                                            "No HTTP response"}
                                        </span>
                                        <span
                                          style={{
                                            fontSize: "11px",
                                            color: "var(--muted)",
                                          }}
                                        >
                                          {row.occurrence_count}x
                                        </span>
                                      </div>
                                      <div
                                        style={{
                                          fontSize: "12px",
                                          color: "var(--text)",
                                          overflowWrap: "anywhere",
                                          wordBreak: "break-word",
                                          whiteSpace: "normal",
                                        }}
                                        title={row.link_url}
                                      >
                                        {row.link_url}
                                      </div>
                                    </div>
                                  </div>
                                  {isOpen && (
                                    <div
                                      className="expand-panel"
                                      style={{
                                        padding: "10px 12px",
                                        borderTop: "1px solid var(--border)",
                                        background: "var(--panel)",
                                      }}
                                    >
                                      {ignoredOccLoading[row.id] && (
                                        <div
                                          style={{
                                            fontSize: "12px",
                                            color: "var(--muted)",
                                          }}
                                        >
                                          Loading…
                                        </div>
                                      )}
                                      {ignoredOccError[row.id] && (
                                        <div
                                          style={{
                                            fontSize: "12px",
                                            color: "var(--warning)",
                                          }}
                                        >
                                          {ignoredOccError[row.id]}
                                        </div>
                                      )}
                                      {(ignoredOccurrences[row.id] ?? []).map(
                                        (occ) => (
                                          <div
                                            key={occ.id}
                                            style={{
                                              fontSize: "12px",
                                              color: "var(--muted)",
                                              overflowWrap: "anywhere",
                                            }}
                                          >
                                            {occ.source_page}
                                          </div>
                                        ),
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </>
                        )}
                      </div>

                      {!isSelectedRunInProgress && (
                        <div
                          style={{
                            marginTop: "12px",
                            display: "flex",
                            gap: "12px",
                            flexWrap: "wrap",
                            justifyContent: "center",
                          }}
                        >
                          {activeTab === "all" &&
                            (brokenHasMore ||
                              blockedHasMore ||
                              okHasMore ||
                              noResponseHasMore) && (
                              <button
                                onClick={() =>
                                  selectedRunId &&
                                  loadMoreAllResults(selectedRunId)
                                }
                                disabled={resultsLoading}
                                style={{
                                  padding: "10px 18px",
                                  borderRadius: "999px",
                                  border: "1px solid var(--success)",
                                  background: "var(--success)",
                                  color: "white",
                                  cursor: resultsLoading
                                    ? "default"
                                    : "pointer",
                                  opacity: resultsLoading ? 0.6 : 1,
                                  fontSize: "12px",
                                  fontWeight: 600,
                                }}
                              >
                                {resultsLoading
                                  ? "Loading..."
                                  : "Load More Results"}
                              </button>
                            )}
                          {activeTab === "broken" && brokenHasMore && (
                            <button
                              onClick={() =>
                                selectedRunId &&
                                loadMoreBrokenResults(selectedRunId)
                              }
                              disabled={resultsLoading}
                              style={{
                                padding: "10px 18px",
                                borderRadius: "999px",
                                border: "1px solid var(--danger)",
                                background: "var(--danger)",
                                color: "white",
                                cursor: resultsLoading ? "default" : "pointer",
                                opacity: resultsLoading ? 0.6 : 1,
                                fontSize: "12px",
                                fontWeight: 600,
                              }}
                            >
                              {resultsLoading
                                ? "Loading..."
                                : "Load More Results"}
                            </button>
                          )}
                          {activeTab === "blocked" && blockedHasMore && (
                            <button
                              onClick={() =>
                                selectedRunId &&
                                loadMoreBlockedResults(selectedRunId)
                              }
                              disabled={resultsLoading}
                              style={{
                                padding: "10px 18px",
                                borderRadius: "999px",
                                border: "1px solid var(--warning)",
                                background: "var(--warning)",
                                color: "white",
                                cursor: resultsLoading ? "default" : "pointer",
                                opacity: resultsLoading ? 0.6 : 1,
                                fontSize: "12px",
                                fontWeight: 600,
                              }}
                            >
                              {resultsLoading
                                ? "Loading..."
                                : "Load More Results"}
                            </button>
                          )}
                          {activeTab === "ok" && okHasMore && (
                            <button
                              onClick={() =>
                                selectedRunId &&
                                loadMoreOkResults(selectedRunId)
                              }
                              disabled={resultsLoading}
                              style={{
                                padding: "10px 18px",
                                borderRadius: "999px",
                                border: "1px solid var(--success)",
                                background: "var(--success)",
                                color: "white",
                                cursor: resultsLoading ? "default" : "pointer",
                                opacity: resultsLoading ? 0.6 : 1,
                                fontSize: "12px",
                                fontWeight: 600,
                              }}
                            >
                              {resultsLoading
                                ? "Loading..."
                                : "Load More Results"}
                            </button>
                          )}
                          {activeTab === "no_response" && noResponseHasMore && (
                            <button
                              onClick={() =>
                                selectedRunId &&
                                loadMoreNoResponseResults(selectedRunId)
                              }
                              disabled={resultsLoading}
                              style={{
                                padding: "10px 18px",
                                borderRadius: "999px",
                                border: "1px solid var(--border)",
                                background: "var(--border)",
                                color: "var(--text)",
                                cursor: resultsLoading ? "default" : "pointer",
                                opacity: resultsLoading ? 0.6 : 1,
                                fontSize: "12px",
                                fontWeight: 600,
                              }}
                            >
                              {resultsLoading
                                ? "Loading..."
                                : "Load More Results"}
                            </button>
                          )}
                          {activeTab === "ignored" && ignoredHasMore && (
                            <button
                              onClick={() =>
                                selectedRunId &&
                                loadMoreIgnoredResults(selectedRunId)
                              }
                              disabled={ignoredLoading}
                              style={{
                                padding: "10px 18px",
                                borderRadius: "999px",
                                border: "1px solid var(--border)",
                                background: "var(--panel)",
                                color: "var(--text)",
                                cursor: ignoredLoading ? "default" : "pointer",
                                opacity: ignoredLoading ? 0.6 : 1,
                                fontSize: "12px",
                                fontWeight: 600,
                              }}
                            >
                              {ignoredLoading
                                ? "Loading..."
                                : "Load More Results"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {!isNarrow && historyOpen && (
                      <div
                        className="card"
                        style={{
                          padding: "16px",
                          minWidth: "280px",
                          maxHeight: "620px",
                          overflow: "auto",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: "12px",
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>History</div>
                          <button
                            onClick={() => setHistoryOpen(false)}
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--panel)",
                              borderRadius: "8px",
                              padding: "4px 6px",
                              cursor: "pointer",
                              fontSize: "12px",
                            }}
                          >
                            ✕
                          </button>
                        </div>
                        {historyLoading && (
                          <div
                            style={{ fontSize: "12px", color: "var(--muted)" }}
                          >
                            Loading…
                          </div>
                        )}
                        {historyError && (
                          <div
                            style={{
                              fontSize: "12px",
                              color: "var(--warning)",
                            }}
                          >
                            {historyError}
                          </div>
                        )}
                        {!historyLoading && history.length === 0 && (
                          <div
                            style={{ fontSize: "12px", color: "var(--muted)" }}
                          >
                            No scans yet.
                          </div>
                        )}
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                          }}
                        >
                          {history.map((run) => (
                            <div
                              key={run.id}
                              style={{
                                border: "1px solid var(--border)",
                                borderRadius: "10px",
                                padding: "8px",
                                background: "var(--panel-elev)",
                                display: "flex",
                                flexDirection: "column",
                                gap: "6px",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  gap: "8px",
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: "11px",
                                    color: "var(--muted)",
                                  }}
                                >
                                  {formatRelative(run.started_at)}
                                </span>
                                <span
                                  style={{
                                    fontSize: "11px",
                                    color: "var(--text)",
                                  }}
                                >
                                  {run.status}
                                </span>
                              </div>
                              <div
                                style={{
                                  fontSize: "11px",
                                  color: "var(--muted)",
                                }}
                              >
                                Broken {run.broken_links} • Checked{" "}
                                {run.checked_links}/{run.total_links}
                              </div>
                              <div style={{ display: "flex", gap: "8px" }}>
                                <button
                                  onClick={() => setSelectedRunId(run.id)}
                                  style={{
                                    padding: "4px 6px",
                                    borderRadius: "6px",
                                    border: "1px solid var(--border)",
                                    background: "var(--panel)",
                                    fontSize: "11px",
                                    cursor: "pointer",
                                  }}
                                >
                                  View
                                </button>
                                {selectedRunId && run.id !== selectedRunId && (
                                  <button
                                    onClick={() => setCompareRunId(run.id)}
                                    style={{
                                      padding: "4px 6px",
                                      borderRadius: "6px",
                                      border: "1px solid var(--border)",
                                      background: "var(--panel)",
                                      fontSize: "11px",
                                      cursor: "pointer",
                                    }}
                                  >
                                    Compare
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </main>
            </div>

            {isDrawerOpen && (
              <div
                className="drawer-backdrop"
                onClick={() => setIsDrawerOpen(false)}
              />
            )}

            {ignoreRulesOpen && (
              <div
                className="modal-backdrop"
                onClick={() => setIgnoreRulesOpen(false)}
              >
                <div
                  className="modal"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>Ignore rules</div>
                      <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                        Rules apply to the selected site.
                      </div>
                    </div>
                    <button
                      onClick={() => setIgnoreRulesOpen(false)}
                      style={{
                        border: "1px solid var(--border)",
                        background: "var(--panel)",
                        borderRadius: "10px",
                        padding: "4px 6px",
                        cursor: "pointer",
                        fontSize: "12px",
                      }}
                    >
                      ✕
                    </button>
                  </div>

                  <div
                    style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}
                  >
                    <select
                      value={newRuleScope}
                      onChange={(e) =>
                        setNewRuleScope(e.target.value as "site" | "global")
                      }
                      style={{
                        padding: "6px 8px",
                        borderRadius: "10px",
                        border: "1px solid var(--border)",
                        background: "var(--panel)",
                        color: "var(--text)",
                        fontSize: "12px",
                      }}
                    >
                      <option value="site">This site</option>
                      <option value="global">Global</option>
                    </select>
                    <select
                      value={newRuleType}
                      onChange={(e) =>
                        setNewRuleType(
                          e.target.value as IgnoreRule["rule_type"],
                        )
                      }
                      style={{
                        padding: "6px 8px",
                        borderRadius: "10px",
                        border: "1px solid var(--border)",
                        background: "var(--panel)",
                        color: "var(--text)",
                        fontSize: "12px",
                      }}
                    >
                      <option value="domain">domain</option>
                      <option value="path_prefix">path_prefix</option>
                      <option value="regex">regex</option>
                      <option value="status_code">status_code</option>
                    </select>
                    <input
                      value={newRulePattern}
                      onChange={(e) => setNewRulePattern(e.target.value)}
                      placeholder="Pattern (e.g. walkers.co.uk, /login, 404)"
                      style={{
                        flex: 1,
                        minWidth: "220px",
                        padding: "6px 8px",
                        borderRadius: "10px",
                        border: "1px solid var(--border)",
                        background: "var(--panel)",
                        color: "var(--text)",
                        fontSize: "12px",
                      }}
                    />
                    <button
                      onClick={handleCreateIgnoreRule}
                      disabled={!selectedSiteId || !newRulePattern.trim()}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "10px",
                        border: "1px solid var(--border)",
                        background: "var(--accent)",
                        color: "white",
                        fontSize: "12px",
                        cursor:
                          !selectedSiteId || !newRulePattern.trim()
                            ? "not-allowed"
                            : "pointer",
                        opacity:
                          !selectedSiteId || !newRulePattern.trim() ? 0.6 : 1,
                      }}
                    >
                      Add rule
                    </button>
                  </div>

                  {ignoreRulesError && (
                    <div style={{ fontSize: "12px", color: "var(--warning)" }}>
                      {ignoreRulesError}
                    </div>
                  )}
                  {ignoreRulesLoading && (
                    <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                      Loading rules…
                    </div>
                  )}
                  {!ignoreRulesLoading && ignoreRules.length === 0 && (
                    <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                      No ignore rules yet.
                    </div>
                  )}
                  {!ignoreRulesLoading && ignoreRules.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                      }}
                    >
                      {ignoreRules.map((rule) => (
                        <div
                          key={rule.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            padding: "8px 10px",
                            borderRadius: "10px",
                            border: "1px solid var(--border)",
                            background: "var(--panel-elev)",
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "12px", fontWeight: 600 }}>
                              {rule.rule_type} {rule.site_id ? "" : "· global"}
                            </div>
                            <div
                              style={{
                                fontSize: "12px",
                                color: "var(--muted)",
                                overflowWrap: "anywhere",
                              }}
                            >
                              {rule.pattern}
                            </div>
                          </div>
                          <button
                            onClick={() => handleToggleIgnoreRule(rule)}
                            style={{
                              padding: "4px 8px",
                              borderRadius: "8px",
                              border: "1px solid var(--border)",
                              background: rule.is_enabled
                                ? "var(--success)"
                                : "var(--panel)",
                              color: rule.is_enabled ? "white" : "var(--text)",
                              fontSize: "11px",
                              cursor: "pointer",
                            }}
                          >
                            {rule.is_enabled ? "Enabled" : "Disabled"}
                          </button>
                          <button
                            onClick={() => handleDeleteIgnoreRule(rule)}
                            style={{
                              padding: "4px 8px",
                              borderRadius: "8px",
                              border: "1px solid var(--border)",
                              background: "var(--panel)",
                              fontSize: "11px",
                              cursor: "pointer",
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {historyOpen && isNarrow && (
              <div
                className="modal-backdrop"
                onClick={() => setHistoryOpen(false)}
              >
                <div
                  className="modal"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>History</div>
                    <button
                      onClick={() => setHistoryOpen(false)}
                      style={{
                        border: "1px solid var(--border)",
                        background: "var(--panel)",
                        borderRadius: "10px",
                        padding: "4px 6px",
                        cursor: "pointer",
                        fontSize: "12px",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  {historyLoading && (
                    <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                      Loading…
                    </div>
                  )}
                  {historyError && (
                    <div style={{ fontSize: "12px", color: "var(--warning)" }}>
                      {historyError}
                    </div>
                  )}
                  {!historyLoading && history.length === 0 && (
                    <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                      No scans yet.
                    </div>
                  )}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    {history.map((run) => (
                      <div
                        key={run.id}
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: "10px",
                          padding: "8px",
                          background: "var(--panel-elev)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "6px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <span
                            style={{ fontSize: "11px", color: "var(--muted)" }}
                          >
                            {formatRelative(run.started_at)}
                          </span>
                          <span
                            style={{ fontSize: "11px", color: "var(--text)" }}
                          >
                            {run.status}
                          </span>
                        </div>
                        <div
                          style={{ fontSize: "11px", color: "var(--muted)" }}
                        >
                          Broken {run.broken_links} • Checked{" "}
                          {run.checked_links}/{run.total_links}
                        </div>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button
                            onClick={() => setSelectedRunId(run.id)}
                            style={{
                              padding: "4px 6px",
                              borderRadius: "6px",
                              border: "1px solid var(--border)",
                              background: "var(--panel)",
                              fontSize: "11px",
                              cursor: "pointer",
                            }}
                          >
                            View
                          </button>
                          {selectedRunId && run.id !== selectedRunId && (
                            <button
                              onClick={() => setCompareRunId(run.id)}
                              style={{
                                padding: "4px 6px",
                                borderRadius: "6px",
                                border: "1px solid var(--border)",
                                background: "var(--panel)",
                                fontSize: "11px",
                                cursor: "pointer",
                              }}
                            >
                              Compare
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div className="toast-stack">
          {toasts.map((toast) => (
            <div key={toast.id} className="toast">
              {toast.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default App;
