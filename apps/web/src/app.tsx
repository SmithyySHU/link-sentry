import React, { useEffect, useMemo, useState } from "react";

const API_BASE = "http://localhost:3001";

type ScanStatus = "in_progress" | "completed" | "failed";

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

interface ScanHistoryResponse {
    siteId: string;
    count: number;
    scans: ScanRunSummary[];
}

interface ScanResultsResponse {
    scanRunId: string;
    count: number;
    results: ScanResultRow[];
}

const DEFAULT_SITE_ID = "85efa142-35dc-4b06-93ee-fb7180ab28fd";
const DEFAULT_START_URL = "https://twiddlefood.co.uk";

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
    const [siteId, setSiteId] = useState<string>(DEFAULT_SITE_ID);
    const [startUrl, setStartUrl] = useState<string>(DEFAULT_START_URL);

    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [history, setHistory] = useState<ScanRunSummary[]>([]);

    const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
    const [resultsLoading, setResultsLoading] = useState(false);
    const [resultsError, setResultsError] = useState<string | null>(null);
    const [results, setResults] = useState<ScanResultRow[]>([]);

    const [triggeringScan, setTriggeringScan] = useState(false);
    const [triggerError, setTriggerError] = useState<string | null>(null);

    const latestScan = useMemo(
        () => (history.length > 0 ? history[0] : null),
        [history]
    );

    useEffect(() => {
        loadHistory();
    }, []);

    async function loadHistory() {
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
                setSelectedRunId(data.scans[0].id);
                await loadResults(data.scans[0].id);
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

    async function handleRunScan() {
        setTriggeringScan(true);
        setTriggerError(null);
        try {
            const res = await fetch(
                `${API_BASE}/sites/${encodeURIComponent(siteId)}/scans`,
            {
                method: "POST",
                headers: {
                "content-type": "application/json"
            },
            body: JSON.stringify({ startUrl })
            }
        );

            if (!res.ok) {
                const text = await res.text().catch(() => "");
                throw new Error(
                    `Scan trigger failed: ${res.status} ${text ? "- " + text : ""}`
                );
            }
            const data = await res.json();
            await loadHistory();
            if (data.scanRunId) {
                await loadResults(data.scanRunId);
            }
        } catch (err: any) {
            setTriggerError(err?.message ?? "Failed to start scan");
        } finally {
            setTriggeringScan(false);
        }
    }

    const brokenResults = useMemo(
        () => results.filter((r) => r.classification === "broken"),
        [results]
    );

    return (
        <div
            style={{
                minHeight: "100vh",
                background: "#0f172a",
                color: "#e5e7eb",
                padding: "24px"
            }}
        >
            <div
                style={{
                    maxWidth: "1100px",
                    margin: "0 auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: "24px"
                }}
            >
                <header
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        gap: "12px"
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
                            color: "#9ca3af"
                        }}
                    >
                        api: http://localhost:3001
                    </span>
                </header>

                <section
                    style={{
                        display: "grid",
                        gridTemplateColumns: "2fr 3fr",
                        gap: "16px",
                        alignItems: "flex-start"
                    }}
                >
                    <div
                        style={{
                            background: "#020617",
                            borderRadius: "16px",
                            padding: "16px",
                            border: "1px solid #1e293b"
                        }}
                    >
                        <h2 style={{ marginTop: 0, marginBottom: "12px", fontSize: "18px" }}>
                            Site configuration
                        </h2>
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                            <label style={{ fontSize: "14px" }}>
                                Site ID
                                <input
                                    value={siteId}
                                    onChange={(e) => setSiteId(e.target.value)}
                                    style={{
                                        marginTop: "4px",
                                        width: "100%",
                                        padding: "6px 8px",
                                        borderRadius: "8px",
                                        border: "1px solid #334155",
                                        background: "#020617",
                                        color: "#e5e7eb"
                                    }}
                                />
                            </label>
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
                                        color: "#e5e7eb"
                                    }}
                                />
                            </label>
                            <button
                                onClick={handleRunScan}
                                disabled={triggeringScan || !siteId || !startUrl}
                                style={{
                                    marginTop: "8px",
                                    padding: "8px 12px",
                                    borderRadius: "999px",
                                    border: "none",
                                    background: triggeringScan ? "#4b5563" : "#22c55e",
                                    color: "#020617",
                                    fontWeight: 600,
                                    cursor:
                                        triggeringScan || !siteId || !startUrl
                                            ? "not-allowed"
                                            : "pointer"
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
                    </div>

                    <div
                        style={{
                            background: "#020617",
                            borderRadius: "16px",
                            padding: "16px",
                            border: "1px solid #1e293b"
                        }}
                    >
                        <h2 style={{ marginTop: 0, marginBottom: "12px", fontSize: "18px" }}>
                            Latest scan
                        </h2>
                        {historyLoading && <p>Loading history...</p>}
                        {historyError && (
                            <p style={{ color: "#f97316", fontSize: "13px" }}>
                                {historyError}
                            </p>
                        )}
                        {!historyLoading && !latestScan && !historyError && (
                            <p style={{ fontSize: "14px", color: "#9ca3af" }}>
                                No scans found for this site yet.
                            </p>
                        )}
                        {latestScan && (
                            <div style={{ display: "grid", gap: "6px", fontSize: "14px" }}>
                                <div>
                                    <span style={{ color: "#9ca3af" }}>Run ID</span>
                                    <div style={{ fontFamily: "monospace" }}>{latestScan.id}</div>
                                </div>
                                <div>
                                    <span style={{ color: "#9ca3af" }}>Status</span>
                                    <div>{latestScan.status}</div>
                                </div>
                                <div>
                                    <span style={{ color: "#9ca3af" }}>Started</span>
                                    <div>{formatDate(latestScan.started_at)}</div>
                                </div>
                                <div>
                                    <span style={{ color: "#9ca3af" }}>Finished</span>
                                    <div>
                                        {latestScan.finished_at
                                            ? formatDate(latestScan.finished_at)
                                            : "in progress"}
                                    </div>
                                </div>
                                <div>
                                    <span style={{ color: "#9ca3af" }}>Links</span>
                                    <div>
                                        total {latestScan.total_links}, checked{" "}
                                        {latestScan.checked_links}, broken{" "}
                                        {latestScan.broken_links} (
                                        {percentBroken(
                                            latestScan.checked_links || latestScan.total_links,
                                            latestScan.broken_links
                                        )}
                                        )
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </section>

                <section
                    style={{
                        display: "grid",
                        gridTemplateColumns: "1.7fr 2.3fr",
                        gap: "16px",
                        alignItems: "flex-start"
                    }}
                >
                    <div
                        style={{
                            background: "#020617",
                            borderRadius: "16px",
                            padding: "16px",
                            border: "1px solid #1e293b",
                            overflow: "hidden"
                        }}
                    >
                        <h2 style={{ marginTop: 0, marginBottom: "12px", fontSize: "18px" }}>
                            Recent scans
                        </h2>
                        <div
                            style={{
                                maxHeight: "260px",
                                overflowY: "auto",
                                borderRadius: "12px",
                                border: "1px solid #1e293b"
                            }}
                        >
                            <table
                                style={{
                                    width: "100%",
                                    borderCollapse: "collapse",
                                    fontSize: "13px"
                                }}
                            >
                                <thead
                                    style={{
                                        position: "sticky",
                                        top: 0,
                                        background: "#020617",
                                        zIndex: 1
                                    }}
                                >
                                    <tr>
                                        <th
                                            style={{
                                                textAlign: "left",
                                                padding: "6px 8px",
                                                borderBottom: "1px solid #1e293b",
                                                color: "#9ca3af",
                                                fontWeight: 500
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
                                                fontWeight: 500
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
                                                fontWeight: 500
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
                                                onClick={() => loadResults(run.id)}
                                                style={{
                                                    cursor: "pointer",
                                                    background: isSelected ? "#0f172a" : "transparent"
                                                }}
                                            >
                                                <td
                                                    style={{
                                                        padding: "6px 8px",
                                                        borderBottom: "1px solid #0f172a"
                                                    }}
                                                >
                                                    {formatDate(run.started_at)}
                                                </td>
                                                <td
                                                    style={{
                                                        padding: "6px 8px",
                                                        borderBottom: "1px solid #0f172a"
                                                    }}
                                                >
                                                    {run.status}
                                                </td>
                                                <td
                                                    style={{
                                                        padding: "6px 8px",
                                                        borderBottom: "1px solid #0f172a",
                                                        textAlign: "right"
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
                                                    color: "#6b7280"
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

                    <div
                        style={{
                            background: "#020617",
                            borderRadius: "16px",
                            padding: "16px",
                            border: "1px solid #1e293b"
                        }}
                    >
                        <h2 style={{ marginTop: 0, marginBottom: "12px", fontSize: "18px" }}>
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
                                gap: "8px"
                            }}
                        >
                            {brokenResults.map((row) => (
                                <div
                                    key={row.id}
                                    style={{
                                        padding: "8px 10px",
                                        borderRadius: "10px",
                                        border: "1px solid #7f1d1d",
                                        background: "#111827"
                                    }}
                                >
                                    <div
                                        style={{
                                            fontSize: "13px",
                                            color: "#fca5a5",
                                            marginBottom: "4px"
                                        }}
                                    >
                                        {row.link_url}
                                    </div>
                                    <div style={{ fontSize: "12px", color: "#9ca3af" }}>
                                        status {row.status_code ?? "null"} · {row.classification}
                                        {row.error_message ? ` · ${row.error_message}` : ""}
                                    </div>
                                    <div
                                        style={{
                                            fontSize: "11px",
                                            color: "#6b7280",
                                            marginTop: "2px"
                                        }}
                                    >
                                        source: {row.source_page}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default App;
