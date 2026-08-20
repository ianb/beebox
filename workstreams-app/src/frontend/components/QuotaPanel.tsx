import { compactDuration, friendlyTimestamp, quotaPace, quotaSummaryText, quotaWindowsForDisplay } from "../lib/format.js";
import { useState } from "react";
import type { Quota } from "../types.js";

function Window({ window }: { window: Quota["windows"][number] }) {
  const now = new Date();
  const pace = quotaPace(window, now);
  const expired = new Date(window.resetsAt).getTime() <= now.getTime();
  return <section className="quota-window">
    <strong>{window.label}</strong>
    {expired ? <p className="muted">Expired snapshot · awaiting a fresh quota update.</p> : <>
      <p>{Math.round(window.usedPercent)}% used</p>
      <progress max="100" value={Math.max(0, Math.min(100, window.usedPercent))} aria-label={`${window.label} usage`} />
      {pace ? <p className={pace.onTrack ? "pace-on-track" : "pace-over"}>{pace.onTrack ? "On track" : "Over pace"} · {Math.round(Math.abs(pace.difference))} points {pace.onTrack ? "under" : "over"} budget ({Math.round(pace.expected)}% of window elapsed)</p> : <p className="muted">Pace unavailable for this window.</p>}
      {pace?.earlyMs ? <p className="pace-over">At this rate, quota reached {compactDuration(pace.earlyMs)} before reset</p> : null}
      <p className="muted">Resets {friendlyTimestamp(window.resetsAt, now)}</p>
    </>}
  </section>;
}

export function QuotaPanel({ quotas }: { quotas: Quota[] }) {
  const [open, setOpen] = useState(false);
  const summary = quotas.map((quota) => {
    if (quota.status !== "available") return `${quota.provider} unavailable`;
    return `${quota.provider} ${quotaSummaryText(quota)}`;
  }).join(" · ");
  return <details className="quota-popover" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary>Quotas{summary ? ` · ${summary}` : ""}</summary><button type="button" className="quota-backdrop" aria-label="Close quotas" onClick={() => setOpen(false)} /><div className="quota-panel" role="region" aria-label="Agent capacity">
    {quotas.map((quota) => <article className="quota-card" key={quota.provider}><h2>{quota.provider === "claude" ? "Claude account" : "Codex"}</h2>{quota.status === "available" ? quotaWindowsForDisplay(quota).map((window) => <Window key={window.label} window={window} />) : <p>{quota.message ?? "Quota unavailable."}</p>}{quota.credits ? <p className="muted">Credits: {quota.credits.unlimited ? "unlimited" : quota.credits.balance ?? "unavailable"}</p> : null}<p className="muted">{quota.stale ? "Stale · " : ""}Updated {friendlyTimestamp(quota.fetchedAt)}</p></article>)}
  </div></details>;
}
