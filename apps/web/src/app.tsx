import React, { useEffect, useMemo, useRef, useState } from "react";

type ScanStatus = "in_progress" | "completed" | "failed";

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
  count: number;
  results: ScanResultRow[];
}

const API_BASE = "http://localhost:3001";
const POLL_MS = 1500;

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

type LoadHistoryOpts = {
  preserveSelection?: boolean;
  skipResultsWhileInProgress?: boolean;
};

const App: React.FC = () => {
  const scansRef = useRef<HTMLDivElement | null>(null);

  const pollHistoryRef = useRef<number | null>(null);
  const pollRunRef = useRef<number | null>(null);

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
  const [results, setResults] = useState<ScanResultRow[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [resultsOffset, setResultsOffset] = useState(0);
  const [resultsHasMore, setResultsHasMore] = useState(false);

  const [startUrl, setStartUrl] = useState("");
  const [triggeringScan, setTriggeringScan] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const [newSiteUrl, setNewSiteUrl] = useState("");
  const [creatingSite, setCreatingSite] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [deletingSiteId, setDeletingSiteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const hasSites = sites.length > 0;

  useEffect(() => {
    selectedSiteIdRef.current = selectedSiteId;
  }, [selectedSiteId]);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  useEffect(() => {
    activeRunIdRef.current = activeRunId;
    console.log("[frontend] activeRunId updated:", activeRunId);
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
    console.log("[frontend] Starting polling, activeRunId:", activeRunIdRef.current, "selectedRunId:", selectedRunIdRef.current);
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
        console.log("[frontend] No runId to poll");
        return;
      }
      console.log("[frontend] Polling run", runId);
      void refreshSelectedRun(runId);
    }, POLL_MS);
  }

  useEffect(() => {
    void loadSites();
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
        setHistory([]);

        await loadHistory(first.id, { preserveSelection: false });
      } else {
        setSelectedSiteId(null);
        selectedSiteIdRef.current = null;

        setHistory([]);
        setSelectedRunId(null);
        selectedRunIdRef.current = null;

        setResults([]);
        setStartUrl("");

        setActiveRunId(null);
        activeRunIdRef.current = null;
      }
    } catch (err: any) {
      setSitesError(err?.message ?? "Failed to load sites");
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
    } catch (err: any) {
      setHistoryError(err?.message ?? "Failed to load history");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadResults(runId: string) {
    setResultsLoading(true);
    setResultsError(null);
    setResultsOffset(0);
    setResults([]);
    try {
      const res = await fetch(
        `${API_BASE}/scan-runs/${encodeURIComponent(runId)}/results?limit=50&offset=0`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      const data: ScanResultsResponse = await res.json();
      setResults(data.results);
      setResultsOffset(50);
      setResultsHasMore(data.results.length === 50);

      setSelectedRunId(runId);
      selectedRunIdRef.current = runId;
    } catch (err: any) {
      setResultsError(err?.message ?? "Failed to load scan results");
    } finally {
      setResultsLoading(false);
    }
  }

  async function loadMoreResults(runId: string) {
    if (resultsLoading) return;

    setResultsLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/scan-runs/${encodeURIComponent(runId)}/results?limit=50&offset=${resultsOffset}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      const data: ScanResultsResponse = await res.json();
      setResults((prev) => [...prev, ...data.results]);
      setResultsOffset((prev) => prev + 50);
      setResultsHasMore(data.results.length === 50);
    } catch (err: any) {
      setResultsError(err?.message ?? "Failed to load more results");
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

    if (shouldPoll) startPolling();
    else stopPolling();

    return () => stopPolling();
  }, [selectedSiteId, activeRunId, selectedRun?.id, selectedRun?.status]);

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

      console.log("[frontend] refreshSelectedRun response:", run);
      console.log("[frontend] run.status:", run.status, "isInProgress:", isInProgress(run.status));

      setHistory((prev) => {
        const idx = prev.findIndex((r) => r.id === run.id);
        if (idx === -1) {
          console.log("[frontend] Adding new run to history");
          return [run, ...prev];
        }
        console.log("[frontend] Updating run in history at index", idx);
        const copy = [...prev];
        copy[idx] = run;
        return copy;
      });

      if (selectedRunIdRef.current !== run.id) {
        console.log("[frontend] Updating selectedRunId");
        setSelectedRunId(run.id);
        selectedRunIdRef.current = run.id;
      }

      if (!isInProgress(run.status)) {
        console.log("[frontend] Scan completed, stopping polling");
        setActiveRunId(null);
        activeRunIdRef.current = null;

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

    setActiveRunId(null);
    activeRunIdRef.current = null;

    setHistory([]);
    setResults([]);

    setSelectedRunId(null);
    selectedRunIdRef.current = null;

    setSelectedSiteId(site.id);
    selectedSiteIdRef.current = site.id;

    setStartUrl(site.url);

    await loadHistory(site.id, { preserveSelection: false });
  }

  async function handleRunScan() {
    if (!selectedSiteId || !startUrl.trim()) return;

    setTriggeringScan(true);
    setTriggerError(null);
    try {
      const res = await fetch(
        `${API_BASE}/sites/${encodeURIComponent(selectedSiteId)}/scans`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ startUrl }),
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
          start_url: startUrl,
          total_links: 0,
          checked_links: 0,
          broken_links: 0,
        };

        setHistory((prev) => {
          const without = prev.filter((r) => r.id !== scanRunId);
          return [optimistic, ...without];
        });

        setResults([]);

        setSelectedRunId(scanRunId);
        selectedRunIdRef.current = scanRunId;

        setActiveRunId(scanRunId);
        activeRunIdRef.current = scanRunId;

        console.log("[frontend] About to call startPolling");
        startPolling();
        console.log("[frontend] About to call refreshSelectedRun immediately");
        void refreshSelectedRun(scanRunId);
        console.log("[frontend] refreshSelectedRun called");
      } else {
        await loadHistory(selectedSiteId, { preserveSelection: false });
      }
    } catch (err: any) {
      setTriggerError(err?.message ?? "Failed to start scan");
    } finally {
      setTriggeringScan(false);
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
          `Create failed: ${res.status}${text ? ` - ${text.slice(0, 200)}` : ""}`
        );
      }

      setNewSiteUrl("");
      await loadSites();
    } catch (err: any) {
      setCreateError(err?.message ?? "Failed to create site");
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

        setSelectedSiteId(null);
        selectedSiteIdRef.current = null;

        setHistory([]);
        setResults([]);

        setSelectedRunId(null);
        selectedRunIdRef.current = null;

        setStartUrl("");

        setActiveRunId(null);
        activeRunIdRef.current = null;
      }

      await loadSites();
    } catch (err: any) {
      setDeleteError(err?.message ?? "Failed to delete site");
    } finally {
      setDeletingSiteId(null);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", color: "#e5e7eb", padding: "24px" }}>
      <div style={{ maxWidth: "1100px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "24px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "28px" }}>Link-Sentry</h1>
            <p style={{ margin: 0, color: "#9ca3af" }}>Internal dev dashboard</p>
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <button
              onClick={() => scansRef.current?.scrollIntoView({ behavior: "smooth" })}
              style={{
                padding: "6px 10px",
                borderRadius: "999px",
                border: "1px solid #334155",
                background: "#020617",
                color: "#e5e7eb",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              Link Scan
            </button>

            <span style={{ fontSize: "12px", padding: "4px 10px", borderRadius: "999px", background: "#1e293b", color: "#9ca3af" }}>
              api: http://localhost:3001
            </span>
          </div>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "1.2fr 1.8fr 2fr", gap: "16px", alignItems: "flex-start" }}>
          <div style={{ background: "#020617", borderRadius: "16px", padding: "16px", border: "1px solid #1e293b" }}>
            <h2 style={{ marginTop: 0, marginBottom: "12px", fontSize: "18px" }}>Sites</h2>

            {sitesLoading && <p style={{ fontSize: "14px" }}>Loading sites...</p>}
            {sitesError && <p style={{ color: "#f97316", fontSize: "13px" }}>{sitesError}</p>}

            {!sitesLoading && sites.length === 0 && !sitesError && (
              <p style={{ fontSize: "14px", color: "#9ca3af" }}>No sites yet — add one on the right.</p>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "260px", overflowY: "auto" }}>
              {sites.map((site) => {
                const isSelected = site.id === selectedSiteId;
                const isDeleting = deletingSiteId === site.id;

                return (
                  <div
                    key={site.id}
                    style={{
                      borderRadius: "12px",
                      border: "1px solid #1e293b",
                      background: isSelected ? "#111827" : "#020617",
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
                        color: "#e5e7eb",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      <div style={{ fontSize: "14px", fontWeight: 500 }}>{site.url}</div>
                      <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>
                        created {formatDate(site.created_at)}
                      </div>
                    </button>

                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button
                        onClick={() => handleDeleteSite(site.id)}
                        disabled={isDeleting}
                        style={{
                          padding: "6px 10px",
                          borderRadius: "999px",
                          border: "1px solid #7f1d1d",
                          background: isDeleting ? "#4b5563" : "#111827",
                          color: "#fca5a5",
                          cursor: isDeleting ? "not-allowed" : "pointer",
                          fontSize: "12px",
                        }}
                      >
                        {isDeleting ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {deleteError && <p style={{ color: "#f97316", fontSize: "13px", marginTop: "10px" }}>{deleteError}</p>}
          </div>

          <div
            style={{
              background: "#020617",
              borderRadius: "16px",
              padding: "16px",
              border: "1px solid #1e293b",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div>
              <h2 style={{ marginTop: 0, marginBottom: "12px", fontSize: "18px" }}>Add site</h2>

              <label style={{ fontSize: "14px" }}>
                Site URL
                <input
                  value={newSiteUrl}
                  onChange={(e) => setNewSiteUrl(e.target.value)}
                  placeholder="https://example.com"
                  style={{
                    marginTop: "4px",
                    width: "100%",
                    padding: "6px 8px",
                    borderRadius: "8px",
                    border: "1px solid #334155",
                    background: "#020617",
                    color: "#e5e7eb",
                    boxSizing: "border-box",
                  }}
                />
              </label>

              <button
                onClick={handleCreateSite}
                disabled={creatingSite || !newSiteUrl.trim()}
                style={{
                  marginTop: "10px",
                  padding: "8px 12px",
                  borderRadius: "999px",
                  border: "none",
                  background: creatingSite ? "#4b5563" : "#60a5fa",
                  color: "#020617",
                  fontWeight: 700,
                  cursor: creatingSite || !newSiteUrl.trim() ? "not-allowed" : "pointer",
                }}
              >
                {creatingSite ? "Adding..." : "Add site"}
              </button>

              {createError && <p style={{ color: "#f97316", fontSize: "13px", marginTop: "10px" }}>{createError}</p>}
            </div>

            <div>
              <h2 style={{ marginTop: 0, marginBottom: "12px", fontSize: "18px" }}>Site configuration</h2>

              {!hasSites && <p style={{ fontSize: "14px", color: "#9ca3af" }}>Add a site first to run scans.</p>}

              {hasSites && selectedSiteId && (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <label style={{ fontSize: "14px" }}>
                    Start URL
                    <input
                      value={startUrl}
                      onChange={(e) => setStartUrl(e.target.value)}
                      style={{
                        marginTop: "4px",
                        width: "100%",
                        padding: "6px 8px",
                        borderRadius: "8px",
                        border: "1px solid #334155",
                        background: "#020617",
                        color: "#e5e7eb",
                        boxSizing: "border-box",
                      }}
                    />
                  </label>

                  <button
                    onClick={handleRunScan}
                    disabled={triggeringScan || !startUrl.trim()}
                    style={{
                      marginTop: "8px",
                      padding: "8px 12px",
                      borderRadius: "999px",
                      border: "none",
                      background: triggeringScan ? "#4b5563" : "#22c55e",
                      color: "#020617",
                      fontWeight: 700,
                      cursor: triggeringScan || !startUrl.trim() ? "not-allowed" : "pointer",
                    }}
                  >
                    {triggeringScan ? "Running scan..." : "Run new scan"}
                  </button>

                  {triggerError && <p style={{ color: "#f97316", fontSize: "13px" }}>{triggerError}</p>}
                </div>
              )}
            </div>
          </div>

          <div style={{ background: "#020617", borderRadius: "16px", padding: "16px", border: "1px solid #1e293b" }}>
            <h2 style={{ marginTop: 0, marginBottom: "12px", fontSize: "18px" }}>Selected scan</h2>

            {!hasSites && <p style={{ fontSize: "14px", color: "#9ca3af" }}>Add a site to view scan history.</p>}

            {hasSites && historyLoading && <p>Loading history...</p>}
            {hasSites && historyError && <p style={{ color: "#f97316", fontSize: "13px" }}>{historyError}</p>}
            {hasSites && !historyLoading && !selectedRun && !historyError && (
              <p style={{ fontSize: "14px", color: "#9ca3af" }}>No scans found for this site yet.</p>
            )}

            {hasSites && selectedRun && (
              <div style={{ display: "grid", gap: "6px", fontSize: "14px" }}>
                <div>
                  <span style={{ color: "#9ca3af" }}>Run ID</span>
                  <div style={{ fontFamily: "monospace" }}>{selectedRun.id}</div>
                </div>

                <div>
                  <span style={{ color: "#9ca3af" }}>Status</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span>{selectedRun.status}</span>
                    {isInProgress(selectedRun.status) && (
                      <span style={{ fontSize: "12px", padding: "2px 8px", borderRadius: "999px", background: "#1e293b", color: "#93c5fd" }}>
                        Running…
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <span style={{ color: "#9ca3af" }}>Started</span>
                  <div>{formatDate(selectedRun.started_at)}</div>
                </div>

                <div>
                  <span style={{ color: "#9ca3af" }}>Finished</span>
                  <div>{selectedRun.finished_at ? formatDate(selectedRun.finished_at) : "in progress"}</div>
                </div>

                <div>
                  <span style={{ color: "#9ca3af" }}>Links</span>
                  <div>
                    total {selectedRun.total_links}, checked {selectedRun.checked_links}, broken {selectedRun.broken_links} (
                    {percentBroken(selectedRun.checked_links || selectedRun.total_links, selectedRun.broken_links)})
                  </div>

                  {isInProgress(selectedRun.status) && (
                    <div style={{ marginTop: "6px", fontSize: "12px", color: "#9ca3af" }}>
                      {selectedRun.total_links > 0 ? (
                        <>
                          progress {progressPercent(selectedRun.checked_links, selectedRun.total_links)} (
                          {selectedRun.checked_links}/{selectedRun.total_links})
                        </>
                      ) : (
                        <>discovering links…</>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        <div ref={scansRef} />

        <section style={{ display: hasSites ? "grid" : "none", gridTemplateColumns: "1.7fr 1fr 1.3fr", gap: "16px", alignItems: "flex-start" }}>
          <div style={{ background: "#020617", borderRadius: "16px", padding: "16px", border: "1px solid #1e293b", overflow: "hidden" }}>
            <h2 style={{ marginTop: 0, marginBottom: "12px", fontSize: "18px" }}>Recent scans</h2>

            <div style={{ maxHeight: "260px", overflowY: "auto", borderRadius: "12px", border: "1px solid #1e293b" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead style={{ position: "sticky", top: 0, background: "#020617", zIndex: 1 }}>
                  <tr>
                    <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #1e293b", color: "#9ca3af", fontWeight: 500 }}>
                      Started
                    </th>
                    <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #1e293b", color: "#9ca3af", fontWeight: 500 }}>
                      Status
                    </th>
                    <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #1e293b", color: "#9ca3af", fontWeight: 500 }}>
                      Links
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
                          setSelectedRunId(run.id);
                          selectedRunIdRef.current = run.id;

                          if (isInProgress(run.status)) {
                            setActiveRunId(run.id);
                            activeRunIdRef.current = run.id;
                            startPolling();
                            void refreshSelectedRun(run.id);
                          } else {
                            setActiveRunId(null);
                            activeRunIdRef.current = null;
                            void loadResults(run.id);
                          }
                        }}
                        style={{ cursor: "pointer", background: isSelected ? "#0f172a" : "transparent" }}
                      >
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid #0f172a" }}>{formatDate(run.started_at)}</td>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid #0f172a" }}>{run.status}</td>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid #0f172a", textAlign: "right" }}>
                          {run.broken_links} broken ({brokenPct})
                        </td>
                      </tr>
                    );
                  })}

                  {history.length === 0 && !historyLoading && (
                    <tr>
                      <td colSpan={3} style={{ padding: "10px", textAlign: "center", color: "#6b7280" }}>
                        No scans yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ background: "#020617", borderRadius: "16px", padding: "16px", border: "1px solid #1e293b" }}>
            <h2 style={{ marginTop: 0, marginBottom: "12px", fontSize: "18px" }}>Broken links in selected scan</h2>

            {resultsLoading && <p>Loading results...</p>}
            {resultsError && <p style={{ color: "#f97316", fontSize: "13px" }}>{resultsError}</p>}
            {!resultsLoading && brokenResults.length === 0 && (
              <p style={{ fontSize: "14px", color: "#9ca3af" }}>
                {isSelectedRunInProgress ? "Scan still running…" : "No broken links in this scan."}
              </p>
            )}

            <div style={{ maxHeight: "260px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
              {brokenResults.map((row) => (
                <div key={row.id} style={{ padding: "8px 10px", borderRadius: "10px", border: "1px solid #7f1d1d", background: "#111827" }}>
                  <div style={{ fontSize: "13px", color: "#fca5a5", marginBottom: "4px" }}>{row.link_url}</div>
                  <div style={{ fontSize: "12px", color: "#9ca3af" }}>
                    status {row.status_code ?? "null"} · {row.classification}
                    {row.error_message ? ` · ${row.error_message}` : ""}
                  </div>
                  <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>source: {row.source_page}</div>
                </div>
              ))}
            </div>
            {resultsHasMore && (
              <button
                onClick={() => selectedRunId && loadMoreResults(selectedRunId)}
                disabled={resultsLoading}
                style={{
                  marginTop: "12px",
                  padding: "8px 16px",
                  background: "#dc2626",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  cursor: resultsLoading ? "default" : "pointer",
                  opacity: resultsLoading ? 0.6 : 1,
                  fontSize: "13px",
                  fontWeight: "500",
                }}
              >
                {resultsLoading ? "Loading..." : "Load More"}
              </button>
            )}
          </div>

          <div style={{ background: "#020617", borderRadius: "16px", padding: "16px", border: "1px solid #1e293b" }}>
            <h2 style={{ marginTop: 0, marginBottom: "12px", fontSize: "18px" }}>Blocked links in selected scan</h2>

            {!resultsLoading && blockedResults.length === 0 && (
              <p style={{ fontSize: "14px", color: "#9ca3af" }}>
                {isSelectedRunInProgress ? "Scan still running…" : "No blocked links in this scan."}
              </p>
            )}

            <div style={{ maxHeight: "260px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
              {blockedResults.map((row) => (
                <div key={row.id} style={{ padding: "8px 10px", borderRadius: "10px", border: "1px solid #854d0e", background: "#111827" }}>
                  <div style={{ fontSize: "13px", color: "#fdba74", marginBottom: "4px" }}>{row.link_url}</div>
                  <div style={{ fontSize: "12px", color: "#9ca3af" }}>
                    status {row.status_code ?? "null"} · {row.classification}
                    {row.error_message ? ` · ${row.error_message}` : ""}
                  </div>
                  <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>source: {row.source_page}</div>
                </div>
              ))}
            </div>
            {resultsHasMore && (
              <button
                onClick={() => selectedRunId && loadMoreResults(selectedRunId)}
                disabled={resultsLoading}
                style={{
                  marginTop: "12px",
                  padding: "8px 16px",
                  background: "#b45309",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  cursor: resultsLoading ? "default" : "pointer",
                  opacity: resultsLoading ? 0.6 : 1,
                  fontSize: "13px",
                  fontWeight: "500",
                }}
              >
                {resultsLoading ? "Loading..." : "Load More"}
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default App;
