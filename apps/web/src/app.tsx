import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ScanProgressBar } from "./components/ScanProgressBar";

type ScanStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";
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
type NotifyOnOption = "always" | "issues" | "never";

interface Site {
  id: string;
  user_id: string;
  url: string;
  created_at: string;
  schedule_enabled: boolean;
  schedule_frequency: "daily" | "weekly";
  schedule_time_utc: string;
  schedule_day_of_week: number | null;
  next_scheduled_at: string | null;
  last_scheduled_at: string | null;
  notify_enabled: boolean;
  notify_email: string | null;
  notify_on: NotifyOnOption;
  notify_include_csv: boolean;
  last_notified_scan_run_id: string | null;
}

interface AuthUser {
  id: string;
  email: string;
  name?: string;
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
  error_message?: string | null;
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

interface RecheckScanLinkResponse {
  scanLink: ScanLink;
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

type ScanEventPayload = {
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

type ScheduleEventPayload = {
  type: "schedule_updated";
  user_id: string;
  site_id: string;
  schedule_enabled: boolean;
  schedule_frequency: "daily" | "weekly";
  schedule_time_utc: string;
  schedule_day_of_week: number | null;
  next_scheduled_at: string | null;
  last_scheduled_at: string | null;
};

type SsePayload = ScanEventPayload | ScheduleEventPayload;

const API_BASE = "http://localhost:3001";
const THEME_STORAGE_KEY = "theme";
const LINKS_PAGE_SIZE = 50;
const OCCURRENCES_PAGE_SIZE = 50;
const IGNORED_OCCURRENCES_LIMIT = 20;
const PROGRESS_DISMISS_MS = 2000;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isInProgress(status: ScanStatus | string | null | undefined) {
  return status === "in_progress" || status === "queued";
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

function normalizeTimeInput(value: string | null | undefined) {
  if (!value) return "02:00";
  if (value.length >= 5) return value.slice(0, 5);
  return value;
}

function runStatusTone(status: string | null | undefined) {
  if (!status) return "neutral";
  if (status === "completed") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "queued" || status === "in_progress" || status === "running")
    return "warning";
  return "neutral";
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

function formatScheduleSummary(
  isEnabled: boolean,
  frequency: "daily" | "weekly",
  timeUtc: string,
  dayOfWeek: number | null,
  nextScheduledAt: string | null,
) {
  if (!isEnabled) return "Auto-scan: Off";
  const dayLabel =
    frequency === "weekly"
      ? (WEEKDAY_LABELS[dayOfWeek ?? 1] ?? "Mon")
      : "Daily";
  const nextLabel = formatDate(nextScheduledAt);
  return `Auto-scan: ${frequency === "weekly" ? "Weekly" : "Daily"} ${
    frequency === "weekly" ? dayLabel : ""
  } ${timeUtc} UTC (Next: ${nextLabel})`.replace("  ", " ");
}

function formatAlertsSummary(isEnabled: boolean, notifyOn: NotifyOnOption) {
  if (!isEnabled || notifyOn === "never") return "Alerts: Disabled";
  const mode = notifyOn === "issues" ? "Only when issues" : "Always";
  return `Alerts: Enabled (${mode})`;
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

function statusCodeGroup(
  row: Pick<ScanLink, "status_code" | "classification">,
) {
  if (row.status_code == null) return "no_response";
  if (row.status_code >= 500) return "5xx";
  if (row.status_code === 404 || row.status_code === 410) return "404";
  if (
    row.status_code === 401 ||
    row.status_code === 403 ||
    row.status_code === 429
  )
    return "401/403/429";
  return "other";
}

function formatClassification(value: LinkClassification) {
  if (value === "no_response") return "No response";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getWhyDetails(row: ScanLink) {
  const status = row.status_code;
  if (status === 401 || status === 403 || status === 429) {
    return {
      title: "Why this happened",
      body: [
        "Access controls or bot protection blocked the request.",
        "Try with authenticated headers or a different User-Agent.",
        "Rate limiting can clear after a cooldown window.",
      ],
    };
  }
  if (status === 404 || status === 410) {
    return {
      title: "Why this happened",
      body: [
        "The resource no longer exists or moved.",
        "Update the link to the new destination or remove it.",
        "Consider adding a redirect if this is your content.",
      ],
    };
  }
  if (status == null || row.classification === "no_response") {
    return {
      title: "Why this happened",
      body: [
        "The server did not respond in time or failed the request.",
        "DNS, TLS/cert, firewall, or network issues can cause timeouts.",
        "Retry later or from a different region to confirm.",
      ],
    };
  }
  if (status >= 500) {
    return {
      title: "Why this happened",
      body: [
        "The server returned an error response.",
        "Check server logs or retry to confirm this is transient.",
        "Consider alerting the owner if it persists.",
      ],
    };
  }
  return {
    title: "Why this happened",
    body: [
      "The response indicates this link needs attention.",
      "Review the source page for context and intended behavior.",
    ],
  };
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

  const sseRef = useRef<EventSource | null>(null);
  const sseRetryTimerRef = useRef<number | null>(null);
  const sseFallbackTimerRef = useRef<number | null>(null);
  const sseBackoffRef = useRef(1000);
  const runStatusRef = useRef<Map<string, ScanStatus>>(new Map());
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const filterDropdownRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const hamburgerRef = useRef<HTMLButtonElement | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);
  const detailsDrawerRef = useRef<HTMLDivElement | null>(null);
  const detailsCloseRef = useRef<HTMLButtonElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const progressDismissRef = useRef<number | null>(null);
  const lastRunStatusRef = useRef<{
    id: string | null;
    status: ScanStatus | null;
  }>({ id: null, status: null });

  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authWorking, setAuthWorking] = useState(false);

  const apiFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const res = await fetch(input, { ...init, credentials: "include" });
      if (res.status === 401) {
        setAuthUser(null);
      }
      return res;
    },
    [setAuthUser],
  );

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
      action?: { label: string; onClick: () => void };
    }>
  >([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLinkId, setDetailsLinkId] = useState<string | null>(null);
  const [recheckLoadingId, setRecheckLoadingId] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [addSiteOpen, setAddSiteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [ignoreRulesOpen, setIgnoreRulesOpen] = useState(false);
  const [ignoreRules, setIgnoreRules] = useState<IgnoreRule[]>([]);
  const [ignoreRulesLoading, setIgnoreRulesLoading] = useState(false);
  const [ignoreRulesError, setIgnoreRulesError] = useState<string | null>(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleFrequency, setScheduleFrequency] = useState<
    "daily" | "weekly"
  >("weekly");
  const [scheduleTimeUtc, setScheduleTimeUtc] = useState("02:00");
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState(1);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [notifyOn, setNotifyOn] = useState<NotifyOnOption>("issues");
  const [notifyIncludeCsv, setNotifyIncludeCsv] = useState(false);
  const [notifyLoading, setNotifyLoading] = useState(false);
  const [notifySaving, setNotifySaving] = useState(false);
  const [notifyTestSending, setNotifyTestSending] = useState(false);
  const [notifyError, setNotifyError] = useState<string | null>(null);
  const [newRuleType, setNewRuleType] =
    useState<IgnoreRule["rule_type"]>("domain");
  const [newRulePattern, setNewRulePattern] = useState("");
  const [newRuleScope, setNewRuleScope] = useState<"site" | "global">("site");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [compareRunId, setCompareRunId] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffData, setDiffData] = useState<DiffResponse["diff"] | null>(null);
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

  useEffect(() => {
    if (!userMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (userMenuRef.current && !userMenuRef.current.contains(target)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [userMenuOpen]);

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
        const res = await apiFetch(
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
      if (statusGroup === "no_response" && row.classification !== "no_response")
        return false;
      if (statusGroup === "http_error" && row.status_code == null) return false;
      if (query && !row.link_url.toLowerCase().includes(query)) return false;
      if (minOccurrencesOnly && row.occurrence_count <= 1) return false;
      if (
        activeStatusFilters.length > 0 &&
        !activeStatusFilters.includes(statusCodeGroup(row))
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
  const exportLinksDisabled = !selectedRunId;

  const filteredSites = useMemo(() => {
    const query = siteSearch.trim().toLowerCase();
    if (!query) return sites;
    return sites.filter((site) => site.url.toLowerCase().includes(query));
  }, [sites, siteSearch]);

  const isSelectedRunInProgress = isInProgress(selectedRun?.status);
  const isQueued = selectedRun?.status === "queued";
  const isRunning = selectedRun?.status === "in_progress";
  const canCancelRun = !!selectedRun && (isQueued || isRunning);
  const canRetryRun =
    !!selectedRun &&
    (selectedRun.status === "failed" || selectedRun.status === "cancelled");
  const canRescan = !!selectedRun && selectedRun.status === "completed";
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

    if (
      selectedRun.status === "in_progress" ||
      selectedRun.status === "queued"
    ) {
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
  const reportView = viewMode === "report";
  const reportRun = reportData?.scanRun ?? null;
  const reportSite = reportRun
    ? (sites.find((site) => site.id === reportRun.site_id)?.url ??
      reportRun.site_id)
    : null;
  const reportSummary = reportData?.summary.byClassification ?? {};
  const selectedLink = useMemo(
    () => results.find((row) => row.id === detailsLinkId) ?? null,
    [detailsLinkId, results],
  );
  const selectedSite = useMemo(
    () => sites.find((site) => site.id === selectedSiteId) ?? null,
    [sites, selectedSiteId],
  );
  const resultsTitleCount =
    activeTab === "ignored" ? ignoredResults.length : filteredResults.length;
  const latestRunId = history[0]?.id ?? null;
  const isLatestRun = !!selectedRun && selectedRun.id === latestRunId;
  const runHeadingText = selectedRun
    ? selectedRun.status === "queued" || selectedRun.status === "in_progress"
      ? "Current scan"
      : isLatestRun
        ? "Last run"
        : "Selected run"
    : "Run summary";

  function markRunProgress(runId: string) {
    setLastProgressAtByRunId((prev) => ({
      ...prev,
      [runId]: Date.now(),
    }));
  }

  function stopEventStream() {
    if (sseRetryTimerRef.current) {
      window.clearTimeout(sseRetryTimerRef.current);
      sseRetryTimerRef.current = null;
    }
    if (sseFallbackTimerRef.current) {
      window.clearTimeout(sseFallbackTimerRef.current);
      sseFallbackTimerRef.current = null;
    }
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
  }

  async function syncStateOnce() {
    const siteId = selectedSiteIdRef.current;
    const runId = selectedRunIdRef.current;
    if (siteId) {
      void loadHistory(siteId, {
        preserveSelection: true,
        skipResultsWhileInProgress: true,
      });
    }
    if (runId) {
      void refreshSelectedRun(runId);
    }
    void refreshSites();
  }

  function scheduleFallbackSync() {
    if (sseFallbackTimerRef.current) return;
    sseFallbackTimerRef.current = window.setTimeout(() => {
      sseFallbackTimerRef.current = null;
      if (sseRef.current) return;
      void syncStateOnce();
    }, 8000);
  }

  function scheduleSseReconnect() {
    if (sseRetryTimerRef.current) return;
    const backoff = sseBackoffRef.current;
    const jitter = Math.floor(Math.random() * 400);
    const delay = Math.min(30000, backoff + jitter);
    sseBackoffRef.current = Math.min(30000, backoff * 2);
    sseRetryTimerRef.current = window.setTimeout(() => {
      sseRetryTimerRef.current = null;
      if (authUser) {
        startEventStream();
      }
    }, delay);
  }

  function handleScanEvent(payload: ScanEventPayload) {
    if (payload.site_id === selectedSiteIdRef.current) {
      const runId = payload.scan_run_id;
      setHistory((prev) => {
        const idx = prev.findIndex((r) => r.id === runId);
        const next: ScanRunSummary = {
          id: runId,
          site_id: payload.site_id,
          status: payload.status,
          started_at: payload.started_at ?? new Date().toISOString(),
          finished_at: payload.finished_at ?? null,
          start_url:
            payload.start_url ?? (idx >= 0 ? prev[idx].start_url : startUrl),
          total_links: payload.total_links ?? 0,
          checked_links: payload.checked_links ?? 0,
          broken_links: payload.broken_links ?? 0,
          error_message: payload.error_message ?? null,
        };
        if (idx === -1) return [next, ...prev];
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...next };
        return copy;
      });

      markRunProgress(runId);
      maybeNotifyRunStatus({
        id: runId,
        site_id: payload.site_id,
        status: payload.status,
        started_at: payload.started_at ?? null,
        finished_at: payload.finished_at ?? null,
        start_url: payload.start_url ?? startUrl,
        total_links: payload.total_links ?? 0,
        checked_links: payload.checked_links ?? 0,
        broken_links: payload.broken_links ?? 0,
        error_message: payload.error_message ?? null,
      });

      if (payload.status === "queued" || payload.status === "in_progress") {
        setActiveRunId(runId);
        activeRunIdRef.current = runId;
        setSelectedRunId(runId);
        selectedRunIdRef.current = runId;
      } else if (activeRunIdRef.current === runId) {
        setActiveRunId(null);
        activeRunIdRef.current = null;
      }

      if (
        payload.status !== "queued" &&
        payload.status !== "in_progress" &&
        selectedRunIdRef.current === runId
      ) {
        void refreshSelectedRun(runId);
      }
    }
  }

  function handleScheduleEvent(payload: ScheduleEventPayload) {
    setSites((prev) =>
      prev.map((site) =>
        site.id === payload.site_id
          ? {
              ...site,
              schedule_enabled: payload.schedule_enabled,
              schedule_frequency: payload.schedule_frequency,
              schedule_time_utc: payload.schedule_time_utc,
              schedule_day_of_week: payload.schedule_day_of_week,
              next_scheduled_at: payload.next_scheduled_at,
              last_scheduled_at: payload.last_scheduled_at,
            }
          : site,
      ),
    );
  }

  function startEventStream() {
    if (sseRef.current) return;
    if (!authUser) return;

    const source = new EventSource(`${API_BASE}/events/stream`, {
      withCredentials: true,
    });
    sseRef.current = source;

    source.onopen = () => {
      sseBackoffRef.current = 1000;
      if (sseRetryTimerRef.current) {
        window.clearTimeout(sseRetryTimerRef.current);
        sseRetryTimerRef.current = null;
      }
      if (sseFallbackTimerRef.current) {
        window.clearTimeout(sseFallbackTimerRef.current);
        sseFallbackTimerRef.current = null;
      }
    };

    const handleMessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as SsePayload;
        if (payload.type === "schedule_updated") {
          handleScheduleEvent(payload);
          return;
        }
        handleScanEvent(payload as ScanEventPayload);
      } catch {}
    };

    source.addEventListener("scan_started", handleMessage as EventListener);
    source.addEventListener("scan_progress", handleMessage as EventListener);
    source.addEventListener("scan_completed", handleMessage as EventListener);
    source.addEventListener("scan_failed", handleMessage as EventListener);
    source.addEventListener("schedule_updated", handleMessage as EventListener);

    source.onerror = () => {
      if (sseRef.current !== source) return;
      stopEventStream();
      scheduleFallbackSync();
      scheduleSseReconnect();
    };
  }

  useEffect(() => {
    void loadMe();
  }, []);

  useEffect(() => {
    if (authUser) {
      void loadSites();
    } else if (!authLoading) {
      resetSessionState();
    }
  }, [authLoading, authUser]);

  useEffect(() => {
    if (authUser) {
      startEventStream();
    } else {
      stopEventStream();
    }
  }, [authUser]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && authUser) {
        void syncStateOnce();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [authUser]);

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
    const stored = localStorage.getItem("scanlark_pane_width");
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
    localStorage.setItem("scanlark_pane_width", String(paneWidth));
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
      if (event.key === "n" && !isTyping) {
        if (!triggeringScan && selectedSiteId) {
          event.preventDefault();
          void handleRunScan();
        }
      }
      if (event.key === "a" && !isTyping) {
        event.preventDefault();
        setAddSiteOpen(true);
      }
      if (event.key === "?" && !isTyping) {
        event.preventDefault();
        setShortcutsOpen(true);
      }
      if (event.key === "Escape") {
        setIsDrawerOpen(false);
        setDetailsOpen(false);
        setDetailsLinkId(null);
        setIgnoreRulesOpen(false);
        setHistoryOpen(false);
        setFiltersOpen(false);
        setThemeMenuOpen(false);
        setAddSiteOpen(false);
        setShortcutsOpen(false);
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
    if (!isDrawerOpen) return;
    const id = window.requestAnimationFrame(() => {
      drawerCloseRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [isDrawerOpen]);

  useEffect(() => {
    const handleResize = () => setIsNarrow(window.innerWidth < 1360);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (detailsOpen && detailsLinkId && !selectedLink) {
      setDetailsOpen(false);
    }
  }, [detailsLinkId, detailsOpen, selectedLink]);

  useEffect(() => {
    if (!detailsOpen) return;
    detailsCloseRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const drawer = detailsDrawerRef.current;
      if (!drawer) return;
      const focusables = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [detailsOpen]);

  useEffect(() => {
    return () => {
      stopEventStream();
    };
  }, []);

  function resetSessionState() {
    setSites([]);
    setSelectedSiteId(null);
    selectedSiteIdRef.current = null;
    setHistory([]);
    setResults([]);
    setIgnoredResults([]);
    setReportData(null);
    setSelectedRunId(null);
    selectedRunIdRef.current = null;
    setActiveRunId(null);
    activeRunIdRef.current = null;
    setDetailsOpen(false);
    setDetailsLinkId(null);
  }

  async function loadMe() {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await apiFetch(`${API_BASE}/me`, {
        cache: "no-store",
      });
      if (res.status === 401) {
        setAuthUser(null);
        return;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Failed to fetch session: ${res.status}${
            text ? ` - ${text.slice(0, 200)}` : ""
          }`,
        );
      }
      const data = (await res.json()) as AuthUser;
      setAuthUser(data);
    } catch (err: unknown) {
      setAuthError(getErrorMessage(err, "Failed to check session"));
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleAuthSubmit() {
    const email = authEmail.trim();
    if (!email || !authPassword) {
      setAuthError("Email and password are required.");
      return;
    }
    setAuthWorking(true);
    setAuthError(null);
    try {
      const endpoint = authMode === "login" ? "login" : "register";
      const res = await apiFetch(`${API_BASE}/auth/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: authPassword }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Auth failed: ${res.status}${text ? ` - ${text.slice(0, 200)}` : ""}`,
        );
      }
      const data = (await res.json()) as AuthUser;
      setAuthUser(data);
      setAuthPassword("");
      setAuthError(null);
    } catch (err: unknown) {
      setAuthError(getErrorMessage(err, "Failed to authenticate"));
    } finally {
      setAuthWorking(false);
    }
  }

  async function handleLogout() {
    try {
      await apiFetch(`${API_BASE}/auth/logout`, { method: "POST" });
    } catch (err) {
      console.error("Logout failed", err);
    } finally {
      setAuthUser(null);
      resetSessionState();
    }
  }

  async function loadSites() {
    setSitesLoading(true);
    setSitesError(null);
    try {
      const res = await apiFetch(`${API_BASE}/sites`, { cache: "no-store" });
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

  async function refreshSites() {
    try {
      const res = await apiFetch(`${API_BASE}/sites`, { cache: "no-store" });
      if (!res.ok) return;
      const data: SitesResponse = await res.json();
      setSites(data.sites);

      const currentId = selectedSiteIdRef.current;
      if (currentId) {
        const match = data.sites.find((site) => site.id === currentId);
        if (match) {
          setStartUrl(match.url);
          return;
        }
      }

      if (data.sites.length === 0) {
        setSelectedSiteId(null);
        selectedSiteIdRef.current = null;
        setStartUrl("");
        setHistory([]);
        setSelectedRunId(null);
        selectedRunIdRef.current = null;
        setActiveRunId(null);
        activeRunIdRef.current = null;
        setResults([]);
        resetOccurrencesState();
        return;
      }

      if (!currentId) {
        const first = data.sites[0];
        setSelectedSiteId(first.id);
        selectedSiteIdRef.current = first.id;
        setStartUrl(first.url);
        await loadHistory(first.id, { preserveSelection: false });
      }
    } catch {}
  }

  async function loadHistory(siteId: string, opts?: LoadHistoryOpts) {
    const preserveSelection = !!opts?.preserveSelection;
    const skipResultsWhileInProgress = !!opts?.skipResultsWhileInProgress;

    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await apiFetch(
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
    const res = await apiFetch(
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
      const res = await apiFetch(
        buildIgnoredLinksUrl(runId, 0, LINKS_PAGE_SIZE),
        {
          cache: "no-store",
        },
      );
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
      const res = await apiFetch(
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
        const res = await apiFetch(
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
    setDetailsOpen(false);
    setDetailsLinkId(null);
  }, [selectedRunId]);

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
    if (!selectedSite) return;
    setScheduleEnabled(selectedSite.schedule_enabled ?? false);
    setScheduleFrequency(selectedSite.schedule_frequency ?? "weekly");
    setScheduleTimeUtc(normalizeTimeInput(selectedSite.schedule_time_utc));
    setScheduleDayOfWeek(selectedSite.schedule_day_of_week ?? 1);
    setScheduleError(null);
  }, [selectedSite]);

  useEffect(() => {
    if (!selectedSiteId) {
      setNotifyEnabled(false);
      setNotifyEmail("");
      setNotifyOn("issues");
      setNotifyIncludeCsv(false);
      setNotifyError(null);
      return;
    }
    void loadNotificationSettings(selectedSiteId);
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
    if (!selectedRunId || !compareRunId) {
      setDiffData(null);
      return;
    }
    void loadDiff(selectedRunId, compareRunId);
  }, [selectedRunId, compareRunId]);

  async function refreshSelectedRun(runId: string) {
    try {
      const res = await apiFetch(
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

        await loadHistory(run.site_id, { preserveSelection: true });
        await loadResults(run.id);
      }
    } catch {}
  }

  async function handleSelectSite(site: Site) {
    if (site.id === selectedSiteId) return;

    setIsDrawerOpen(false);
    setDetailsOpen(false);
    setDetailsLinkId(null);

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

  function handleNewScanAction() {
    if (!hasSites) {
      setCreateError(null);
      setAddSiteOpen(true);
      return;
    }
    if (!selectedSiteId) {
      setIsDrawerOpen(true);
      pushToast("Select a site to start a new scan", "warning");
      return;
    }
    void handleRunScan();
  }

  async function handleCancelScan() {
    if (!selectedRunId) return;
    try {
      await apiFetch(
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
      const res = await apiFetch(`${API_BASE}/sites`, {
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
      setAddSiteOpen(false);
      pushToast("Site added", "success");
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
      const res = await apiFetch(
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

  async function handleSaveSchedule() {
    if (!selectedSiteId) return;
    setScheduleSaving(true);
    setScheduleError(null);
    try {
      const res = await apiFetch(
        `${API_BASE}/sites/${encodeURIComponent(selectedSiteId)}/schedule`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            enabled: scheduleEnabled,
            frequency: scheduleFrequency,
            timeUtc: scheduleTimeUtc,
            dayOfWeek:
              scheduleFrequency === "weekly" ? scheduleDayOfWeek : null,
          }),
        },
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Schedule update failed: ${res.status}${text ? ` - ${text.slice(0, 200)}` : ""}`,
        );
      }

      const data = (await res.json()) as {
        scheduleEnabled: boolean;
        scheduleFrequency: "daily" | "weekly";
        scheduleTimeUtc: string;
        scheduleDayOfWeek: number | null;
        nextScheduledAt: string | null;
        lastScheduledAt: string | null;
      };

      setSites((prev) =>
        prev.map((site) =>
          site.id === selectedSiteId
            ? {
                ...site,
                schedule_enabled: data.scheduleEnabled,
                schedule_frequency: data.scheduleFrequency,
                schedule_time_utc: data.scheduleTimeUtc,
                schedule_day_of_week: data.scheduleDayOfWeek,
                next_scheduled_at: data.nextScheduledAt,
                last_scheduled_at: data.lastScheduledAt,
              }
            : site,
        ),
      );

      pushToast("Schedule updated", "success");
    } catch (err: unknown) {
      setScheduleError(getErrorMessage(err, "Failed to update schedule"));
    } finally {
      setScheduleSaving(false);
    }
  }

  async function loadNotificationSettings(siteId: string) {
    setNotifyLoading(true);
    setNotifyError(null);
    try {
      const res = await apiFetch(
        `${API_BASE}/sites/${encodeURIComponent(siteId)}/notification-settings`,
        {
          cache: "no-store",
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Failed to load notification settings: ${res.status}${
            text ? ` - ${text.slice(0, 200)}` : ""
          }`,
        );
      }
      const data = (await res.json()) as {
        notifyEnabled: boolean;
        notifyEmail: string | null;
        notifyOn: NotifyOnOption;
        notifyIncludeCsv: boolean;
      };
      setNotifyEnabled(data.notifyEnabled);
      setNotifyEmail(data.notifyEmail ?? "");
      setNotifyOn(data.notifyOn);
      setNotifyIncludeCsv(data.notifyIncludeCsv);
    } catch (err: unknown) {
      setNotifyError(
        getErrorMessage(err, "Failed to load notification settings"),
      );
    } finally {
      setNotifyLoading(false);
    }
  }

  async function handleSaveNotifications() {
    if (!selectedSiteId) return;
    if (notifyEnabled && notifyOn !== "never" && !notifyEmail.trim()) {
      setNotifyError(
        "Email is required when notifications are enabled and notify on is not never.",
      );
      return;
    }
    setNotifySaving(true);
    setNotifyError(null);
    try {
      const res = await apiFetch(
        `${API_BASE}/sites/${encodeURIComponent(selectedSiteId)}/notification-settings`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            enabled: notifyEnabled,
            email: notifyEmail.trim() || null,
            notifyOn,
            includeCsv: notifyIncludeCsv,
          }),
        },
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Notifications update failed: ${res.status}${text ? ` - ${text.slice(0, 200)}` : ""}`,
        );
      }

      const data = (await res.json()) as {
        notifyEnabled: boolean;
        notifyEmail: string | null;
        notifyOn: NotifyOnOption;
        notifyIncludeCsv: boolean;
      };

      setNotifyEnabled(data.notifyEnabled);
      setNotifyEmail(data.notifyEmail ?? "");
      setNotifyOn(data.notifyOn);
      setNotifyIncludeCsv(data.notifyIncludeCsv);

      setSites((prev) =>
        prev.map((site) =>
          site.id === selectedSiteId
            ? {
                ...site,
                notify_enabled: data.notifyEnabled,
                notify_email: data.notifyEmail,
                notify_on: data.notifyOn,
                notify_include_csv: data.notifyIncludeCsv,
              }
            : site,
        ),
      );

      pushToast("Notifications updated", "success");
    } catch (err: unknown) {
      setNotifyError(getErrorMessage(err, "Failed to update notifications"));
    } finally {
      setNotifySaving(false);
    }
  }

  async function handleSendTestEmail() {
    if (!selectedSiteId) return;
    setNotifyTestSending(true);
    setNotifyError(null);
    try {
      const res = await apiFetch(
        `${API_BASE}/sites/${encodeURIComponent(selectedSiteId)}/notifications/test`,
        { method: "POST" },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Test email failed: ${res.status}${text ? ` - ${text.slice(0, 200)}` : ""}`,
        );
      }
      pushToast("Test email sent", "success");
    } catch (err: unknown) {
      setNotifyError(getErrorMessage(err, "Failed to send test email"));
      pushToast(getErrorMessage(err, "Failed to send test email"), "warning");
    } finally {
      setNotifyTestSending(false);
    }
  }

  async function fetchOccurrencesForLink(scanLinkId: string, offset: number) {
    setOccurrencesLoadingByLinkId((prev) => ({ ...prev, [scanLinkId]: true }));
    setOccurrencesErrorByLinkId((prev) => ({ ...prev, [scanLinkId]: null }));

    try {
      const res = await apiFetch(
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

  function resetOccurrencesState() {
    setOccurrencesByLinkId({});
    setOccurrencesOffsetByLinkId({});
    setOccurrencesHasMoreByLinkId({});
    setOccurrencesLoadingByLinkId({});
    setOccurrencesTotalByLinkId({});
    setOccurrencesErrorByLinkId({});
  }

  async function copyToClipboard(
    text: string,
    _feedbackKey?: string,
    toastMessage = "Copied to clipboard",
  ) {
    try {
      await navigator.clipboard.writeText(text);
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
    const params = new URLSearchParams({
      classification,
      statusGroup,
      sort: sortOption,
    });
    if (activeTab === "ignored") params.set("ignoredOnly", "true");
    if (showIgnored) params.set("showIgnored", "true");
    if (searchQuery.trim()) params.set("search", searchQuery.trim());
    if (minOccurrencesOnly) params.set("minOccurrencesOnly", "true");
    const activeStatusFilters = Object.keys(statusFilters).filter(
      (key) => statusFilters[key],
    );
    if (activeStatusFilters.length > 0) {
      params.set("statusFilters", activeStatusFilters.join(","));
    }
    const url = `${API_BASE}/scan-runs/${encodeURIComponent(selectedRunId)}/links/export.${format}?${params.toString()}`;
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
    if (!selectedRunId) return;
    setTriggeringScan(true);
    try {
      const res = await apiFetch(
        `${API_BASE}/scan-runs/${encodeURIComponent(selectedRunId)}/retry`,
        { method: "POST" },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Retry failed: ${res.status}${text ? ` - ${text.slice(0, 200)}` : ""}`,
        );
      }
      setResults([]);
      resetOccurrencesState();
      setActiveRunId(selectedRunId);
      activeRunIdRef.current = selectedRunId;
      setHistory((prev) =>
        prev.map((run) =>
          run.id === selectedRunId ? { ...run, status: "queued" } : run,
        ),
      );
      pushToast("Scan queued", "info");
    } catch (err: unknown) {
      pushToast(getErrorMessage(err, "Failed to retry scan"), "warning");
    } finally {
      setTriggeringScan(false);
    }
  }

  function updateScanLinkState(next: ScanLink) {
    setResults((prev) => prev.map((row) => (row.id === next.id ? next : row)));
  }

  async function handleRecheckLink(row: ScanLink) {
    if (row.ignored) {
      pushToast("Ignored links cannot be rechecked", "warning");
      return;
    }
    setRecheckLoadingId(row.id);
    try {
      const res = await apiFetch(
        `${API_BASE}/scan-links/${encodeURIComponent(row.id)}/recheck`,
        { method: "POST" },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Recheck failed: ${res.status}${text ? ` - ${text.slice(0, 200)}` : ""}`,
        );
      }
      const data = (await res.json()) as RecheckScanLinkResponse;
      if (data.scanLink) {
        updateScanLinkState(data.scanLink);
      }
      pushToast("Link rechecked", "success");
    } catch (err: unknown) {
      pushToast(getErrorMessage(err, "Failed to recheck link"), "warning");
    } finally {
      setRecheckLoadingId(null);
    }
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

      const res = await apiFetch(
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

  async function handleIgnoreLinkWithUndo(row: ScanLink) {
    if (!selectedRunId) return;
    try {
      setResults((prev) =>
        prev.map((item) =>
          item.id === row.id
            ? {
                ...item,
                ignored: true,
                ignored_source: "rule",
                ignored_at: new Date().toISOString(),
              }
            : item,
        ),
      );
      const res = await apiFetch(
        `${API_BASE}/scan-runs/${encodeURIComponent(selectedRunId)}/scan-links/${encodeURIComponent(row.id)}/ignore`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "site_rule_exact" }),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Ignore failed: ${res.status}${text ? ` - ${text.slice(0, 200)}` : ""}`,
        );
      }
      const data = (await res.json()) as {
        scanRunId: string;
        link_url: string;
        rule?: IgnoreRule;
      };
      await loadResults(selectedRunId);
      pushToast("Link ignored", "info", {
        label: "Undo",
        onClick: () => {
          void (async () => {
            try {
              if (data.rule?.id) {
                const deleteRes = await apiFetch(
                  `${API_BASE}/ignore-rules/${encodeURIComponent(data.rule.id)}`,
                  { method: "DELETE" },
                );
                if (!deleteRes.ok) {
                  throw new Error(`Undo failed: ${deleteRes.status}`);
                }
                await reapplyIgnoreRules(selectedRunId);
              } else {
                const unignoreRes = await apiFetch(
                  `${API_BASE}/scan-runs/${encodeURIComponent(
                    selectedRunId,
                  )}/links/${encodeURIComponent(data.link_url)}/unignore`,
                  { method: "POST" },
                );
                if (!unignoreRes.ok) {
                  throw new Error(`Undo failed: ${unignoreRes.status}`);
                }
              }
              await loadResults(selectedRunId);
              pushToast("Ignore undone", "success");
            } catch (err: unknown) {
              pushToast(
                getErrorMessage(err, "Failed to undo ignore"),
                "warning",
              );
            }
          })();
        },
      });
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
      const res = await apiFetch(
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
      const res = await apiFetch(
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
      const res = await apiFetch(
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
    await apiFetch(
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
      const res = await apiFetch(
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
      const res = await apiFetch(
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
      const res = await apiFetch(
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
      const res = await apiFetch(
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
          status: "queued",
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

        void refreshSelectedRun(scanRunId);
        pushToast("Scan queued", "info");
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
    action?: { label: string; onClick: () => void },
  ) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((prev) => [...prev, { id, message, tone, action }]);
    const ttl = action ? 4500 : 2200;
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, ttl);
  }

  function maybeNotifyRunStatus(run: ScanRunSummary) {
    const prev = runStatusRef.current.get(run.id);
    if (prev === run.status) return;
    runStatusRef.current.set(run.id, run.status);
    if (run.status === "completed") {
      const canUseResults =
        run.id === selectedRunIdRef.current && results.length > 0;
      const blockedCount = canUseResults ? blockedResults.length : 0;
      const noResponseCount = canUseResults
        ? visibleResults.filter((row) => row.classification === "no_response")
            .length
        : 0;
      const checked = run.checked_links ?? 0;
      const total = run.total_links ?? 0;
      const broken = run.broken_links ?? 0;
      const message = `Scan complete: ${checked}/${total} checked • ${broken} broken • ${blockedCount} blocked • ${noResponseCount} no response`;
      pushToast(message, "success", {
        label: "View results",
        onClick: () => {
          setSelectedRunId(run.id);
          scansRef.current?.scrollIntoView({ behavior: "smooth" });
        },
      });
    }
    if (run.status === "failed") pushToast("Scan failed", "warning");
  }

  function toggleStatusFilter(key: string) {
    setStatusFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function createQuickIgnoreRule(
    ruleType: IgnoreRule["rule_type"],
    pattern: string,
  ) {
    if (!selectedSiteId) return;
    try {
      const res = await apiFetch(
        `${API_BASE}/sites/${encodeURIComponent(selectedSiteId)}/ignore-rules`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ruleType,
            pattern,
            scope: "site",
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Create failed: ${res.status}${text ? ` - ${text.slice(0, 200)}` : ""}`,
        );
      }
      await loadIgnoreRules(selectedSiteId);
      if (selectedRunId) await reapplyIgnoreRules(selectedRunId);
      if (selectedRunId) await loadResults(selectedRunId);
      pushToast("Ignore rule applied", "success");
    } catch (err: unknown) {
      pushToast(
        getErrorMessage(err, "Failed to create ignore rule"),
        "warning",
      );
    }
  }

  function openDetails(row: ScanLink) {
    setDetailsLinkId(row.id);
    setDetailsOpen(true);
    if (!occurrencesByLinkId[row.id]) {
      void fetchOccurrencesForLink(row.id, 0);
    }
  }

  function handleRowClick(
    event: React.MouseEvent<HTMLDivElement>,
    row: ScanLink,
  ) {
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-no-drawer]")) return;
    openDetails(row);
  }

  type LinkRowTheme = {
    accent: string;
    border: string;
    copyBorder: string;
    copyColor: string;
    panelBg: string;
  };

  function renderLinkRows(
    rows: ScanLink[],
    themeForRow: (row: ScanLink) => LinkRowTheme,
  ) {
    return rows.map((row) => {
      const theme = themeForRow(row);
      const linkCopyKey = `link:${row.id}`;
      const sourceCopyKey = `source:${row.id}`;
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
          className={`result-row severity-${row.classification}`}
          data-classification={row.classification}
          style={{
            borderLeft: `3px solid ${theme.border}`,
            background: theme.panelBg,
            boxShadow: row.ignored ? "none" : "var(--soft-shadow)",
            opacity: row.ignored ? 0.7 : 1,
          }}
          onClick={(event) => handleRowClick(event, row)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openDetails(row);
            }
          }}
        >
          <div className="result-cell result-link">
            <div className="result-host">{host}</div>
            <div className="result-url" title={row.link_url}>
              {row.link_url}
            </div>
            <div className="result-meta">
              {row.error_message ? row.error_message : "Tap for details"}
            </div>
          </div>
          <div className="result-cell result-status">
            <span
              className="status-chip"
              style={{ background: statusChipBg, color: statusChipText }}
              title={statusTooltip(row.status_code)}
            >
              {row.status_code ?? "No response"}
            </span>
            <span
              className="status-chip subtle"
              style={{ borderColor: theme.border }}
            >
              {formatClassification(row.classification)}
            </span>
            {row.ignored && <span className="status-chip subtle">Ignored</span>}
          </div>
          <div className="result-cell result-occ">
            <div className="occ-count">{row.occurrence_count}</div>
            <div className="occ-label">
              {row.occurrence_count === 1 ? "occurrence" : "occurrences"}
            </div>
          </div>
          <div className="result-cell result-actions row-actions">
            <button
              onClick={() => copyToClipboard(row.link_url, linkCopyKey)}
              className="icon-button"
              style={{
                borderColor: theme.copyBorder,
                color: theme.copyColor,
              }}
              data-no-drawer
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
                window.open(row.link_url, "_blank", "noopener,noreferrer")
              }
              className="icon-button"
              style={{
                borderColor: theme.copyBorder,
                color: theme.copyColor,
              }}
              data-no-drawer
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
              data-no-drawer
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
      );
    });
  }

  const brokenTheme: LinkRowTheme = {
    accent: "var(--danger)",
    border: "var(--danger)",
    copyBorder: "var(--danger)",
    copyColor: "var(--danger)",
    panelBg: "var(--panel-elev)",
  };

  const blockedTheme: LinkRowTheme = {
    accent: "var(--warning)",
    border: "var(--warning)",
    copyBorder: "var(--warning)",
    copyColor: "var(--warning)",
    panelBg: "var(--panel-elev)",
  };

  const okTheme: LinkRowTheme = {
    accent: "var(--success)",
    border: "var(--success)",
    copyBorder: "var(--success)",
    copyColor: "var(--success)",
    panelBg: "var(--panel-elev)",
  };

  const noResponseTheme: LinkRowTheme = {
    accent: "var(--muted)",
    border: "var(--border)",
    copyBorder: "var(--border)",
    copyColor: "var(--muted)",
    panelBg: "var(--panel-elev)",
  };

  const selectedOccurrences = useMemo(() => {
    if (!selectedLink) return [];
    return occurrencesByLinkId[selectedLink.id] ?? [];
  }, [occurrencesByLinkId, selectedLink]);
  const selectedOccurrencesTotal = selectedLink
    ? (occurrencesTotalByLinkId[selectedLink.id] ??
      selectedLink.occurrence_count)
    : 0;
  const selectedOccurrencesLoading = selectedLink
    ? (occurrencesLoadingByLinkId[selectedLink.id] ?? false)
    : false;
  const selectedOccurrencesError = selectedLink
    ? occurrencesErrorByLinkId[selectedLink.id]
    : null;
  const selectedOccurrencesHasMore = selectedLink
    ? (occurrencesHasMoreByLinkId[selectedLink.id] ?? false)
    : false;
  const showOccurrencesSkeleton =
    selectedOccurrencesLoading && selectedOccurrences.length === 0;

  return (
    <div
      className="app-shell"
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--text)",
        padding: "24px",
        width: "100%",
        maxWidth: "100%",
        overflowX: "hidden",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Space+Grotesk:wght@400;500;600;700&display=swap');
        :root[data-theme="dark"] {
          --bg: #070b14;
          --surface: #0f172a;
          --surface-2: #111f3a;
          --surface-3: #0b1224;
          --border: rgba(148, 163, 184, 0.18);
          --text: #e2e8f0;
          --muted: #94a3b8;
          --accent: #38bdf8;
          --accent-2: #22d3ee;
          --danger: #f87171;
          --warning: #fbbf24;
          --success: #34d399;
          --shadow: 0 20px 60px rgba(2, 6, 23, 0.45);
          --soft-shadow: 0 10px 30px rgba(2, 6, 23, 0.32);
          --chip-bg: rgba(15, 23, 42, 0.9);
          --chip-text: #e2e8f0;
          --ghost: #0b1220;
          --surface-accent: rgba(56, 189, 248, 0.1);
        }
        :root[data-theme="light"] {
          --bg: #f8fafc;
          --surface: #ffffff;
          --surface-2: #f1f5f9;
          --surface-3: #eef2ff;
          --border: rgba(15, 23, 42, 0.12);
          --text: #0f172a;
          --muted: #64748b;
          --accent: #2563eb;
          --accent-2: #38bdf8;
          --danger: #dc2626;
          --warning: #d97706;
          --success: #16a34a;
          --shadow: 0 16px 36px rgba(15, 23, 42, 0.12);
          --soft-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
          --chip-bg: rgba(241, 245, 249, 0.9);
          --chip-text: #0f172a;
          --ghost: #ffffff;
          --surface-accent: rgba(37, 99, 235, 0.08);
        }
        :root {
          --panel: var(--surface);
          --panel-elev: var(--surface-2);
          --panel-faint: var(--surface-3);
          --font-body: "IBM Plex Sans", system-ui, -apple-system, sans-serif;
          --font-display: "Space Grotesk", "IBM Plex Sans", system-ui, sans-serif;
        }
        html, body {
          margin: 0;
          padding: 0;
        }
        * {
          box-sizing: border-box;
        }
        .app-container {
          max-width: 1400px;
          width: 100%;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 24px;
          font-family: var(--font-body);
          min-height: calc(100vh - 48px);
          min-width: 0;
        }
        .app-shell {
          background: radial-gradient(1200px 420px at 10% -20%, rgba(34, 211, 238, 0.2), transparent 60%),
            radial-gradient(900px 340px at 90% -10%, rgba(59, 130, 246, 0.18), transparent 60%),
            var(--bg);
        }
        .shell {
          display: flex;
          gap: 16px;
          align-items: stretch;
          min-height: 0;
          flex: 1;
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
          border-radius: 16px;
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
          height: calc(100dvh - 90px);
          overflow: hidden;
          min-height: 0;
        }
        .sidebar-content {
          display: flex;
          flex-direction: column;
          gap: 16px;
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          overflow-x: hidden;
          padding-right: 4px;
        }
        .main {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 16px;
          min-height: 0;
          height: 100%;
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
          min-width: 0;
        }
        .results-layout > * {
          min-width: 0;
        }
        .results-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 4px;
          color: var(--text);
        }
        .results-title__label {
          font-family: var(--font-display);
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.02em;
        }
        .results-title__meta {
          margin-top: 4px;
          font-size: 11px;
          color: var(--muted);
        }
        .results-table {
          border-radius: 16px;
          border: 1px solid var(--border);
          background: var(--panel);
          overflow: hidden;
          box-shadow: var(--soft-shadow);
          min-width: 0;
        }
        .results-footer-space {
          height: 16px;
        }
        .results-summary {
          position: sticky;
          top: 70px;
          z-index: 10;
          background: var(--panel);
          padding: 14px 16px;
          border-bottom: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .results-summary__top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .results-summary__stats {
          font-size: 12px;
          color: var(--muted);
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
        }
        .results-summary__chip {
          font-size: 11px;
          color: var(--accent);
          background: var(--surface-accent);
          border: 1px solid var(--border);
          padding: 4px 10px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .results-summary__controls {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
          justify-content: space-between;
        }
        .results-tabs {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .results-controls {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .results-controls input,
        .results-controls select {
          padding: 6px 10px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--panel);
          color: var(--text);
          font-size: 12px;
        }
        .results-controls select {
          appearance: none;
          background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%),
            linear-gradient(135deg, var(--muted) 50%, transparent 50%);
          background-position: calc(100% - 14px) calc(50% - 3px),
            calc(100% - 9px) calc(50% - 3px);
          background-size: 5px 5px, 5px 5px;
          background-repeat: no-repeat;
          padding-right: 24px;
        }
        .results-header {
          position: sticky;
          top: 0;
          z-index: 5;
          display: grid;
          grid-template-columns: minmax(0, 1.4fr) minmax(160px, 0.6fr) 100px 140px;
          gap: 12px;
          padding: 12px 16px;
          background: linear-gradient(90deg, var(--surface), var(--surface-2));
          border-bottom: 1px solid var(--border);
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
          white-space: nowrap;
        }
        .results-header div:nth-child(3) {
          text-align: center;
        }
        .results-header div:last-child {
          text-align: right;
        }
        .results-header.single {
          grid-template-columns: minmax(0, 1fr);
        }
        .results-scroll {
          max-height: 560px;
          display: flex;
          flex-direction: column;
          gap: 0;
          overflow-y: auto;
          overflow-x: hidden;
          background: var(--panel);
          min-width: 0;
        }
        .result-row {
          display: grid;
          grid-template-columns: minmax(0, 1.4fr) minmax(160px, 0.6fr) 100px 140px;
          gap: 12px;
          padding: 14px 16px;
          border-bottom: 1px solid var(--border);
          transition: box-shadow 140ms ease, background 140ms ease;
          position: relative;
          overflow: visible;
          cursor: pointer;
          align-items: center;
          min-width: 0;
        }
        .result-row::after {
          content: "";
          position: absolute;
          inset: 0;
          opacity: 0;
          pointer-events: none;
          transition: opacity 140ms ease;
        }
        .result-row.severity-broken::after {
          background: linear-gradient(90deg, rgba(248, 113, 113, 0.12), transparent 50%);
        }
        .result-row.severity-blocked::after {
          background: linear-gradient(90deg, rgba(251, 191, 36, 0.12), transparent 50%);
        }
        .result-row.severity-no_response::after {
          background: linear-gradient(90deg, rgba(148, 163, 184, 0.16), transparent 50%);
        }
        .result-row:hover {
          background: var(--surface-accent);
        }
        .result-row:hover::after,
        .result-row:focus-within::after {
          opacity: 1;
        }
        .result-row:last-child {
          border-bottom: none;
        }
        .ignored-row {
          display: flex;
          border-bottom: none;
        }
        .result-cell {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }
        .result-link {
          align-items: flex-start;
        }
        .result-actions {
          align-items: center;
          justify-content: flex-end;
          width: 100%;
        }
        .result-host {
          font-family: var(--font-display);
          font-size: 13px;
          font-weight: 600;
          color: var(--text);
        }
        .result-url {
          font-size: 12px;
          color: var(--accent);
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .result-meta {
          font-size: 11px;
          color: var(--muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .result-status {
          align-items: flex-start;
        }
        .status-chip {
          font-size: 11px;
          padding: 3px 8px;
          border-radius: 999px;
          font-weight: 600;
          color: white;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1px solid transparent;
        }
        .status-chip.subtle {
          background: var(--chip-bg);
          color: var(--chip-text);
          border-color: var(--border);
          font-weight: 500;
        }
        .status-chip.run-status {
          background: rgba(148, 163, 184, 0.2);
          color: var(--text);
          border-color: rgba(148, 163, 184, 0.35);
          font-weight: 600;
          text-transform: capitalize;
        }
        .status-chip.run-status.success {
          background: rgba(34, 197, 94, 0.18);
          color: var(--success);
          border-color: rgba(34, 197, 94, 0.45);
        }
        .status-chip.run-status.warning {
          background: rgba(245, 158, 11, 0.2);
          color: var(--warning);
          border-color: rgba(245, 158, 11, 0.45);
        }
        .status-chip.run-status.danger {
          background: rgba(239, 68, 68, 0.18);
          color: var(--danger);
          border-color: rgba(239, 68, 68, 0.45);
        }
        .result-occ {
          align-items: center;
          text-align: center;
        }
        .occ-count {
          font-size: 20px;
          font-weight: 600;
          color: var(--text);
          font-family: var(--font-display);
        }
        .occ-label {
          font-size: 10px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .row-actions {
          display: inline-flex;
          gap: 6px;
          justify-content: flex-end;
          flex-wrap: wrap;
          align-items: center;
          opacity: 0.7;
          transition: opacity 140ms ease, transform 140ms ease;
          width: 100%;
        }
        .row-actions .icon-button {
          background: var(--surface-2);
          border-color: rgba(148, 163, 184, 0.35);
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
        .icon-button:hover {
          background: var(--surface-2);
        }
        .icon-button:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }
        .expand-panel {
          animation: expandFade 160ms ease;
          overflow: hidden;
          max-height: 640px;
          opacity: 1;
          transition: max-height 200ms ease, opacity 200ms ease;
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
          .results-header {
            grid-template-columns: minmax(0, 1fr);
            gap: 6px;
          }
          .result-row {
            grid-template-columns: minmax(0, 1fr);
          }
          .result-occ {
            align-items: flex-start;
            text-align: left;
          }
        }
        .results-layout.drawer-open {
          grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
        }
        .drawer {
          position: sticky;
          top: 16px;
          align-self: start;
          max-height: calc(100vh - 120px);
          overflow: hidden;
        }
        .details-overlay {
          position: fixed;
          inset: 0;
          background: rgba(2, 6, 23, 0.55);
          z-index: 45;
        }
        .details-drawer {
          position: sticky;
          top: 16px;
          align-self: start;
          height: calc(100vh - 120px);
          border-radius: 18px;
          border: 1px solid var(--border);
          background: var(--panel);
          box-shadow: var(--shadow);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: drawerSlide 200ms ease;
        }
        .details-drawer.overlay {
          position: fixed;
          right: 16px;
          left: 16px;
          top: 80px;
          bottom: 16px;
          height: auto;
          z-index: 50;
        }
        .drawer-header {
          padding: 16px;
          border-bottom: 1px solid var(--border);
          background: var(--surface-2);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .drawer-title {
          font-family: var(--font-display);
          font-size: 16px;
          font-weight: 600;
          color: var(--text);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .drawer-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .drawer-body {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          overflow: auto;
        }
        .drawer-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .drawer-section h4 {
          margin: 0;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted);
        }
        .drawer-chip-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .drawer-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 260px;
          overflow: auto;
        }
        .drawer-row {
          padding: 8px 10px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--panel-elev);
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .drawer-row a {
          flex: 1;
          min-width: 0;
          color: var(--text);
          text-decoration: none;
          overflow-wrap: anywhere;
          word-break: break-word;
          white-space: normal;
        }
        .drawer-row button {
          font-size: 11px;
        }
        @keyframes drawerSlide {
          from {
            transform: translateX(12px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
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
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .toast-action {
          margin-left: auto;
          padding: 4px 8px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: var(--panel-elev);
          color: var(--text);
          cursor: pointer;
          font-size: 11px;
          font-weight: 600;
        }
        .toast.success {
          border-color: rgba(52, 211, 153, 0.6);
        }
        .toast.warning {
          border-color: rgba(251, 191, 36, 0.7);
        }
        .toast.info {
          border-color: rgba(56, 189, 248, 0.6);
        }
        .skeleton {
          height: 44px;
          border-radius: 10px;
          background: linear-gradient(90deg, var(--panel-elev), var(--panel), var(--panel-elev));
          background-size: 200% 100%;
          animation: shimmer 1.2s ease-in-out infinite;
        }
        .skeleton--site {
          height: 58px;
        }
        .skeleton--occ {
          height: 32px;
          border-radius: 12px;
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
        .theme-toggle {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .theme-menu {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 12px;
          box-shadow: var(--shadow);
          padding: 6px;
          min-width: 160px;
          z-index: 30;
        }
        .theme-menu button {
          width: 100%;
          text-align: left;
          padding: 8px 10px;
          border-radius: 10px;
          border: 1px solid transparent;
          background: transparent;
          color: var(--text);
          cursor: pointer;
          font-size: 12px;
        }
        .theme-menu button.active {
          background: var(--surface-2);
          border-color: var(--border);
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
          animation: dropdownIn 160ms ease;
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
        @keyframes dropdownIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .tab-pill {
          padding: 6px 12px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: var(--panel);
          color: var(--muted);
          cursor: pointer;
          font-size: 12px;
          transition: background 150ms ease, color 150ms ease, border-color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
        }
        .tab-pill.active {
          background: linear-gradient(135deg, var(--accent), var(--accent-2));
          color: white;
          border-color: transparent;
          box-shadow: 0 8px 18px rgba(37, 99, 235, 0.25);
        }
        .tab-pill:hover {
          transform: translateY(-1px);
          border-color: rgba(148, 163, 184, 0.6);
          box-shadow: 0 6px 14px rgba(15, 23, 42, 0.12);
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
          border-radius: 16px;
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
          font-family: var(--font-display);
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
          border: 1px solid rgba(148, 163, 184, 0.35);
          background: var(--surface-2);
          color: var(--text);
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
        }
        .report-button:hover {
          transform: translateY(-1px);
          border-color: var(--accent);
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
          min-width: 0;
        }
        .report-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
          table-layout: fixed;
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
        .report-table td {
          overflow-wrap: anywhere;
          word-break: break-word;
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
        {authLoading ? (
          <div
            style={{
              minHeight: "60vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--muted)",
              fontSize: "13px",
            }}
          >
            Loading session...
          </div>
        ) : !authUser ? (
          <div
            style={{
              minHeight: "70vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "24px",
            }}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleAuthSubmit();
              }}
              style={{
                width: "min(420px, 100%)",
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "18px",
                padding: "20px",
                display: "flex",
                flexDirection: "column",
                gap: "14px",
                boxShadow: "var(--shadow)",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "20px",
                    fontWeight: 700,
                    fontFamily: "var(--font-display)",
                  }}
                >
                  Scanlark
                </div>
                <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                  Beta access required
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                }}
              >
                {(["login", "register"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setAuthMode(mode)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "999px",
                      border: "1px solid var(--border)",
                      background:
                        authMode === mode ? "var(--surface-2)" : "transparent",
                      cursor: "pointer",
                      fontSize: "12px",
                      fontWeight: 600,
                    }}
                  >
                    {mode === "login" ? "Login" : "Register"}
                  </button>
                ))}
              </div>
              <label style={{ fontSize: "12px", color: "var(--muted)" }}>
                Email
                <input
                  type="email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                  disabled={authWorking}
                  style={{
                    marginTop: "6px",
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "10px",
                    border: "1px solid var(--border)",
                    background: "var(--panel)",
                    color: "var(--text)",
                  }}
                />
              </label>
              <label style={{ fontSize: "12px", color: "var(--muted)" }}>
                Password
                <input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  autoComplete={
                    authMode === "login" ? "current-password" : "new-password"
                  }
                  placeholder="Enter your password"
                  disabled={authWorking}
                  style={{
                    marginTop: "6px",
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "10px",
                    border: "1px solid var(--border)",
                    background: "var(--panel)",
                    color: "var(--text)",
                  }}
                />
              </label>
              {authError && (
                <div style={{ fontSize: "12px", color: "var(--warning)" }}>
                  {authError}
                </div>
              )}
              <button
                type="submit"
                disabled={authWorking}
                style={{
                  padding: "10px 12px",
                  borderRadius: "12px",
                  border: "1px solid var(--border)",
                  background: "var(--panel-elev)",
                  cursor: authWorking ? "not-allowed" : "pointer",
                  fontSize: "13px",
                  fontWeight: 600,
                }}
              >
                {authWorking
                  ? "Please wait..."
                  : authMode === "login"
                    ? "Log in"
                    : "Create account"}
              </button>
              <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                TODO: Swap to managed auth provider before public launch.
              </div>
            </form>
          </div>
        ) : reportView ? (
          <div className="report-page">
            <div className="report-header">
              <div>
                <div className="report-title">Scanlark</div>
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
                  aria-controls="sidebar-drawer"
                  aria-expanded={isDrawerOpen}
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
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: "16px",
                      fontFamily: "var(--font-display)",
                      letterSpacing: "-0.02em",
                    }}
                  >
                    Scanlark
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
                {selectedSiteId
                  ? `Selected: ${safeHost(startUrl || "")}`
                  : "No site selected"}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  flexWrap: "wrap",
                }}
              >
                {hasSites && (
                  <button
                    onClick={() => {
                      setCreateError(null);
                      setAddSiteOpen(true);
                    }}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "10px",
                      border: "1px solid var(--border)",
                      background: "var(--panel)",
                      fontSize: "12px",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Add site
                  </button>
                )}
                {authUser ? (
                  <div
                    ref={userMenuRef}
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                      Hi, {authUser.name ?? authUser.email}
                    </div>
                    <button
                      onClick={() => setUserMenuOpen((prev) => !prev)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: "10px",
                        border: "1px solid var(--border)",
                        background: "var(--panel)",
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      Options
                    </button>
                    {userMenuOpen && (
                      <div className="theme-menu">
                        <div
                          style={{
                            fontSize: "11px",
                            color: "var(--muted)",
                            padding: "4px 8px",
                          }}
                        >
                          Theme
                        </div>
                        <button onClick={handleThemeToggle}>
                          Toggle {themeMode === "dark" ? "Light" : "Dark"}
                        </button>
                        {(["system", "dark", "light"] as const).map((mode) => (
                          <button
                            key={mode}
                            className={
                              themePreference === mode ? "active" : undefined
                            }
                            onClick={() => {
                              handleThemeChange(mode);
                              setUserMenuOpen(false);
                            }}
                          >
                            {mode === "system"
                              ? "System"
                              : mode === "dark"
                                ? "Dark"
                                : "Light"}
                          </button>
                        ))}
                        <div
                          style={{
                            height: "1px",
                            margin: "6px 0",
                            background: "var(--border)",
                          }}
                        />
                        <button onClick={() => void handleLogout()}>
                          Logout
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </nav>

            <div className="shell">
              <aside
                id="sidebar-drawer"
                ref={sidebarRef}
                className={`sidebar card drawer ${isDrawerOpen ? "open" : ""}`}
                style={{ width: paneWidth }}
                aria-label="Site navigation"
              >
                <div className="sidebar-content">
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
                          fontFamily: "var(--font-display)",
                          letterSpacing: "-0.02em",
                        }}
                      >
                        Scanlark
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
                      ref={drawerCloseRef}
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
                        marginBottom: "8px",
                      }}
                    >
                      Sites
                    </div>
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
                      {sitesLoading &&
                        filteredSites.length === 0 &&
                        Array.from({ length: 4 }).map((_, idx) => (
                          <div
                            key={`site-skeleton-${idx}`}
                            className="skeleton skeleton--site"
                          />
                        ))}
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
                                  cursor: isDeleting
                                    ? "not-allowed"
                                    : "pointer",
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
                        <div
                          style={{ fontSize: "12px", color: "var(--muted)" }}
                        >
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
                      Schedule
                    </div>
                    <div
                      style={{
                        borderRadius: "12px",
                        border: "1px solid var(--border)",
                        padding: "10px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                      }}
                    >
                      {!selectedSite && (
                        <div
                          style={{ fontSize: "12px", color: "var(--muted)" }}
                        >
                          Select a site to configure auto-scans.
                        </div>
                      )}
                      {selectedSite && (
                        <>
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: "10px",
                              fontSize: "12px",
                              color: "var(--text)",
                            }}
                          >
                            <span>Auto-scan</span>
                            <input
                              type="checkbox"
                              checked={scheduleEnabled}
                              onChange={(e) =>
                                setScheduleEnabled(e.target.checked)
                              }
                            />
                          </label>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr",
                              gap: "8px",
                            }}
                          >
                            <label
                              style={{
                                fontSize: "12px",
                                color: "var(--muted)",
                              }}
                            >
                              Frequency
                              <select
                                value={scheduleFrequency}
                                onChange={(e) =>
                                  setScheduleFrequency(
                                    e.target.value as "daily" | "weekly",
                                  )
                                }
                                style={{
                                  marginTop: "6px",
                                  width: "100%",
                                  padding: "6px 8px",
                                  borderRadius: "10px",
                                  border: "1px solid var(--border)",
                                  background: "var(--panel)",
                                  color: "var(--text)",
                                }}
                              >
                                <option value="daily">Daily</option>
                                <option value="weekly">Weekly</option>
                              </select>
                            </label>
                            {scheduleFrequency === "weekly" && (
                              <label
                                style={{
                                  fontSize: "12px",
                                  color: "var(--muted)",
                                }}
                              >
                                Day of week (UTC)
                                <select
                                  value={scheduleDayOfWeek}
                                  onChange={(e) =>
                                    setScheduleDayOfWeek(Number(e.target.value))
                                  }
                                  style={{
                                    marginTop: "6px",
                                    width: "100%",
                                    padding: "6px 8px",
                                    borderRadius: "10px",
                                    border: "1px solid var(--border)",
                                    background: "var(--panel)",
                                    color: "var(--text)",
                                  }}
                                >
                                  <option value={0}>Sunday</option>
                                  <option value={1}>Monday</option>
                                  <option value={2}>Tuesday</option>
                                  <option value={3}>Wednesday</option>
                                  <option value={4}>Thursday</option>
                                  <option value={5}>Friday</option>
                                  <option value={6}>Saturday</option>
                                </select>
                              </label>
                            )}
                            <label
                              style={{
                                fontSize: "12px",
                                color: "var(--muted)",
                              }}
                            >
                              Time (UTC)
                              <input
                                type="time"
                                value={scheduleTimeUtc}
                                onChange={(e) =>
                                  setScheduleTimeUtc(e.target.value)
                                }
                                style={{
                                  marginTop: "6px",
                                  width: "100%",
                                  padding: "6px 8px",
                                  borderRadius: "10px",
                                  border: "1px solid var(--border)",
                                  background: "var(--panel)",
                                  color: "var(--text)",
                                }}
                              />
                            </label>
                          </div>
                          <div
                            style={{ fontSize: "12px", color: "var(--muted)" }}
                          >
                            Next run:{" "}
                            {formatDate(selectedSite.next_scheduled_at)}
                          </div>
                          <div
                            style={{ fontSize: "12px", color: "var(--muted)" }}
                          >
                            Last scheduled run:{" "}
                            {formatDate(selectedSite.last_scheduled_at)}
                          </div>
                          {scheduleError && (
                            <div
                              style={{
                                fontSize: "12px",
                                color: "var(--warning)",
                              }}
                            >
                              {scheduleError}
                            </div>
                          )}
                          <button
                            onClick={() => void handleSaveSchedule()}
                            disabled={scheduleSaving}
                            style={{
                              padding: "6px 10px",
                              borderRadius: "10px",
                              border: "1px solid var(--border)",
                              background: scheduleSaving
                                ? "var(--panel-elev)"
                                : "var(--panel)",
                              cursor: scheduleSaving
                                ? "not-allowed"
                                : "pointer",
                              fontSize: "12px",
                              fontWeight: 600,
                            }}
                          >
                            {scheduleSaving ? "Saving..." : "Save schedule"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--muted)",
                        marginBottom: "8px",
                      }}
                    >
                      Notifications
                    </div>
                    <div
                      style={{
                        borderRadius: "12px",
                        border: "1px solid var(--border)",
                        padding: "10px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                      }}
                    >
                      {!selectedSite && (
                        <div
                          style={{ fontSize: "12px", color: "var(--muted)" }}
                        >
                          Select a site to configure notifications.
                        </div>
                      )}
                      {selectedSite && (
                        <>
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: "10px",
                              fontSize: "12px",
                              color: "var(--text)",
                            }}
                          >
                            <span>Email alerts</span>
                            <input
                              type="checkbox"
                              checked={notifyEnabled}
                              disabled={notifyLoading}
                              onChange={(e) =>
                                setNotifyEnabled(e.target.checked)
                              }
                            />
                          </label>
                          <label
                            style={{ fontSize: "12px", color: "var(--muted)" }}
                          >
                            Email address
                            <input
                              type="email"
                              value={notifyEmail}
                              onChange={(e) => setNotifyEmail(e.target.value)}
                              placeholder="you@example.com"
                              disabled={notifyLoading}
                              style={{
                                marginTop: "6px",
                                width: "100%",
                                padding: "6px 8px",
                                borderRadius: "10px",
                                border: "1px solid var(--border)",
                                background: "var(--panel)",
                                color: "var(--text)",
                              }}
                            />
                          </label>
                          <label
                            style={{ fontSize: "12px", color: "var(--muted)" }}
                          >
                            Notify on
                            <select
                              value={notifyOn}
                              onChange={(e) =>
                                setNotifyOn(e.target.value as NotifyOnOption)
                              }
                              disabled={notifyLoading}
                              style={{
                                marginTop: "6px",
                                width: "100%",
                                padding: "6px 8px",
                                borderRadius: "10px",
                                border: "1px solid var(--border)",
                                background: "var(--panel)",
                                color: "var(--text)",
                              }}
                            >
                              <option value="always">Always</option>
                              <option value="issues">Only when issues</option>
                              <option value="never">Never</option>
                            </select>
                          </label>
                          <label
                            style={{
                              display: "flex",
                              gap: "8px",
                              alignItems: "center",
                              fontSize: "12px",
                              color: "var(--text)",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={notifyIncludeCsv}
                              onChange={(e) =>
                                setNotifyIncludeCsv(e.target.checked)
                              }
                              disabled={notifyLoading}
                            />
                            Include CSV attachment (coming soon)
                          </label>
                          <div
                            style={{ fontSize: "12px", color: "var(--muted)" }}
                          >
                            We email you based on the selected trigger.
                          </div>
                          {notifyLoading && (
                            <div
                              style={{
                                fontSize: "12px",
                                color: "var(--muted)",
                              }}
                            >
                              Loading notification settings...
                            </div>
                          )}
                          {notifyError && (
                            <div
                              style={{
                                fontSize: "12px",
                                color: "var(--warning)",
                              }}
                            >
                              {notifyError}
                            </div>
                          )}
                          <div
                            style={{
                              display: "flex",
                              gap: "8px",
                              flexWrap: "wrap",
                            }}
                          >
                            <button
                              onClick={() => void handleSaveNotifications()}
                              disabled={
                                notifySaving ||
                                notifyLoading ||
                                (notifyEnabled &&
                                  notifyOn !== "never" &&
                                  !notifyEmail.trim())
                              }
                              style={{
                                padding: "6px 10px",
                                borderRadius: "10px",
                                border: "1px solid var(--border)",
                                background: notifySaving
                                  ? "var(--panel-elev)"
                                  : "var(--panel)",
                                cursor:
                                  notifySaving ||
                                  notifyLoading ||
                                  (notifyEnabled &&
                                    notifyOn !== "never" &&
                                    !notifyEmail.trim())
                                    ? "not-allowed"
                                    : "pointer",
                                fontSize: "12px",
                                fontWeight: 600,
                              }}
                            >
                              {notifySaving ? "Saving..." : "Save"}
                            </button>
                            <button
                              onClick={() => void handleSendTestEmail()}
                              disabled={
                                notifyTestSending ||
                                !notifyEmail.trim() ||
                                !notifyEnabled ||
                                notifyOn === "never" ||
                                notifyLoading
                              }
                              style={{
                                padding: "6px 10px",
                                borderRadius: "10px",
                                border: "1px solid var(--border)",
                                background: notifyTestSending
                                  ? "var(--panel-elev)"
                                  : "var(--panel)",
                                cursor:
                                  notifyTestSending ||
                                  !notifyEmail.trim() ||
                                  !notifyEnabled ||
                                  notifyOn === "never" ||
                                  notifyLoading
                                    ? "not-allowed"
                                    : "pointer",
                                fontSize: "12px",
                              }}
                            >
                              {notifyTestSending
                                ? "Sending..."
                                : "Send test email"}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
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
                                    void refreshSelectedRun(run.id);
                                  } else {
                                    setActiveRunId(null);
                                    activeRunIdRef.current = null;
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
                                <div style={{ marginBottom: "6px" }}>
                                  No scans yet.
                                </div>
                                <button
                                  onClick={handleRunScan}
                                  disabled={!selectedSiteId || triggeringScan}
                                  style={{
                                    padding: "4px 8px",
                                    borderRadius: "999px",
                                    border: "1px solid var(--border)",
                                    background: "var(--panel)",
                                    fontSize: "11px",
                                    cursor:
                                      !selectedSiteId || triggeringScan
                                        ? "not-allowed"
                                        : "pointer",
                                  }}
                                >
                                  {triggeringScan ? "Starting..." : "Run scan"}
                                </button>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
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
                    <div
                      style={{
                        fontSize: "22px",
                        fontWeight: 700,
                        fontFamily: "var(--font-display)",
                      }}
                    >
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
                    <div
                      style={{
                        marginTop: "10px",
                        padding: "8px 10px",
                        borderRadius: "10px",
                        border: "1px solid var(--border)",
                        background: "var(--panel)",
                        fontSize: "12px",
                        color: "var(--muted)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                        maxWidth: "520px",
                      }}
                    >
                      <div style={{ fontWeight: 600, color: "var(--text)" }}>
                        Automation
                      </div>
                      <div>
                        {selectedSite
                          ? formatScheduleSummary(
                              scheduleEnabled,
                              scheduleFrequency,
                              scheduleTimeUtc,
                              scheduleDayOfWeek,
                              selectedSite.next_scheduled_at,
                            )
                          : "Auto-scan: —"}
                      </div>
                      <div>
                        {selectedSite
                          ? formatAlertsSummary(notifyEnabled, notifyOn)
                          : "Alerts: —"}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={handleNewScanAction}
                      disabled={
                        !!selectedSiteId && (triggeringScan || canCancelRun)
                      }
                      style={{
                        padding: "6px 12px",
                        borderRadius: "999px",
                        border: "none",
                        background:
                          selectedSiteId && (triggeringScan || canCancelRun)
                            ? "var(--panel-elev)"
                            : "linear-gradient(135deg, var(--accent), var(--accent-2))",
                        color: "white",
                        fontWeight: 600,
                        cursor:
                          selectedSiteId && (triggeringScan || canCancelRun)
                            ? "not-allowed"
                            : "pointer",
                      }}
                      title={
                        !hasSites
                          ? "Add a site to start scanning"
                          : !selectedSiteId
                            ? "Select a site to start a scan"
                            : "Start a new scan"
                      }
                    >
                      {selectedSiteId && triggeringScan
                        ? "Running..."
                        : "New scan"}
                    </button>
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

                {!hasSites && (
                  <div className="card" style={{ padding: "24px" }}>
                    <div
                      style={{
                        fontSize: "18px",
                        fontWeight: 600,
                        fontFamily: "var(--font-display)",
                        marginBottom: "8px",
                      }}
                    >
                      Add your first site to start scanning
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                      Scanlark monitors your URLs, detects broken links, and
                      highlights blocked or timed-out requests.
                    </div>
                    <div style={{ marginTop: "16px" }}>
                      <button
                        onClick={() => {
                          setCreateError(null);
                          setAddSiteOpen(true);
                        }}
                        style={{
                          padding: "8px 14px",
                          borderRadius: "999px",
                          border: "none",
                          background:
                            "linear-gradient(135deg, var(--accent), var(--accent-2))",
                          color: "white",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Add a site
                      </button>
                    </div>
                  </div>
                )}

                {hasSites && (
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
                        {canCancelRun && (
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
                      <div style={{ padding: "16px 16px 0 16px" }} />
                    )}
                    <div
                      style={{
                        padding: "16px",
                        borderBottom: "1px solid var(--border)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "12px",
                          flexWrap: "wrap",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600 }}>
                            {runHeadingText}
                          </div>
                          <div
                            style={{ fontSize: "12px", color: "var(--muted)" }}
                          >
                            {selectedRun
                              ? `Started ${formatRelative(selectedRun.started_at)}`
                              : "No scans yet"}
                          </div>
                        </div>
                        {selectedRun && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                          >
                            <span
                              className={`status-chip run-status ${runStatusTone(
                                selectedRun.status,
                              )}`}
                            >
                              {selectedRun.status.replace("_", " ")}
                            </span>
                            {(canRetryRun || canRescan) && (
                              <button
                                onClick={() => {
                                  if (canRescan) {
                                    void handleRunScan();
                                  } else {
                                    void handleRetryScan();
                                  }
                                }}
                                className="report-button"
                                disabled={
                                  (canRescan &&
                                    (!selectedSiteId || triggeringScan)) ||
                                  (!canRescan && !canRetryRun)
                                }
                              >
                                Retry scan
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      {selectedRun && (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "16px",
                            fontSize: "12px",
                            color: "var(--muted)",
                          }}
                        >
                          <span>
                            Duration{" "}
                            {formatDuration(
                              selectedRun.started_at,
                              selectedRun.finished_at,
                            )}
                          </span>
                          <span>
                            Finished{" "}
                            {formatDate(selectedRun.finished_at ?? null)}
                          </span>
                          {selectedRun.error_message && (
                            <span style={{ color: "var(--warning)" }}>
                              {selectedRun.error_message}
                            </span>
                          )}
                        </div>
                      )}
                      {selectedRun && compareRun && diffSummary && (
                        <div
                          style={{
                            paddingTop: "10px",
                            borderTop: "1px solid var(--border)",
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                            fontSize: "12px",
                          }}
                        >
                          <span style={{ color: "var(--muted)" }}>
                            Compared to {formatRelative(compareRun.started_at)}{" "}
                            · {formatDate(compareRun.started_at)}
                          </span>
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: "12px",
                              color: "var(--text)",
                              fontWeight: 600,
                            }}
                          >
                            <span>New issues {diffSummary.addedIssues}</span>
                            <span>Fixed {diffSummary.removedIssues}</span>
                            <span>Changed {diffSummary.changed}</span>
                            <span>Unchanged {diffSummary.unchanged}</span>
                          </div>
                          {!hasDiffChanges && (
                            <span style={{ color: "var(--muted)" }}>
                              No issue changes since last run.
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {!selectedRunId && (
                      <div style={{ padding: "16px" }}>
                        <div
                          style={{
                            padding: "20px",
                            borderRadius: "12px",
                            border: "1px dashed var(--border)",
                            textAlign: "center",
                            color: "var(--muted)",
                          }}
                        >
                          Select a scan run to explore results, or start a new
                          scan from the site panel.
                        </div>
                      </div>
                    )}
                    <div style={{ marginBottom: "12px" }}>
                      <div className="results-summary">
                        <div className="results-summary__top">
                          {!isSelectedRunInProgress && (
                            <div className="results-summary__stats">
                              {resultsLoading ? (
                                <div
                                  className="skeleton"
                                  style={{ height: "16px", width: "260px" }}
                                />
                              ) : (
                                <>
                                  Checked {selectedRun?.checked_links ?? 0} /{" "}
                                  {selectedRun?.total_links ?? 0} • Broken{" "}
                                  {selectedRun?.broken_links ?? 0} • Blocked{" "}
                                  {blockedResults.length} • No response{" "}
                                  {
                                    visibleResults.filter(
                                      (row) =>
                                        row.classification === "no_response",
                                    ).length
                                  }
                                </>
                              )}
                            </div>
                          )}
                          {hasActiveFilters && (
                            <span className="results-summary__chip">
                              Filters active
                              <button
                                onClick={() => {
                                  setStatusFilters({});
                                  setMinOccurrencesOnly(false);
                                  setSearchQuery("");
                                  setActiveTab("all");
                                  setStatusGroup("all");
                                  setShowIgnored(false);
                                }}
                                className="report-button"
                                style={{ padding: "2px 8px" }}
                              >
                                Clear
                              </button>
                            </span>
                          )}
                        </div>
                        <div className="results-summary__controls">
                          <div className="results-tabs">
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
                                    ? "No response"
                                    : tab === "ignored"
                                      ? "Ignored"
                                      : tab[0].toUpperCase() + tab.slice(1)}
                              </button>
                            ))}
                          </div>
                          <div className="results-controls">
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
                                    {(
                                      [
                                        "all",
                                        "http_error",
                                        "no_response",
                                      ] as const
                                    ).map((group) => (
                                      <button
                                        key={group}
                                        onClick={() => setStatusGroup(group)}
                                        className={`tab-pill ${statusGroup === group ? "active" : ""}`}
                                      >
                                        {group === "all"
                                          ? "All responses"
                                          : group === "http_error"
                                            ? "HTTP response"
                                            : "No response"}
                                      </button>
                                    ))}
                                  </div>
                                  <div className="filter-row">
                                    {["401/403/429", "404", "5xx"].map(
                                      (key) => (
                                        <button
                                          key={key}
                                          onClick={() =>
                                            toggleStatusFilter(key)
                                          }
                                          className={`tab-pill ${statusFilters[key] ? "active" : ""}`}
                                        >
                                          {key}
                                        </button>
                                      ),
                                    )}
                                    <button
                                      onClick={() =>
                                        toggleStatusFilter("no_response")
                                      }
                                      className={`tab-pill ${statusFilters.no_response ? "active" : ""}`}
                                    >
                                      No response
                                    </button>
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
                              style={{ width: "200px" }}
                            />
                            <select
                              value={sortOption}
                              onChange={(e) =>
                                setSortOption(
                                  e.target.value as typeof sortOption,
                                )
                              }
                            >
                              <option value="severity">Severity</option>
                              <option value="occ_desc">Most occurrences</option>
                              <option value="status_desc">Status code</option>
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
                                onClick={() =>
                                  setExportMenuOpen((prev) => !prev)
                                }
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
                                    Export CSV (current view)
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
                                    Export JSON (current view)
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
                      className={`results-layout ${detailsOpen && !isNarrow ? "drawer-open" : ""}`}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div className="results-title">
                          <div>
                            <div className="results-title__label">Results</div>
                            <div className="results-title__meta">
                              Showing {resultsTitleCount} link
                              {resultsTitleCount === 1 ? "" : "s"}
                            </div>
                          </div>
                        </div>
                        <div className="results-table">
                          <div className="results-scroll">
                            <div
                              className={`results-header ${activeTab === "ignored" ? "single" : ""}`}
                            >
                              {activeTab === "ignored" ? (
                                <div>Ignored links</div>
                              ) : (
                                <>
                                  <div>Link</div>
                                  <div>Status</div>
                                  <div>Hits</div>
                                  <div>Actions</div>
                                </>
                              )}
                            </div>
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
                                      style={{
                                        fontSize: "12px",
                                        fontWeight: 600,
                                      }}
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
                                      <div style={{ marginBottom: "8px" }}>
                                        No results yet. Run a scan to populate
                                        this list.
                                      </div>
                                      <button
                                        onClick={handleRunScan}
                                        disabled={
                                          !selectedSiteId || triggeringScan
                                        }
                                        style={{
                                          padding: "6px 10px",
                                          borderRadius: "999px",
                                          border: "1px solid var(--border)",
                                          background: "var(--panel)",
                                          fontSize: "12px",
                                          cursor:
                                            !selectedSiteId || triggeringScan
                                              ? "not-allowed"
                                              : "pointer",
                                        }}
                                      >
                                        {triggeringScan
                                          ? "Starting..."
                                          : "Run scan"}
                                      </button>
                                    </div>
                                  )}
                                {renderLinkRows(filteredResults, (row) => {
                                  if (row.classification === "blocked")
                                    return blockedTheme;
                                  if (row.classification === "ok")
                                    return okTheme;
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
                                {!ignoredLoading &&
                                  ignoredResults.length === 0 && (
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
                                      className="result-row ignored-row"
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
                                            {row.rule_type &&
                                              row.rule_pattern && (
                                                <span
                                                  style={{
                                                    fontSize: "11px",
                                                    padding: "2px 6px",
                                                    borderRadius: "999px",
                                                    background: "var(--panel)",
                                                    color: "var(--muted)",
                                                    border:
                                                      "1px solid var(--border)",
                                                  }}
                                                >
                                                  {row.rule_type}:{" "}
                                                  {row.rule_pattern}
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
                                            margin: "0 12px 12px 34px",
                                            border: "1px solid var(--border)",
                                            borderRadius: "10px",
                                            background: "var(--panel)",
                                            boxShadow: "var(--soft-shadow)",
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
                                          {(
                                            ignoredOccurrences[row.id] ?? []
                                          ).map((occ) => (
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
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </>
                            )}
                          </div>
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
                            {activeTab === "no_response" &&
                              noResponseHasMore && (
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
                                  cursor: ignoredLoading
                                    ? "default"
                                    : "pointer",
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
                        <div className="results-footer-space" aria-hidden />
                      </div>

                      {detailsOpen && selectedLink && (
                        <aside
                          className={`details-drawer ${isNarrow ? "overlay" : ""}`}
                          ref={detailsDrawerRef}
                          aria-label="Link details drawer"
                        >
                          <div className="drawer-header">
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: "12px",
                              }}
                            >
                              <div
                                className="drawer-title"
                                title={selectedLink.link_url}
                              >
                                {selectedLink.link_url}
                              </div>
                              <button
                                ref={detailsCloseRef}
                                onClick={() => {
                                  setDetailsOpen(false);
                                  setDetailsLinkId(null);
                                }}
                                className="icon-button"
                                style={{
                                  borderColor: "var(--border)",
                                  color: "var(--text)",
                                }}
                                aria-label="Close details"
                              >
                                ✕
                              </button>
                            </div>
                            <div className="drawer-actions">
                              <button
                                onClick={() =>
                                  window.open(
                                    selectedLink.link_url,
                                    "_blank",
                                    "noopener,noreferrer",
                                  )
                                }
                                className="report-button"
                              >
                                Open link
                              </button>
                              <button
                                onClick={() =>
                                  copyToClipboard(
                                    selectedLink.link_url,
                                    `drawer:${selectedLink.id}`,
                                  )
                                }
                                className="report-button"
                              >
                                Copy URL
                              </button>
                              <button
                                onClick={() => handleRecheckLink(selectedLink)}
                                className="report-button"
                                disabled={
                                  selectedLink.ignored ||
                                  recheckLoadingId === selectedLink.id
                                }
                              >
                                {recheckLoadingId === selectedLink.id
                                  ? "Rechecking..."
                                  : "Recheck now"}
                              </button>
                              <button
                                onClick={() =>
                                  handleIgnoreLinkWithUndo(selectedLink)
                                }
                                className="report-button"
                                disabled={selectedLink.ignored}
                              >
                                Ignore link
                              </button>
                            </div>
                            <div className="drawer-chip-row">
                              <span
                                className="status-chip"
                                style={{
                                  background:
                                    selectedLink.status_code == null
                                      ? "var(--border)"
                                      : selectedLink.status_code >= 500
                                        ? "var(--danger)"
                                        : selectedLink.status_code === 404 ||
                                            selectedLink.status_code === 410
                                          ? "var(--danger)"
                                          : selectedLink.status_code === 401 ||
                                              selectedLink.status_code ===
                                                403 ||
                                              selectedLink.status_code === 429
                                            ? "var(--warning)"
                                            : "var(--success)",
                                  color:
                                    selectedLink.status_code == null
                                      ? "var(--muted)"
                                      : "white",
                                }}
                              >
                                {selectedLink.status_code ?? "No response"}
                              </span>
                              <span className="status-chip subtle">
                                {formatClassification(
                                  selectedLink.classification,
                                )}
                              </span>
                              {selectedLink.ignored && (
                                <span className="status-chip subtle">
                                  Ignored
                                </span>
                              )}
                            </div>
                            {selectedLink.error_message && (
                              <div
                                style={{
                                  fontSize: "12px",
                                  color: "var(--warning)",
                                }}
                              >
                                {selectedLink.error_message}
                              </div>
                            )}
                          </div>
                          <div className="drawer-body">
                            <div className="drawer-section">
                              <h4>Why this happened</h4>
                              {getWhyDetails(selectedLink).body.map((line) => (
                                <div
                                  key={line}
                                  style={{
                                    fontSize: "12px",
                                    color: "var(--muted)",
                                  }}
                                >
                                  {line}
                                </div>
                              ))}
                            </div>
                            <div className="drawer-section">
                              <h4>Recommended actions</h4>
                              <div className="drawer-actions">
                                <button
                                  className="report-button"
                                  onClick={() =>
                                    handleIgnoreLinkWithUndo(selectedLink)
                                  }
                                  disabled={selectedLink.ignored}
                                >
                                  Ignore exact URL
                                </button>
                                <button
                                  className="report-button"
                                  onClick={() => {
                                    const host = safeHost(
                                      selectedLink.link_url,
                                    );
                                    if (host === "unknown") {
                                      pushToast(
                                        "Invalid URL for domain rule",
                                        "warning",
                                      );
                                      return;
                                    }
                                    void createQuickIgnoreRule("domain", host);
                                  }}
                                  disabled={selectedLink.ignored}
                                >
                                  Ignore domain
                                </button>
                                <button
                                  className="report-button"
                                  onClick={() => {
                                    try {
                                      const url = new URL(
                                        selectedLink.link_url,
                                      );
                                      const prefix = url.pathname || "/";
                                      void createQuickIgnoreRule(
                                        "path_prefix",
                                        prefix,
                                      );
                                    } catch {
                                      pushToast(
                                        "Invalid URL for path rule",
                                        "warning",
                                      );
                                    }
                                  }}
                                  disabled={selectedLink.ignored}
                                >
                                  Ignore path pattern
                                </button>
                              </div>
                            </div>
                            <div className="drawer-section">
                              <h4>Occurrences</h4>
                              <div
                                style={{
                                  fontSize: "12px",
                                  color: "var(--muted)",
                                }}
                              >
                                {selectedOccurrencesTotal} total
                              </div>
                              {selectedOccurrencesError && (
                                <div
                                  style={{
                                    fontSize: "12px",
                                    color: "var(--warning)",
                                  }}
                                >
                                  {selectedOccurrencesError}
                                </div>
                              )}
                              {!selectedOccurrencesLoading &&
                                selectedOccurrences.length === 0 && (
                                  <div
                                    style={{
                                      fontSize: "12px",
                                      color: "var(--muted)",
                                    }}
                                  >
                                    No source pages recorded yet.
                                  </div>
                                )}
                              <div className="drawer-list">
                                {showOccurrencesSkeleton &&
                                  Array.from({ length: 3 }).map((_, idx) => (
                                    <div
                                      key={`occ-skeleton-${idx}`}
                                      className="skeleton skeleton--occ"
                                    />
                                  ))}
                                {selectedOccurrences.map((occ) => (
                                  <div key={occ.id} className="drawer-row">
                                    <a
                                      href={occ.source_page}
                                      target="_blank"
                                      rel="noreferrer"
                                      title={occ.source_page}
                                    >
                                      {occ.source_page}
                                    </a>
                                    <button
                                      onClick={() =>
                                        copyToClipboard(
                                          occ.source_page,
                                          `occ:${occ.id}`,
                                        )
                                      }
                                      className="report-button"
                                    >
                                      Copy
                                    </button>
                                  </div>
                                ))}
                                {selectedOccurrencesHasMore && (
                                  <button
                                    onClick={() =>
                                      selectedLink &&
                                      handleLoadMoreOccurrences(selectedLink.id)
                                    }
                                    disabled={selectedOccurrencesLoading}
                                    className="report-button"
                                  >
                                    {selectedOccurrencesLoading
                                      ? "Loading..."
                                      : "Load more occurrences"}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </aside>
                      )}
                    </div>
                  </div>
                )}
              </main>
            </div>

            {isDrawerOpen && (
              <div
                className="drawer-backdrop"
                onClick={() => setIsDrawerOpen(false)}
              />
            )}
            {detailsOpen && isNarrow && (
              <div
                className="details-overlay"
                onClick={() => {
                  setDetailsOpen(false);
                  setDetailsLinkId(null);
                }}
              />
            )}

            {ignoreRulesOpen && (
              <div
                className="modal-backdrop"
                onClick={() => setIgnoreRulesOpen(false)}
              >
                <div
                  className="modal"
                  role="dialog"
                  aria-modal="true"
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

            {addSiteOpen && (
              <div
                className="modal-backdrop"
                onClick={() => setAddSiteOpen(false)}
              >
                <div
                  className="modal"
                  role="dialog"
                  aria-modal="true"
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
                      <div style={{ fontWeight: 600 }}>Add site</div>
                      <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                        Enter the root URL to start scanning.
                      </div>
                    </div>
                    <button
                      onClick={() => setAddSiteOpen(false)}
                      className="icon-button"
                      style={{ borderColor: "var(--border)" }}
                    >
                      ✕
                    </button>
                  </div>
                  <label style={{ fontSize: "12px", color: "var(--muted)" }}>
                    Site URL
                    <input
                      value={newSiteUrl}
                      onChange={(e) => setNewSiteUrl(e.target.value)}
                      placeholder="https://example.com"
                      autoFocus
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleCreateSite();
                        }
                      }}
                      style={{
                        marginTop: "6px",
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: "10px",
                        border: "1px solid var(--border)",
                        background: "var(--panel)",
                        color: "var(--text)",
                        boxSizing: "border-box",
                      }}
                    />
                  </label>
                  {createError && (
                    <div style={{ fontSize: "12px", color: "var(--warning)" }}>
                      {createError}
                    </div>
                  )}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: "8px",
                    }}
                  >
                    <button
                      onClick={() => setAddSiteOpen(false)}
                      className="report-button"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateSite}
                      disabled={creatingSite || !newSiteUrl.trim()}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "10px",
                        border: "none",
                        background: creatingSite
                          ? "var(--panel-elev)"
                          : "linear-gradient(135deg, var(--accent), var(--accent-2))",
                        color: "white",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor:
                          creatingSite || !newSiteUrl.trim()
                            ? "not-allowed"
                            : "pointer",
                      }}
                    >
                      {creatingSite ? "Adding..." : "Add site"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {shortcutsOpen && (
              <div
                className="modal-backdrop"
                onClick={() => setShortcutsOpen(false)}
              >
                <div
                  className="modal"
                  role="dialog"
                  aria-modal="true"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>Keyboard shortcuts</div>
                    <button
                      onClick={() => setShortcutsOpen(false)}
                      className="icon-button"
                      style={{ borderColor: "var(--border)" }}
                    >
                      ✕
                    </button>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      fontSize: "12px",
                    }}
                  >
                    <div>Esc — Close drawers/modals</div>
                    <div>/ — Focus link search</div>
                    <div>N — Start new scan</div>
                    <div>A — Add site</div>
                    <div>? — Toggle this help</div>
                  </div>
                </div>
              </div>
            )}

            {historyOpen && (
              <div
                className="modal-backdrop"
                onClick={() => setHistoryOpen(false)}
              >
                <div
                  className="modal"
                  role="dialog"
                  aria-modal="true"
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
            <div key={toast.id} className={`toast ${toast.tone ?? "info"}`}>
              <span>{toast.message}</span>
              {toast.action && (
                <button
                  className="toast-action"
                  onClick={() => {
                    toast.action?.onClick();
                    setToasts((prev) =>
                      prev.filter((item) => item.id !== toast.id),
                    );
                  }}
                >
                  {toast.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default App;
