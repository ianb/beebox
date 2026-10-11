import { compactDuration, friendlyTimestamp, quotaPace, quotaSummaryText, quotaWindowsForDisplay } from "../lib/format.js";
import { useState } from "react";
import type { Quota } from "../types.js";

/** One race track: a filled bar with its percent at the end. */
function Track({ label, percent, tone, ariaLabel }: { label: string; percent: number; tone: string; ariaLabel: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return <div className="quota-track">
    <span className="quota-track-label">{label}</span>
    <span className="quota-track-bar" role="meter" aria-label={ariaLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped)}><span className={`quota-track-fill ${tone}`} style={{ width: `${clamped}%` }} /></span>
    <span className="quota-track-percent">{Math.round(percent)}%</span>
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
      <Track label="Quota" percent={window.usedPercent} tone={pace && !pace.onTrack ? "pace-over-fill" : "pace-on-track-fill"} ariaLabel={`${window.label} quota used`} />
      {pace ? <Track label="Time" percent={pace.expected} tone="time-fill" ariaLabel={`${window.label} time elapsed`} /> : null}
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
