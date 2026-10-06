/**
 * The words on the page nginx serves while a production deploy has the hub
 * stopped (`deploy/nginx/beebox.conf`, `src/scripts/build-deploy-page.ts`).
 *
 * The page is unauthenticated, so it states only when the update started and
 * how long updates usually take — never a commit, ref, or anything else that
 * identifies the change (boxholder decision, 2026-09-18; see
 * `docs/plans/deploy-maintenance-page.md`). It must also stay honest when a
 * deploy overruns or dies: past OVERRUN_MS it stops promising a quick return,
 * and past PROBABLY_FAILED_MS it says something has likely gone wrong.
 */

export const OVERRUN_MS = 10 * 60_000;
export const PROBABLY_FAILED_MS = 60 * 60_000;

export interface DeployPageInput {
  startedMs: number;
  nowMs: number;
  /** Median of recent deploy windows; null when none is recorded yet. */
  typicalSeconds: number | null;
  /** The start time already formatted for the reader, e.g. "9:41 PM". */
  startedLabel: string;
}

export interface DeployPageText {
  headline: string;
  detail: string;
}

export function deployPageText({ startedMs, nowMs, typicalSeconds, startedLabel }: DeployPageInput): DeployPageText {
  const elapsedMs = Math.max(0, nowMs - startedMs);
  const typical = typicalSeconds === null
    ? "a few minutes"
    : `about ${plural(Math.max(1, Math.ceil(typicalSeconds / 60)), "minute")}`;
  if (elapsedMs >= PROBABLY_FAILED_MS) {
    return {
      headline: "This site is down",
      detail: `An update started at ${startedLabel}, ${ago(elapsedMs)}, and has not finished. Updates normally take ${typical}, so something has probably gone wrong.`,
    };
  }
  if (elapsedMs >= OVERRUN_MS) {
    return {
      headline: "This update is taking longer than usual",
      detail: `It started at ${startedLabel}, ${ago(elapsedMs)}. Updates usually take ${typical}. This page reloads when the site is back.`,
    };
  }
  return {
    headline: "This site is updating",
    detail: `The update started at ${startedLabel}, ${ago(elapsedMs)}. Updates usually take ${typical}. This page reloads when the site is back.`,
  };
}

/**
 * Seconds while the update could still be running normally, so the page
 * visibly counts; the browser re-renders every second. Past an hour the
 * seconds are noise.
 */
function ago(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalSeconds < 1) return "just now";
  if (minutes < 1) return `${plural(seconds, "second")} ago`;
  if (minutes < 60) return seconds === 0 ? `${plural(minutes, "minute")} ago` : `${plural(minutes, "minute")} ${plural(seconds, "second")} ago`;
  if (minutes < 120) return `${plural(minutes, "minute")} ago`;
  return `${plural(Math.floor(minutes / 60), "hour")} ago`;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}
