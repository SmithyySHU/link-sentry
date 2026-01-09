import React, { useEffect, useMemo, useState } from "react";

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

const App: React.FC = () => {
  // Sites
  const [sites, setSites] = useState<Site[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);

  // Scan history for selected site
  const [history, setHistory] = useState<ScanRunSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Results for selected scan
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [results, setResults] = useState<ScanResultRow[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);

  // Scan trigger
  const [startUrl, setStartUrl] = useState("");
  const [triggeringScan, setTriggeringScan] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const selectedRun = useMemo(() => {
    if (selectedRunId) {
      const found = history.find((r) => r.id === selectedRunId);
      if (found) return found;
    }
    return history.length > 0 ? history[0] : null;
  }, [history, selectedRunId]);

  useEffect(() => {
    loadSites();
  }, []);

  async function loadSites() {
    setSitesLoading(true);
    setSitesError(null);
    try {
      const res = await fetch(`${API_BASE}/sites`);
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }

      const data: SitesResponse = await res.json();
      setSites(data.sites);

      if (data.sites.length > 0) {
        const first = data.sites[0];
        setSelectedSiteId(first.id);
        setStartUrl(first.url);
        await loadHistory(first.id);
      } else {
        setSelectedSiteId(null);
        setHistory([]);
        setSelectedRunId(null);
        setResults([]);
      }
    } catch (err: any) {
      setSitesError(err?.message ?? "Failed to load sites");
    } finally {
      setSitesLoading(false);
    }
  }

  async function loadHistory(siteId: string) {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(
        `${API_BASE}/sites/${encodeURIComponent(siteId)}/scans?limit=10`
      );
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }

      const data: ScanHistoryResponse = await res.json();
      setHistory(data.scans);

      if (data.scans.length > 0) {
        const firstRun = data.scans[0];
        setSelectedRunId(firstRun.id);
        await loadResults(firstRun.id);
      } else {
        setSelectedRunId(null);
        setResults([]);
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
    try {
      const res = await fetch(
        `${API_BASE}/scan-runs/${encodeURIComponent(runId)}/results?limit=200`
      );
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      const data: ScanResultsResponse = await res.json();
      setResults(data.results);
      setSelectedRunId(runId);
    } catch (err: any) {
      setResultsError(err?.message ?? "Failed to load scan results");
    } finally {
      setResultsLoading(false);
    }
  }

  async function handleSelectSite(site: Site) {
    if (site.id === selectedSiteId) return;
    setSelectedSiteId(site.id);
    setStartUrl(site.url);
    await loadHistory(site.id);
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
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ startUrl }),
        }
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Scan trigger failed: ${res.status}${
            text ? ` - ${text.slice(0, 200)}` : ""
          }`
        );
      }

      const data = await res.json();
      await loadHistory(selectedSiteId);
      if (data.scanRunId) {
        await loadResults(data.scanRunId);
      }
    } catch (err: any) {
      setTriggerError(err?.message ?? "Failed to start scan");
    } finally {
      setTriggeringScan(false);
    }
  }

  async function handleDeleteSite(site: Site) {
    const ok = window.confirm(
      `Delete site "${site.url}" and all its scans? This cannot be undone.`
    );
    if (!ok) return;

    try {
      const res = await fetch(
        `${API_BASE}/sites/${encodeURIComponent(site.id)}`,
        {
          method: "DELETE",
        }
      );

      if (!res.ok && res.status !== 404) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Delete failed: ${res.status}${
            text ? ` - ${text.slice(0, 200)}` : ""
          }`
        );
      }

      const remaining = sites.filter((s) => s.id !== site.id);
      setSites(remaining);

      if (selectedSiteId === site.id) {
        if (remaining.length > 0) {
          const next = remaining[0];
          setSelectedSiteId(next.id);
          setStartUrl(next.url);
          await loadHistory(next.id);
        } else {
          setSelectedSiteId(null);
          setStartUrl("");
          setHistory([]);
          setSelectedRunId(null);
          setResults([]);
        }
      }
    } catch (err: any) {
      alert(err?.message ?? "Failed to delete site");
    }
  }

  const brokenResults = useMemo(
    () => results.filter((r) => r.classification === "broken"),
    [results]
  );

  const hasSites = sites.length > 0;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0f172a",
        color: "#e5e7eb",
        padding: "24px",
      }}
    >
      <div
        style={{
          maxWidth: "1100px",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: "24px",
        }}
      >
        {/* Header */}
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: "12px",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: "28px" }}>Link-Sentry</h1>
            <p style={{ margin: 0, color: "#9ca3af" }}>
              Internal dev dashboard
            </p>
          </div>
          <span
            style={{
              fontSize: "12px",
              padding: "4px 10px",
              borderRadius: "999px",
              background: "#1e293b",
              color: "#9ca3af",
            }}
          >
            api: http://localhost:3001
          </span>
        </header>

        {/* Empty state when there are no sites */}
        {!hasSites && !sitesLoading && (
          <div
            style={{
              background: "#020617",
              borderRadius: "16px",
              padding: "24px",
              border: "1px solid #1e293b",
              textAlign: "center",
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: "8px", fontSize: "18px" }}>
              No sites yet
            </h2>
            <p style={{ margin: 0, color: "#9ca3af", fontSize: "14px" }}>
              Use the API to create a site, then it will appear here for
              scanning.
            </p>
          </div>
        )}

        {sitesLoading && (
          <p style={{ fontSize: "14px" }}>Loading sites...</p>
        )}
        {sitesError && (
          <p style={{ color: "#f97316", fontSize: "13px" }}>{sitesError}</p>
        )}

        {/* Only show main panels when we actually have at least one site */}
        {hasSites && (
          <>
            {/* Top section: sites + config + selected scan */}
            <section
              style={{
                display: "grid",
                gridTemplateColumns: "1.5fr 1.8fr 2fr",
                gap: "16px",
                alignItems: "flex-start",
              }}
            >
              {/* Sites list */}
              <div
                style={{
                  background: "#020617",
                  borderRadius: "16px",
                  padding: "16px",
                  border: "1px solid #1e293b",
                }}
              >
                <h2
                  style={{
                    marginTop: 0,
                    marginBottom: "12px",
                    fontSize: "18px",
                  }}
                >
                  Sites
                </h2>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    maxHeight: "260px",
                    overflowY: "auto",
                  }}
                >
                  {sites.map((site) => {
                    const isSelected = site.id === selectedSiteId;
                    return (
                      <div
                        key={site.id}
                        style={{
                          display: "flex",
                          alignItems: "stretch",
                          gap: "8px",
                        }}
                      >
                        <button
                          onClick={() => handleSelectSite(site)}
                          style={{
                            flex: 1,
                            textAlign: "left",
                            borderRadius: "12px",
                            border: "1px solid #1e293b",
                            padding: "8px 10px",
                            background: isSelected ? "#111827" : "#020617",
                            color: "#e5e7eb",
                            cursor: "pointer",
                          }}
                        >
                          <div
                            style={{ fontSize: "14px", fontWeight: 500 }}
                          >
                            {site.url}
                          </div>
                          <div
                            style={{
                              fontSize: "11px",
                              color: "#9ca3af",
                              marginTop: "2px",
                            }}
                          >
                            created {formatDate(site.created_at)}
                          </div>
                        </button>
                        <button
                          onClick={() => handleDeleteSite(site)}
                          style={{
                            borderRadius: "12px",
                            border: "1px solid #7f1d1d",
                            background: "#111827",
                            color: "#fecaca",
                            padding: "0 10px",
                            cursor: "pointer",
                          }}
                          title="Delete site"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Site configuration */}
              <div
                style={{
                  background: "#020617",
                  borderRadius: "16px",
                  padding: "16px",
                  border: "1px solid #1e293b",
                }}
              >
                <h2
                  style={{
                    marginTop: 0,
                    marginBottom: "12px",
                    fontSize: "18px",
                  }}
                >
                  Site configuration
                </h2>
                {!selectedSiteId && (
                  <p style={{ fontSize: "14px", color: "#9ca3af" }}>
                    Select a site from the list to configure and scan.
                  </p>
                )}
                {selectedSiteId && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
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
                        }}
                      />
                    </label>
                    <button
                      onClick={handleRunScan}
                      disabled={
                        triggeringScan || !selectedSiteId || !startUrl.trim()
                      }
                      style={{
                        marginTop: "8px",
                        padding: "8px 12px",
                        borderRadius: "999px",
                        border: "none",
                        background: triggeringScan ? "#4b5563" : "#22c55e",
                        color: "#020617",
                        fontWeight: 600,
                        cursor:
                          triggeringScan ||
                          !selectedSiteId ||
                          !startUrl.trim()
                            ? "not-allowed"
                            : "pointer",
                      }}
                    >
                      {triggeringScan ? "Running scan..." : "Run new scan"}
                    </button>
                    {triggerError && (
                      <p style={{ color: "#f97316", fontSize: "13px" }}>
                        {triggerError}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Selected scan */}
              <div
                style={{
                  background: "#020617",
                  borderRadius: "16px",
                  padding: "16px",
                  border: "1px solid #1e293b",
                }}
              >
                <h2
                  style={{
                    marginTop: 0,
                    marginBottom: "12px",
                    fontSize: "18px",
                  }}
                >
                  Selected scan
                </h2>
                {historyLoading && <p>Loading history...</p>}
                {historyError && (
                  <p style={{ color: "#f97316", fontSize: "13px" }}>
                    {historyError}
                  </p>
                )}
                {!historyLoading && !selectedRun && !historyError && (
                  <p style={{ fontSize: "14px", color: "#9ca3af" }}>
                    No scans found for this site yet.
                  </p>
                )}
                {selectedRun && (
                  <div
                    style={{
                      display: "grid",
                      gap: "6px",
                      fontSize: "14px",
                    }}
                  >
                    <div>
                      <span style={{ color: "#9ca3af" }}>Run ID</span>
                      <div style={{ fontFamily: "monospace" }}>
                        {selectedRun.id}
                      </div>
                    </div>
                    <div>
                      <span style={{ color: "#9ca3af" }}>Status</span>
                      <div>{selectedRun.status}</div>
                    </div>
                    <div>
                      <span style={{ color: "#9ca3af" }}>Started</span>
                      <div>{formatDate(selectedRun.started_at)}</div>
                    </div>
                    <div>
                      <span style={{ color: "#9ca3af" }}>Finished</span>
                      <div>
                        {selectedRun.finished_at
                          ? formatDate(selectedRun.finished_at)
                          : "in progress"}
                      </div>
                    </div>
                    <div>
                      <span style={{ color: "#9ca3af" }}>Links</span>
                      <div>
                        total {selectedRun.total_links}, checked{" "}
                        {selectedRun.checked_links}, broken{" "}
                        {selectedRun.broken_links} (
                        {percentBroken(
                          selectedRun.checked_links ||
                            selectedRun.total_links,
                          selectedRun.broken_links
                        )}
                        )
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Bottom section: recent scans + broken links */}
            <section
              style={{
                display: "grid",
                gridTemplateColumns: "1.7fr 2.3fr",
                gap: "16px",
                alignItems: "flex-start",
              }}
            >
              {/* Recent scans */}
              <div
                style={{
                  background: "#020617",
                  borderRadius: "16px",
                  padding: "16px",
                  border: "1px solid #1e293b",
                  overflow: "hidden",
                }}
              >
                <h2
                  style={{
                    marginTop: 0,
                    marginBottom: "12px",
                    fontSize: "18px",
                  }}
                >
                  Recent scans
                </h2>
                <div
                  style={{
                    maxHeight: "260px",
                    overflowY: "auto",
                    borderRadius: "12px",
                    border: "1px solid #1e293b",
                  }}
                >
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "13px",
                    }}
                  >
                    <thead
                      style={{
                        position: "sticky",
                        top: 0,
                        background: "#020617",
                        zIndex: 1,
                      }}
                    >
                      <tr>
                        <th
                          style={{
                            textAlign: "left",
                            padding: "6px 8px",
                            borderBottom: "1px solid #1e293b",
                            color: "#9ca3af",
                            fontWeight: 500,
                          }}
                        >
                          Started
                        </th>
                        <th
                          style={{
                            textAlign: "left",
                            padding: "6px 8px",
                            borderBottom: "1px solid #1e293b",
                            color: "#9ca3af",
                            fontWeight: 500,
                          }}
                        >
                          Status
                        </th>
                        <th
                          style={{
                            textAlign: "right",
                            padding: "6px 8px",
                            borderBottom: "1px solid #1e293b",
                            color: "#9ca3af",
                            fontWeight: 500,
                          }}
                        >
                          Links
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((run) => {
                        const isSelected = run.id === selectedRunId;
                        const brokenPct = percentBroken(
                          run.checked_links || run.total_links,
                          run.broken_links
                        );
                        return (
                          <tr
                            key={run.id}
                            onClick={() => {
                              setSelectedRunId(run.id);
                              void loadResults(run.id);
                            }}
                            style={{
                              cursor: "pointer",
                              background: isSelected
                                ? "#0f172a"
                                : "transparent",
                            }}
                          >
                            <td
                              style={{
                                padding: "6px 8px",
                                borderBottom: "1px solid #0f172a",
                              }}
                            >
                              {formatDate(run.started_at)}
                            </td>
                            <td
                              style={{
                                padding: "6px 8px",
                                borderBottom: "1px solid #0f172a",
                              }}
                            >
                              {run.status}
                            </td>
                            <td
                              style={{
                                padding: "6px 8px",
                                borderBottom: "1px solid #0f172a",
                                textAlign: "right",
                              }}
                            >
                              {run.broken_links} broken ({brokenPct})
                            </td>
                          </tr>
                        );
                      })}
                      {history.length === 0 && !historyLoading && (
                        <tr>
                          <td
                            colSpan={3}
                            style={{
                              padding: "10px",
                              textAlign: "center",
                              color: "#6b7280",
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

              {/* Broken links */}
              <div
                style={{
                  background: "#020617",
                  borderRadius: "16px",
                  padding: "16px",
                  border: "1px solid #1e293b",
                }}
              >
                <h2
                  style={{
                    marginTop: 0,
                    marginBottom: "12px",
                    fontSize: "18px",
                  }}
                >
                  Broken links in selected scan
                </h2>
                {resultsLoading && <p>Loading results...</p>}
                {resultsError && (
                  <p style={{ color: "#f97316", fontSize: "13px" }}>
                    {resultsError}
                  </p>
                )}
                {!resultsLoading && brokenResults.length === 0 && (
                  <p style={{ fontSize: "14px", color: "#9ca3af" }}>
                    No broken links in this scan.
                  </p>
                )}
                <div
                  style={{
                    maxHeight: "260px",
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  {brokenResults.map((row) => (
                    <div
                      key={row.id}
                      style={{
                        padding: "8px 10px",
                        borderRadius: "10px",
                        border: "1px solid #7f1d1d",
                        background: "#111827",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "13px",
                          color: "#fca5a5",
                          marginBottom: "4px",
                        }}
                      >
                        {row.link_url}
                      </div>
                      <div style={{ fontSize: "12px", color: "#9ca3af" }}>
                        status {row.status_code ?? "null"} ·{" "}
                        {row.classification}
                        {row.error_message ? ` · ${row.error_message}` : ""}
                      </div>
                      <div
                        style={{
                          fontSize: "11px",
                          color: "#6b7280",
                          marginTop: "2px",
                        }}
                      >
                        source: {row.source_page}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default App;
