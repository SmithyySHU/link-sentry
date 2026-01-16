import React, { useEffect, useMemo, useRef, useState } from "react";

type ScanStatus = "in_progress" | "completed" | "failed";
type ThemeMode = "dark" | "light";
type ThemePreference = "system" | "dark" | "light";

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
  classification: "ok" | "broken" | "blocked";
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
  classification: "ok" | "broken" | "blocked";
  status_code: number | null;
  error_message: string | null;
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

interface ScanLinksResponse {
  scanRunId: string;
  classification?: string;
  countReturned: number;
  totalMatching: number;
  links: ScanLink[];
}

const API_BASE = "http://localhost:3001";
const POLL_MS = 1500;
const THEME_STORAGE_KEY = "theme";

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
  if (status == null) return "No status (network error)";
  if (status >= 500) return STATUS_TOOLTIPS[500];
  return STATUS_TOOLTIPS[status] ?? "";
}

function statusGroup(status: number | null) {
  if (status == null) return "unknown";
  if (status >= 500) return "5xx";
  if (status === 404 || status === 410) return "404";
  if (status === 401 || status === 403 || status === 429) return "401/403/429";
  return "other";
}

function getSystemTheme(): ThemeMode {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
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

  // Separate pagination tracking for broken and blocked
  const [brokenOffset, setBrokenOffset] = useState(0);
  const [brokenHasMore, setBrokenHasMore] = useState(false);
  const [blockedOffset, setBlockedOffset] = useState(0);
  const [blockedHasMore, setBlockedHasMore] = useState(false);

  const [occurrencesByLinkId, setOccurrencesByLinkId] = useState<Record<string, ScanLinkOccurrence[]>>({});
  const [occurrencesOffsetByLinkId, setOccurrencesOffsetByLinkId] = useState<Record<string, number>>({});
  const [occurrencesHasMoreByLinkId, setOccurrencesHasMoreByLinkId] = useState<Record<string, boolean>>({});
  const [occurrencesLoadingByLinkId, setOccurrencesLoadingByLinkId] = useState<Record<string, boolean>>({});
  const [occurrencesTotalByLinkId, setOccurrencesTotalByLinkId] = useState<Record<string, number>>({});
  const [occurrencesErrorByLinkId, setOccurrencesErrorByLinkId] = useState<Record<string, string | null>>({});

  const [startUrl, setStartUrl] = useState("");
  const [triggeringScan, setTriggeringScan] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const [newSiteUrl, setNewSiteUrl] = useState("");
  const [creatingSite, setCreatingSite] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [deletingSiteId, setDeletingSiteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<Record<string, boolean>>({});
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [paneWidth, setPaneWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "broken" | "blocked" | "no_response">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilters, setStatusFilters] = useState<Record<string, boolean>>({});
  const [minOccurrencesOnly, setMinOccurrencesOnly] = useState(false);
  const [sortOption, setSortOption] = useState<"severity" | "occ_desc" | "status_asc" | "status_desc" | "recent">("severity");
  const [siteSearch, setSiteSearch] = useState("");
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; tone?: "success" | "warning" | "info" }>>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [expandedRowIds, setExpandedRowIds] = useState<Record<string, boolean>>({});

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

  const pinnedRunId = activeRunId ?? selectedRunId;

  const selectedRun = useMemo(() => {
    if (pinnedRunId) {
      const found = history.find((r) => r.id === pinnedRunId);
      if (found) return found;
    }
    return history.length > 0 ? history[0] : null;
  }, [history, pinnedRunId]);

  const brokenResults = useMemo(
    () => results.filter((r) => r.classification === "broken"),
    [results]
  );

  const blockedResults = useMemo(
    () => results.filter((r) => r.classification === "blocked"),
    [results]
  );

  const filteredResults = useMemo(() => {
    const source =
      activeTab === "broken"
        ? brokenResults
        : activeTab === "blocked"
          ? blockedResults
          : activeTab === "no_response"
            ? results.filter(
                (row) =>
                  row.status_code == null ||
                  (row.error_message ?? "").toLowerCase().includes("timeout") ||
                  (row.error_message ?? "").toLowerCase().includes("failed")
              )
            : results;
    const query = searchQuery.trim().toLowerCase();
    const activeStatusFilters = Object.keys(statusFilters).filter((key) => statusFilters[key]);

    let next = source.filter((row) => {
      if (query && !row.link_url.toLowerCase().includes(query)) return false;
      if (minOccurrencesOnly && row.occurrence_count <= 1) return false;
      if (activeStatusFilters.length > 0 && !activeStatusFilters.includes(statusGroup(row.status_code))) return false;
      return true;
    });

    next = [...next].sort((a, b) => {
      if (sortOption === "occ_desc") return b.occurrence_count - a.occurrence_count;
      if (sortOption === "status_asc") return (a.status_code ?? 0) - (b.status_code ?? 0);
      if (sortOption === "status_desc") return (b.status_code ?? 0) - (a.status_code ?? 0);
      if (sortOption === "recent") return b.last_seen_at.localeCompare(a.last_seen_at);
      const severityRank = (row: ScanLink) => {
        if (row.classification === "broken") return 0;
        if (row.classification === "blocked") return 1;
        return 2;
      };
      const diff = severityRank(a) - severityRank(b);
      if (diff !== 0) return diff;
      return b.occurrence_count - a.occurrence_count;
    });

    return next;
  }, [activeTab, brokenResults, blockedResults, results, searchQuery, statusFilters, minOccurrencesOnly, sortOption]);

  const hasActiveFilters =
    activeTab !== "all" ||
    searchQuery.trim().length > 0 ||
    minOccurrencesOnly ||
    Object.values(statusFilters).some(Boolean);

  const filteredSites = useMemo(() => {
    const query = siteSearch.trim().toLowerCase();
    if (!query) return sites;
    return sites.filter((site) => site.url.toLowerCase().includes(query));
  }, [sites, siteSearch]);

  const isSelectedRunInProgress = isInProgress(selectedRun?.status);

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
      if (selectedRunIdRef.current !== scanRunId && activeRunIdRef.current !== scanRunId) return;
      try {
        const res = await fetch(`${API_BASE}/scan-runs/${encodeURIComponent(scanRunId)}`, {
          cache: "no-store",
        });
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

    const source = new EventSource(`${API_BASE}/scan-runs/${encodeURIComponent(scanRunId)}/events`);
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
      setLastUpdatedAt(new Date().toLocaleTimeString());
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
        const data = JSON.parse(event.data) as ScanRunSummary;
        if (data?.id) handleScanRunUpdate(data);
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
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemePreference | null;
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
    if (themePreference !== "system" || typeof window === "undefined" || typeof window.matchMedia !== "function") {
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
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "/" && searchInputRef.current && !isTyping) {
        event.preventDefault();
        searchInputRef.current.focus();
      }
      if (event.key === "Escape") {
        setIsDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
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
        { cache: "no-store" }
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
      } else if (preserveSelection && prevSelected && scans.some((r) => r.id === prevSelected)) {
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

  async function loadResults(runId: string) {
    setResultsLoading(true);
    setResultsError(null);
    setResults([]);
    resetOccurrencesState();
    setBrokenOffset(0);
    setBlockedOffset(0);
    try {
      // Load broken links (unique, deduplicated)
      const brokenRes = await fetch(
        `${API_BASE}/scan-runs/${encodeURIComponent(runId)}/links?limit=50&offset=0&classification=broken`,
        { cache: "no-store" }
      );
      if (!brokenRes.ok) throw new Error(`Failed to load broken links: ${brokenRes.status}`);
      const brokenData: ScanLinksResponse = await brokenRes.json();

      // Load blocked links (unique, deduplicated)
      const blockedRes = await fetch(
        `${API_BASE}/scan-runs/${encodeURIComponent(runId)}/links?limit=50&offset=0&classification=blocked`,
        { cache: "no-store" }
      );
      if (!blockedRes.ok) throw new Error(`Failed to load blocked links: ${blockedRes.status}`);
      const blockedData: ScanLinksResponse = await blockedRes.json();

      // Combine links for display (we keep both, but filter separately via useMemo)
      setResults([...brokenData.links, ...blockedData.links]);
      
      // Update pagination state for broken links
      setBrokenOffset(50);
      setBrokenHasMore(brokenData.countReturned + 0 < brokenData.totalMatching);
      
      // Update pagination state for blocked links
      setBlockedOffset(50);
      setBlockedHasMore(blockedData.countReturned + 0 < blockedData.totalMatching);

      setSelectedRunId(runId);
      selectedRunIdRef.current = runId;
    } catch (err: unknown) {
      setResultsError(getErrorMessage(err, "Failed to load scan links"));
    } finally {
      setResultsLoading(false);
    }
  }

  async function loadMoreBrokenResults(runId: string) {
    if (resultsLoading) return;

    setResultsLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/scan-runs/${encodeURIComponent(runId)}/links?limit=50&offset=${brokenOffset}&classification=broken`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      const data: ScanLinksResponse = await res.json();
      setResults((prev) => [...prev, ...data.links]);
      setBrokenOffset((prev) => prev + 50);
      setBrokenHasMore(brokenOffset + data.countReturned < data.totalMatching);
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
      const res = await fetch(
        `${API_BASE}/scan-runs/${encodeURIComponent(runId)}/links?limit=50&offset=${blockedOffset}&classification=blocked`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      const data: ScanLinksResponse = await res.json();
      setResults((prev) => [...prev, ...data.links]);
      setBlockedOffset((prev) => prev + 50);
      setBlockedHasMore(blockedOffset + data.countReturned < data.totalMatching);
    } catch (err: unknown) {
      setResultsError(getErrorMessage(err, "Failed to load more blocked links"));
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

  async function refreshSelectedRun(runId: string) {
    try {
      const res = await fetch(`${API_BASE}/scan-runs/${encodeURIComponent(runId)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        console.error("[frontend] refreshSelectedRun API error:", res.status);
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
      setLastUpdatedAt(new Date().toLocaleTimeString());
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
    } catch (e) {
      console.error("[frontend] refreshSelectedRun error:", e);
    }
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
          `Create failed: ${res.status}${text ? ` - ${text.slice(0, 200)}` : ""}`
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

    const ok = window.confirm(`Delete this site and all scans/results?${label}`);
    if (!ok) return;

    setDeletingSiteId(siteId);
    setDeleteError(null);
    try {
      const res = await fetch(`${API_BASE}/sites/${encodeURIComponent(siteId)}`, {
        method: "DELETE",
      });

      if (res.status === 404) {
        setDeleteError("Site not found (maybe already deleted).");
        await loadSites();
        return;
      }

      if (!res.ok && res.status !== 204) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Delete failed: ${res.status}${text ? ` - ${text.slice(0, 200)}` : ""}`
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
      const limitPerPage = 50;
      const res = await fetch(
        `${API_BASE}/scan-links/${encodeURIComponent(scanLinkId)}/occurrences?limit=${limitPerPage}&offset=${offset}`,
        { cache: "no-store" }
      );

      if (!res.ok) {
        throw new Error(`Failed to fetch occurrences: ${res.status}`);
      }

      const data: ScanLinkOccurrencesResponse = await res.json();
      setOccurrencesByLinkId((prev) => ({
        ...prev,
        [scanLinkId]:
          offset === 0 ? data.occurrences : [...(prev[scanLinkId] ?? []), ...data.occurrences],
      }));
      setOccurrencesOffsetByLinkId((prev) => ({ ...prev, [scanLinkId]: offset + data.countReturned }));
      setOccurrencesTotalByLinkId((prev) => ({ ...prev, [scanLinkId]: data.totalMatching }));
      setOccurrencesHasMoreByLinkId((prev) => ({
        ...prev,
        [scanLinkId]: offset + data.countReturned < data.totalMatching,
      }));
      setOccurrencesLoadingByLinkId((prev) => ({ ...prev, [scanLinkId]: false }));
    } catch (err: unknown) {
      const errorMsg = getErrorMessage(err, "Failed to load occurrences");
      setOccurrencesLoadingByLinkId((prev) => ({ ...prev, [scanLinkId]: false }));
      setOccurrencesErrorByLinkId((prev) => ({ ...prev, [scanLinkId]: errorMsg }));
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

  async function copyToClipboard(text: string, feedbackKey?: string) {
    try {
      await navigator.clipboard.writeText(text);
      if (feedbackKey) showCopyFeedback(feedbackKey);
      pushToast("Copied to clipboard", "success");
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
      pushToast("Copy failed", "warning");
    }
  }

  function exportAsCSV(links: ScanLink[], classification: string) {
    const rows = [
      [
        "link_url",
        "source_page",
        "status_code",
        "classification",
        "error_message",
        "occurrence_count",
        "first_seen_at",
        "last_seen_at",
      ],
      ...links.map((link) => [
        link.link_url,
        "",
        link.status_code ?? "",
        link.classification,
        link.error_message ?? "",
        link.occurrence_count,
        link.first_seen_at ?? "",
        link.last_seen_at ?? "",
      ]),
    ];

    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${classification}-links-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    pushToast(`Exported ${classification} CSV`, "success");
  }

  async function handleRetryScan() {
    const retryUrl = selectedRun?.start_url ?? startUrl;
    if (!selectedRun || !retryUrl.trim()) return;
    setStartUrl(retryUrl);
    setResults([]);
    resetOccurrencesState();
    await handleRunScanWithUrl(retryUrl);
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
        }
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Scan trigger failed: ${res.status}${text ? ` - ${text.slice(0, 200)}` : ""}`
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

  function pushToast(message: string, tone: "success" | "warning" | "info" = "info") {
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

  function renderLinkRows(rows: ScanLink[], themeForRow: (row: ScanLink) => LinkRowTheme) {
    return rows.map((row) => {
      const theme = themeForRow(row);
      const isExpanded = !!expandedRowIds[row.id];
      const occurrences = occurrencesByLinkId[row.id] ?? [];
      const occurrencesTotal = occurrencesTotalByLinkId[row.id] ?? row.occurrence_count;
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
              : row.status_code === 401 || row.status_code === 403 || row.status_code === 429
              ? "var(--warning)"
                : "var(--success)";
      const statusChipText = row.status_code == null ? "var(--muted)" : "white";

      return (
        <div
          id={`scan-link-${row.id}`}
          key={row.id}
          className="result-row"
          style={{
            borderRadius: "10px",
            border: `1px solid ${theme.border}`,
            background: theme.panelBg,
            display: "flex",
            flexDirection: "column",
            boxShadow: isExpanded ? "0 0 0 2px var(--accent)" : "none",
          }}
        >
          <div style={{ padding: "8px 10px", display: "flex", gap: "8px", alignItems: "flex-start" }}>
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
                <span style={{ fontWeight: 600, fontSize: "13px" }}>{host}</span>
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
                  {row.status_code ?? "null"}
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
                  {row.classification}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
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
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    overflowWrap: "anywhere",
                    wordBreak: "break-word",
                  }}
                >
                  {row.link_url}
                </a>
                <div className="row-actions">
                  <button
                    onClick={() => copyToClipboard(row.link_url, linkCopyKey)}
                    style={{
                      background: "transparent",
                      border: `1px solid ${theme.copyBorder}`,
                      color: theme.copyColor,
                      cursor: "pointer",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontSize: "11px",
                      flexShrink: 0,
                    }}
                    aria-label="Copy link"
                    title="Copy link"
                  >
                    {copyFeedback[linkCopyKey] ? "Copied!" : "⧉"}
                  </button>
                  <button
                    onClick={() => {
                      if (firstSource) {
                        void copyToClipboard(firstSource, sourceCopyKey);
                      } else if (!isExpanded) {
                        void toggleExpandLink(row.id);
                      } else {
                        void fetchOccurrencesForLink(row.id, 0);
                      }
                    }}
                    style={{
                      background: "transparent",
                      border: `1px solid ${theme.copyBorder}`,
                      color: theme.copyColor,
                      cursor: "pointer",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontSize: "11px",
                      opacity: canCopySource ? 1 : 0.7,
                    }}
                    aria-label="Copy source"
                    title={canCopySource ? "Copy source page" : "Load occurrences to copy source"}
                  >
                    {copyFeedback[sourceCopyKey] ? "Copied!" : "⧉"}
                  </button>
                </div>
              </div>
              {row.error_message && (
                <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px", overflowWrap: "anywhere" }}>
                  {row.error_message}
                </div>
              )}
              <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
                found on {row.occurrence_count} {row.occurrence_count === 1 ? "page" : "pages"}
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
                Seen on {occurrencesTotal} {occurrencesTotal === 1 ? "page" : "pages"}
              </div>
              <div style={{ fontSize: "12px", color: "var(--muted)", overflowWrap: "anywhere" }}>
                <a href={row.link_url} target="_blank" rel="noreferrer" style={{ color: "var(--text)", textDecoration: "underline" }}>
                  {row.link_url}
                </a>{" "}
                · status <span title={statusTooltip(row.status_code)}>{row.status_code ?? "null"}</span>{" "}
                {row.error_message ? `· ${row.error_message}` : ""}
              </div>
              {occurrencesLoading && occurrences.length === 0 && (
                <div style={{ fontSize: "12px", color: "var(--muted)" }}>Loading occurrences...</div>
              )}
              {occurrencesError && <div style={{ fontSize: "12px", color: "var(--warning)" }}>{occurrencesError}</div>}
              {occurrences.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
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
                        onClick={() => copyToClipboard(occ.source_page, `occ:${occ.id}`)}
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
                      {occurrencesLoading ? "Loading..." : "Load more occurrences"}
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

  return (
    <div className="app-shell" style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", padding: "24px", maxWidth: "100%", overflowX: "hidden" }}>
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
        }
        .result-row:hover {
          transform: translateY(-2px);
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
        <nav className="top-nav">
          <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
            <button
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
              <div style={{ fontWeight: 700, fontSize: "16px" }}>Link Sentry</div>
              <div style={{ fontSize: "11px", color: "var(--muted)" }}>Link integrity monitor</div>
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: "12px", color: "var(--muted)", padding: "0 8px" }}>
            Dashboard
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <button
              onClick={handleThemeToggle}
              style={{
                position: "relative",
                width: "44px",
                height: "24px",
                borderRadius: "999px",
                border: "1px solid var(--border)",
                background: themeMode === "dark" ? "var(--panel-elev)" : "var(--accent)",
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
            className={`sidebar card drawer ${isDrawerOpen ? "open" : ""}`}
            style={{ width: paneWidth }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h1 style={{ margin: 0, fontSize: "20px", letterSpacing: "-0.02em" }}>Link Sentry</h1>
                <p style={{ margin: 0, color: "var(--muted)", fontSize: "12px" }}>Link integrity monitor</p>
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
              <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "6px" }}>Add site</div>
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
                  background: creatingSite ? "var(--panel-elev)" : "var(--accent)",
                  color: "white",
                  fontWeight: 600,
                  cursor: creatingSite || !newSiteUrl.trim() ? "not-allowed" : "pointer",
                  fontSize: "12px",
                }}
              >
                {creatingSite ? "Adding..." : "Add site"}
              </button>
              {createError && <div style={{ fontSize: "12px", color: "var(--warning)", marginTop: "6px" }}>{createError}</div>}
            </div>

            <div>
              <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "8px" }}>Sites</div>
              {sitesLoading && <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "6px" }}>Loading sites...</div>}
              {sitesError && <div style={{ fontSize: "12px", color: "var(--warning)", marginBottom: "6px" }}>{sitesError}</div>}
              <div className="scroll-y" style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "220px" }}>
                {filteredSites.map((site) => {
                  const isSelected = site.id === selectedSiteId;
                  const isDeleting = deletingSiteId === site.id;

                  return (
                    <div
                      key={site.id}
                      style={{
                        borderRadius: "12px",
                        border: "1px solid var(--border)",
                        background: isSelected ? "var(--panel-elev)" : "var(--panel)",
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
                        <div style={{ fontSize: "13px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{site.url}</div>
                        <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
                          created {formatDate(site.created_at)}
                        </div>
                      </button>

                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button
                          onClick={() => handleDeleteSite(site.id)}
                          disabled={isDeleting}
                          style={{
                            padding: "4px 8px",
                            borderRadius: "999px",
                            border: "1px solid var(--danger)",
                            background: isDeleting ? "var(--panel-elev)" : "var(--panel)",
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
                  <div style={{ fontSize: "12px", color: "var(--muted)" }}>No sites match.</div>
                )}
              </div>
              {deleteError && <p style={{ color: "var(--warning)", fontSize: "12px", marginTop: "8px" }}>{deleteError}</p>}
            </div>

            <div>
              <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "8px" }}>Recent scans</div>
              <div className="scroll-y" style={{ maxHeight: "220px", borderRadius: "12px", border: "1px solid var(--border)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                  <thead style={{ position: "sticky", top: 0, background: "var(--panel)", zIndex: 1 }}>
                    <tr>
                      <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontWeight: 500 }}>
                        Started
                      </th>
                      <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontWeight: 500 }}>
                        Broken
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((run) => {
                      const isSelected = run.id === pinnedRunId;
                      const brokenPct = percentBroken(run.checked_links || run.total_links, run.broken_links);
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
                          style={{ cursor: "pointer", background: isSelected ? "var(--panel-elev)" : "transparent" }}
                        >
                          <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>{formatDate(run.started_at)}</td>
                          <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>
                            {run.broken_links} ({brokenPct})
                          </td>
                        </tr>
                      );
                    })}
                    {history.length === 0 && !historyLoading && (
                      <tr>
                        <td colSpan={2} style={{ padding: "10px", textAlign: "center", color: "var(--muted)" }}>
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

            <div className="card" style={{ display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "22px", fontWeight: 700 }}>{startUrl ? safeHost(startUrl) : "No site selected"}</div>
                <div style={{ fontSize: "12px", color: "var(--muted)", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
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
                  onClick={handleRunScan}
                  disabled={!selectedSiteId || triggeringScan}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "999px",
                    border: "none",
                    background: triggeringScan ? "var(--panel-elev)" : "var(--success)",
                    color: "white",
                    fontWeight: 600,
                    cursor: triggeringScan || !selectedSiteId ? "not-allowed" : "pointer",
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap", marginBottom: "12px" }}>
                <div style={{ position: "sticky", top: 70, zIndex: 10, background: "var(--panel)", padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                      Checked {selectedRun?.checked_links ?? 0} / {selectedRun?.total_links ?? 0} • Broken{" "}
                      {selectedRun?.broken_links ?? 0} • Blocked {blockedResults.length} • No response{" "}
                      {results.filter((row) => row.status_code == null).length}
                    </div>
                    {hasActiveFilters && (
                      <span style={{ fontSize: "12px", color: "var(--accent)" }}>Filters active</span>
                    )}
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                      {(["all", "broken", "blocked", "no_response"] as const).map((tab) => (
                        <button
                          key={tab}
                          className={`tab-pill ${activeTab === tab ? "active" : ""}`}
                          onClick={() => setActiveTab(tab)}
                        >
                          {tab === "no_response" ? "No response" : tab[0].toUpperCase() + tab.slice(1)}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
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
                        onClick={() => setMinOccurrencesOnly((prev) => !prev)}
                        className={`tab-pill ${minOccurrencesOnly ? "active" : ""}`}
                      >
                        Occurrences &gt; 1
                      </button>
                      <button
                        onClick={() => {
                          setStatusFilters({});
                          setMinOccurrencesOnly(false);
                          setSearchQuery("");
                          setActiveTab("all");
                        }}
                        className="tab-pill"
                      >
                        Reset filters
                      </button>
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
                        onChange={(e) => setSortOption(e.target.value as typeof sortOption)}
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
                      {isSelectedRunInProgress && <span style={{ fontSize: "12px", color: "var(--muted)" }}>Updating…</span>}
                      <button
                        onClick={() => exportAsCSV(filteredResults, activeTab)}
                        disabled={filteredResults.length === 0}
                        style={{
                          padding: "6px 10px",
                          borderRadius: "999px",
                          border: "1px solid var(--border)",
                          background: "var(--panel)",
                          color: "var(--text)",
                          cursor: filteredResults.length === 0 ? "not-allowed" : "pointer",
                          fontSize: "12px",
                          fontWeight: 600,
                        }}
                      >
                        Export CSV
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="results-layout">
                <div style={{ minWidth: 0 }}>
                  <div className="scroll-y" style={{ maxHeight: "560px", display: "flex", flexDirection: "column", gap: "10px", padding: "16px" }}>
                    {resultsError && (
                      <div style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid var(--border)", color: "var(--warning)" }}>
                        {resultsError}
                      </div>
                    )}
                    {resultsLoading &&
                      Array.from({ length: 6 }).map((_, idx) => <div key={idx} className="skeleton" />)}
                    {!resultsLoading && filteredResults.length === 0 && results.length > 0 && (
                      <div style={{ padding: "20px", borderRadius: "12px", border: "1px dashed var(--border)", textAlign: "center", color: "var(--muted)" }}>
                        <div style={{ marginBottom: "8px" }}>No results match these filters.</div>
                        <button
                          onClick={() => {
                            setStatusFilters({});
                            setMinOccurrencesOnly(false);
                            setSearchQuery("");
                            setActiveTab("all");
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
                    {!resultsLoading && filteredResults.length === 0 && results.length === 0 && (
                      <div style={{ padding: "20px", borderRadius: "12px", border: "1px dashed var(--border)", textAlign: "center", color: "var(--muted)" }}>
                        No results yet. Run a scan to populate this list.
                      </div>
                    )}
                    {renderLinkRows(filteredResults, (row) => (row.classification === "blocked" ? blockedTheme : brokenTheme))}
                  </div>

                  <div style={{ marginTop: "12px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
                    {(activeTab === "broken" || activeTab === "all") && brokenHasMore && (
                      <button
                        onClick={() => selectedRunId && loadMoreBrokenResults(selectedRunId)}
                        disabled={resultsLoading}
                        style={{
                          padding: "8px 14px",
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
                        {resultsLoading ? "Loading..." : "Load more broken"}
                      </button>
                    )}
                    {(activeTab === "blocked" || activeTab === "all") && blockedHasMore && (
                      <button
                        onClick={() => selectedRunId && loadMoreBlockedResults(selectedRunId)}
                        disabled={resultsLoading}
                        style={{
                          padding: "8px 14px",
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
                        {resultsLoading ? "Loading..." : "Load more blocked"}
                      </button>
                    )}
                  </div>
                </div>

              </div>
            </div>
          </main>
        </div>

        {isDrawerOpen && <div className="drawer-backdrop" onClick={() => setIsDrawerOpen(false)} />}


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
