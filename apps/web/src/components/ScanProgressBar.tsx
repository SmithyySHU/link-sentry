import React, { useEffect, useMemo, useState } from "react";

type ScanProgressProps = {
  status: "in_progress" | "completed" | "failed" | "cancelled";
  totalLinks: number;
  checkedLinks: number;
  brokenLinks: number;
  blockedLinks: number;
  noResponseLinks: number;
  lastUpdateAt: number | null;
};

function formatRelativeTime(timestamp: number | null, now: number) {
  if (!timestamp) return "-";
  const diffMs = Math.max(0, now - timestamp);
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  return `${diffHr}h ago`;
}

export const ScanProgressBar: React.FC<ScanProgressProps> = ({
  status,
  totalLinks,
  checkedLinks,
  brokenLinks,
  blockedLinks,
  noResponseLinks,
  lastUpdateAt,
}) => {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (status !== "in_progress") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  const mode = totalLinks > 0 ? "determinate" : "indeterminate";
  const percent = useMemo(() => {
    if (totalLinks <= 0) return 0;
    const value = (checkedLinks / totalLinks) * 100;
    const clamped = Math.min(100, Math.max(0, value));
    if (status === "completed") return 100;
    return clamped;
  }, [checkedLinks, status, totalLinks]);

  const stateClass =
    status === "completed"
      ? "completed"
      : status === "failed" || status === "cancelled"
        ? "stopped"
        : "running";
  const title =
    status === "completed"
      ? "Scan completed"
      : status === "failed" || status === "cancelled"
        ? "Scan stopped"
        : "Scanning…";

  return (
    <div className={`scan-progress ${stateClass}`}>
      <div className="scan-progress__header">
        <div>
          <div className="scan-progress__title">{title}</div>
          <div className="scan-progress__subtitle">
            <span>
              Checked {checkedLinks} / {totalLinks || "?"}
            </span>
            <span>Broken {brokenLinks}</span>
            <span>Blocked {blockedLinks}</span>
            <span>Timed out {noResponseLinks}</span>
            <span>Last updated {formatRelativeTime(lastUpdateAt, now)}</span>
          </div>
        </div>
        {status === "completed" ? (
          <div className="scan-progress__state scan-progress__state--complete">
            <span className="scan-progress__check">✓</span>
            <span>Completed</span>
          </div>
        ) : status === "failed" || status === "cancelled" ? (
          <div className="scan-progress__state scan-progress__state--stopped">
            <span>Stopped</span>
          </div>
        ) : mode === "determinate" ? (
          <div className="scan-progress__percent">{percent.toFixed(0)}%</div>
        ) : null}
      </div>
      <div className={`scan-progress__track ${mode}`}>
        <div
          className="scan-progress__fill"
          style={mode === "determinate" ? { width: `${percent}%` } : undefined}
        />
      </div>
      {mode === "indeterminate" && status === "in_progress" && (
        <div className="scan-progress__hint">Discovering links…</div>
      )}
    </div>
  );
};
