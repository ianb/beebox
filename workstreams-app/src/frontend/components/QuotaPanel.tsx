import { compactDuration, friendlyTimestamp, quotaPace, quotaSummaryText, quotaWindowsForDisplay } from "../lib/format.js";
import { useState } from "react";
import type { Quota } from "../types.js";

/** One lane of the race: a runner at its percent, its trail behind it. */
function Lane({ percent, tone, ariaLabel }: { percent: number; tone: string; ariaLabel: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return <div className={`race-lane ${tone}`} role="meter" aria-label={ariaLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped)}>
    <span className="race-trail" style={{ width: `${clamped}%` }} />
    <span className="race-runner" style={{ left: `${clamped}%` }} />
  </div>;
}

/** Quota and time race on two lanes toward a finish line at the reset. */
function Race({ label, usedPercent, elapsedPercent, over }: { label: string; usedPercent: number; elapsedPercent: number | null; over: boolean }) {
  return <div className="race">
    <div className="race-grid" aria-hidden="true">
      <span>Quota</span>
      {elapsedPercent === null ? null : <span>Time</span>}
    </div>
    <div className="race-track">
      <Lane percent={usedPercent} tone={over ? "race-over" : "race-ok"} ariaLabel={`${label} quota used`} />
      {elapsedPercent === null ? null : <Lane percent={elapsedPercent} tone="race-time" ariaLabel={`${label} time elapsed`} />}
      <span className="race-finish" aria-hidden="true" />
    </div>
    <div className="race-results">
      <span className={over ? "pace-over" : "pace-on-track"}>{Math.round(usedPercent)}%</span>
      {elapsedPercent === null ? null : <span className="race-time-result">{Math.round(elapsedPercent)}%</span>}
    </div>
  </div>;
}

/** Quota used races time elapsed: when the quota bar is ahead of the time bar, usage is over pace. */
function Window({ window }: { window: Quota["windows"][number] }) {
  const now = new Date();
  const pace = quotaPace(window, now);
  const expired = new Date(window.resetsAt).getTime() <= now.getTime();
  return <section className="quota-window">
    <strong>{window.label}</strong>
    {expired ? <p className="muted">Expired snapshot · awaiting a fresh quota update.</p> : <>
      <Race label={window.label} usedPercent={window.usedPercent} elapsedPercent={pace ? pace.expected : null} over={pace !== null && !pace.onTrack} />
      <p className="quota-reset">Resets {new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(window.resetsAt))}</p>
      {pace?.earlyMs ? <p className="pace-over">At this rate, quota reached {compactDuration(pace.earlyMs)} before reset</p> : null}
    </>}
  </section>;
}

export function QuotaPanel({ quotas, error }: { quotas: Quota[]; error?: string | undefined }) {
  const [open, setOpen] = useState(false);
  const summary = error ? "unavailable" : quotas.map((quota) => {
    if (quota.status !== "available") return `${quota.provider} unavailable`;
    return `${quota.provider} ${quotaSummaryText(quota)}`;
  }).join(" · ");
  return <details className="quota-popover" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary>Quotas{summary ? ` · ${summary}` : ""}</summary><button type="button" className="quota-backdrop" aria-label="Close quotas" onClick={() => setOpen(false)} /><div className="quota-panel" role="region" aria-label="Agent capacity">
    {error ? <p>{error}</p> : quotas.map((quota) => <article className="quota-card" key={quota.provider}><h2>{quota.provider === "claude" ? "Claude account" : quota.provider === "codex" ? "Codex" : "GLM (Z.ai)"}</h2>{quota.status === "available" ? quotaWindowsForDisplay(quota).map((window) => <Window key={window.label} window={window} />) : <p>{quota.message ?? "Quota unavailable."}</p>}{quota.credits ? <p className="muted">Credits: {quota.credits.unlimited ? "unlimited" : quota.credits.balance ?? "unavailable"}</p> : null}<p className="muted">{quota.stale ? "Stale · " : ""}Updated {friendlyTimestamp(quota.fetchedAt)}</p></article>)}
  </div></details>;
}
