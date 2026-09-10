// Everything the router renders itself: the worktree index at `/`, the
// failed-startup page, and the workstreams-app fallback. Split out of router.ts,
// which now holds the server and boot sequence only.
//
// Presentation only — nothing here starts, stops, or proxies anything; it reads
// the core's snapshot and the checkout on disk.

import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import { escapeHtml } from "./router-markdown.js";
import { isServing, readyLifecycle, failedLifecycle, type WorktreeHandle, type CapturedError } from "./router-lifecycle.js";
import type { RouterCore } from "./router-core.js";
import type { WorkstreamsAppState } from "./workstreams-app-supervisor.js";
import { IDLE_TIMEOUT_MS, LOG_DIR, ROUTER_PORT, WORKTREES_ROOT, worktreeRoot } from "./router-config.js";

interface DiscoveredWorktree {
  name: string;
  running: boolean;
  handle?: WorktreeHandle;
}

/**
 * Merge the checkouts found on disk with the router's in-memory handles.
 *
 * A handle outlives its checkout: the router keeps its record after a worktree
 * is culled, so a removed workstream kept appearing in the index forever,
 * permanently `failed` because there is nothing left to start. Only merge a
 * core entry the disk scan also saw.
 *
 * `scanned` is false when the disk read itself failed — then there is no disk
 * truth to filter against, so every handle is shown rather than rendering an
 * empty router.
 */
export function mergeDiscovered(params: {
  diskNames: string[];
  coreEntries: [string, WorktreeHandle][];
  /** False when the disk read failed — see above. */
  scanned: boolean;
}): DiscoveredWorktree[] {
  const { diskNames, coreEntries, scanned } = params;
  const all = new Map<string, DiscoveredWorktree>();
  all.set("main", { name: "main", running: false });
  for (const name of diskNames) all.set(name, { name, running: false });
  for (const [name, handle] of coreEntries) {
    const existing = all.get(name);
    if (existing === undefined && scanned) continue;
    all.set(name, { ...(existing ?? { name, running: false }), running: isServing(handle), handle });
  }
  return Array.from(all.values()).toSorted((a, b) =>
    a.name === "main" ? -1 : b.name === "main" ? 1 : a.name.localeCompare(b.name),
  );
}

async function discoverWorktrees(core: RouterCore): Promise<DiscoveredWorktree[]> {
  let diskNames: string[] = [];
  let scanned = false;
  try {
    const entries = await fs.readdir(WORKTREES_ROOT, { withFileTypes: true });
    diskNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    scanned = true;
  } catch (_e) {
    // No worktrees dir yet — fine.
  }
  return mergeDiscovered({ diskNames, coreEntries: core.entries(), scanned });
}

// Best-effort "+ins −del vs main" for the worktree list. Uses the merge-base so
// a worktree that hasn't merged a newer main doesn't count main's own commits as
// deletions; diffs the WORKING TREE (committed + uncommitted) against it, so the
// number reflects the tree's current state. Null on any error or no changes.
async function worktreeDiffStat(name: string): Promise<{ ins: number; del: number } | null> {
  if (name === "main") return null;
  try {
    const cwd = worktreeRoot(name);
    const base = (await execa("git", ["merge-base", "main", "HEAD"], { cwd })).stdout.trim();
    if (!base) return null;
    const { stdout } = await execa("git", ["diff", "--shortstat", base], { cwd });
    const ins = Number(/(\d+) insertion/.exec(stdout)?.[1] ?? "0");
    const del = Number(/(\d+) deletion/.exec(stdout)?.[1] ?? "0");
    return ins === 0 && del === 0 ? null : { ins, del };
  } catch (_e) {
    return null; // best-effort: a non-git worktree or transient git error → no stat
  }
}

export async function renderIndex(core: RouterCore): Promise<string> {
  const list = await discoverWorktrees(core);
  const diffStats = new Map(
    await Promise.all(list.map(async (w) => [w.name, await worktreeDiffStat(w.name)] as const)),
  );
  const rows = list
    .map((w) => {
      const ready = w.handle ? readyLifecycle(w.handle) : null;
      const status =
        w.handle && failedLifecycle(w.handle)
          ? `<span class="badge failed">failed · <a href="/${escapeHtml(w.name)}/">see error</a></span>`
          : ready
            ? `<span class="badge running">running · idle ${Math.round((Date.now() - ready.lastActivity) / 1000)}s</span>`
            : "<span class=\"badge cold\" title=\"will lazy-start on first request\">cold</span>";
      const dashLink = `<a href="/__router/dashboard/${escapeHtml(w.name)}" class="dash" target="_blank" rel="noopener" title="agent-browser dashboard for ${escapeHtml(w.name)} (starts the worktree if cold)">agent-browser ↗</a>`;
      const devLink = `<a href="/${escapeHtml(w.name)}/dev/" class="dash" title="agent-built visualizations &amp; markdown doc browser for ${escapeHtml(w.name)} (served from disk, no start)">dev ↗</a>`;
      const stopForm = w.running
        ? `<form method="POST" action="/__router/stop/${escapeHtml(w.name)}" class="stopForm">
           <button type="submit" title="Tell the router to stop ${escapeHtml(w.name)} now">stop</button>
         </form>`
        : "";
      const diff = diffStats.get(w.name) ?? null;
      const diffCell = diff
        ? `<span class="diffstat" title="changes vs main (committed + uncommitted, since this tree branched)"><span class="ins">+${diff.ins}</span> <span class="del">−${diff.del}</span></span>`
        : "<span class=\"diffstat\"></span>";
      return `
      <li>
        <a href="/${escapeHtml(w.name)}/" class="name">${escapeHtml(w.name)}</a>
        <span class="statuscell">${status}</span>
        ${diffCell}
        <div class="actions">${dashLink}${devLink}${stopForm}</div>
      </li>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>beebox dev router</title>
<link rel="icon" type="image/png" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAADCUlEQVR4nOyazWsTQRjG3+xOPpsQsa21pAcpeGipIAUp1YNi8aJ4EL17Ebz6J/RP8CoI4kkFxZN6qjcpIhTFYhFBPDRKbCMN+f7Yxic72+lm89F8707Z3yGZTWbmfZ53JzNDdli1WqUWpOKFve185m8xnypXCvs0WlhACUa94VP+EzPBaCzQqpqnqYHEVvrPZrqQKpMzCES90wuRqblI41dWA9nd0q/1f+lEkZxHZMp/Zvnk2ITP/GGdgeTP7I/3u+Rszl6dGJ8dE5dMlKRQD7hI4UHhbxg5UqjnQCoE87JhAOOepEIIrhnAnOPMX20bIBiyiRvAjEkSwmUzrFbOme+7ArIhnmGtJWmBeIadAkkLxLO8nOOHA/Fs9Lu0AQLxzHwdYlt4nfS/OvxE/cYLOW3eKFTmeCGrzYtyn/C4YEwPl22I1QbPlyfvuGihtVtyB052irc7byWSdWRcnjseQnjjoLln78VFGig5052x5NJ8h3vOl4XBGxgxCkmOa8BuXAN24xqwG9eA3bgG7KZuO72pzhgFFrPUW6jEa6/aNg0BEbeHEIw3fuZf0juKtaxo+kNyQYuf08PAVQ+WOox4ZBT0g048l98+p74xB6NmWUQw3NWvuvR2aeog0EGHRieDMWAj7ixkN64Bu3EN2I1rwG5cA3ZzvLbTaj5sFHJ1D/W1kPEQTQtmaDhYQncekfGW3uS0mgu3quRNnjZfaqHMvt4vwvRsScTVRYc7jEgmb7y55/rD79Q3jQGaGoNoJFjRpbfJV1cwGgRQIwRZkjds3FnIbo6BAVXix6wQr/i8OZIWiFemglKe9OBAvLIc85O0QLxyd+WS6pNyFEE2xNdmocXJJEkIl22cWrz16FOpECV58AVSr+9fILEO3DuvklQIwYaBG0uL12Z/kyRAKgTz8uFK/ODmFSk8QCSkikvr0eM3Hzcef9ac+XvAuMfIEbnnND/8vfpybWNnXCuFyBlgxsScs3pnpfErT5vj90/XPqzHi4l8pFQOkealEaOWsVPAWovVCvN9q1r/AQAA//+5h+wYAAAABklEQVQDANbzYY8DPoT1AAAAAElFTkSuQmCC">
<style>
  body { font: 14px/1.5 system-ui, sans-serif; max-width: 900px; margin: 2em auto; padding: 0 1em; color: #222; }
  h1 { font-size: 1.2em; margin-bottom: 0.2em; }
  p.sub { color: #666; margin-top: 0; }
  ul { list-style: none; padding: 0; }
  li { display: grid; grid-template-columns: max-content max-content 1fr auto; align-items: center; column-gap: 0.9em; padding: 0.5em 0; border-bottom: 1px solid #eee; }
  a.name { font-weight: 600; text-decoration: none; color: #2255aa; font-family: ui-monospace, Menlo, monospace; white-space: nowrap; }
  a.name:hover { text-decoration: underline; }
  .statuscell { white-space: nowrap; }
  .diffstat { justify-self: end; white-space: nowrap; font-size: 0.8em; font-family: ui-monospace, Menlo, monospace; }
  .diffstat .ins { color: #2a8a2a; }
  .diffstat .del { color: #c0392b; }
  .actions { display: flex; align-items: center; gap: 0.6em; justify-self: end; }
  .badge { font-size: 0.75em; padding: 0.15em 0.5em; border-radius: 4px; }
  .badge.running { background: #d8f0d8; color: #2a6b2a; }
  .badge.cold    { background: #ececec; color: #666; }
  .badge.failed  { background: #ffe1e1; color: #a22; }
  .badge.failed a { color: #a22; text-decoration: underline; }
  .dash { font-size: 0.8em; color: #2255aa; text-decoration: none; padding: 0.15em 0.5em; border: 1px solid #d0deef; border-radius: 4px; background: #f4f8ff; }
  .dash:hover { background: #e6f0ff; text-decoration: underline; }
  .stopForm { display: inline-flex; }
  .stopForm button { font-size: 0.75em; padding: 0.15em 0.6em; background: #fff; border: 1px solid #ddd; border-radius: 4px; color: #666; cursor: pointer; }
  .stopForm button:hover { background: #fee; border-color: #faa; color: #a22; }
  .help { margin-top: 2em; padding: 1em; background: #f7f7f7; border-radius: 6px; font-size: 0.9em; }
  .help h2 { margin: 0 0 0.4em; font-size: 1em; }
  .help code { background: #fff; padding: 0.1em 0.35em; border-radius: 3px; border: 1px solid #ddd; }
  footer { margin-top: 1em; font-size: 0.85em; color: #888; }
  footer a { color: #888; }
  @media (max-width: 700px) {
    li { display: flex; flex-wrap: wrap; gap: 0.3em 0.7em; }
    a.name { white-space: normal; }
    .diffstat, .actions { justify-self: auto; }
  }
</style>
</head>
<body>
<h1>beebox dev router</h1>
<p class="sub">Click a worktree to open it. Cold worktrees start on first request (~4s); running ones idle-shut-down after ${Math.round(IDLE_TIMEOUT_MS / 1000)}s. <strong>dev ↗</strong> opens that worktree's visualizations &amp; doc browser (served from disk, no start).</p>
<p><a href="/workstreams/" class="dash" title="Browse workstreams and the issue queue">workstreams ↗</a></p>
<ul>${rows}</ul>

<div class="help">
  <h2>If something looks wedged</h2>
  <p>
    Run <code>bin/workstreams panic</code> from a terminal — this kills the
    router plus every child it knows about, wipes <code>~/.cache/beebox</code>
    state, and frees port ${ROUTER_PORT}. Then start fresh with <code>pnpm dev</code>.
  </p>
  <p>
    Per-worktree logs are at <code>~/.cache/beebox/logs/&lt;name&gt;.log</code>.
  </p>
  <h2>If the list is too long</h2>
  <p>
    Run <code>bin/workstreams sweep</code> to remove worktrees that are fully
    merged into main, clean, and have no active <code>claude</code> session —
    plus any orphan browse/log/pid state left behind by past cleanups.
    Add <code>--dry-run</code> to preview.
  </p>
</div>

<footer>
  <a href="/__router/status">status JSON</a>
</footer>
</body>
</html>
`;
}

/**
 * HTML error page shown when a worktree failed to start. Surfaces the
 * captured error message, the tail of each child's stderr, a link to
 * the per-worktree log, and a retry button that POSTs to
 * `/__router/retry/<name>`. Replaces the previous plain-text 502 so
 * the failure is actually debuggable from the browser.
 */
export function renderFailedPage(name: string, err: CapturedError): string {
  const logPath = path.join(LOG_DIR, `${name}.log`);
  const sinceMs = Date.now() - err.at;
  const viteSection = err.viteOutput.trim()
    ? `<h2>vite output (last ${err.viteOutput.length} bytes, stdout+stderr interleaved)</h2><pre>${escapeHtml(err.viteOutput)}</pre>`
    : "<h2>vite output</h2><p class=\"muted\">(empty)</p>";
  const fastifySection = err.fastifyOutput.trim()
    ? `<h2>fastify output (last ${err.fastifyOutput.length} bytes, stdout+stderr interleaved)</h2><pre>${escapeHtml(err.fastifyOutput)}</pre>`
    : "<h2>fastify output</h2><p class=\"muted\">(empty)</p>";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Worktree ${escapeHtml(name)} — failed to start</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; max-width: 920px; margin: 2em auto; padding: 0 1em; color: #222; }
  h1 { font-size: 1.2em; margin-bottom: 0.2em; color: #a22; }
  h2 { font-size: 0.95em; margin: 1.5em 0 0.3em; color: #555; }
  p.sub { color: #666; margin-top: 0; }
  p.muted { color: #999; font-style: italic; }
  .err { margin: 1em 0; padding: 0.8em 1em; background: #fff5f5; border-left: 4px solid #c33; border-radius: 3px; font-family: ui-monospace, Menlo, monospace; font-size: 0.9em; white-space: pre-wrap; }
  pre { background: #f7f7f7; padding: 0.8em 1em; border-radius: 4px; overflow-x: auto; font-size: 0.8em; line-height: 1.4; max-height: 24em; }
  form { display: inline; }
  button { font: 14px/1 system-ui; padding: 0.5em 1em; background: #2255aa; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
  button:hover { background: #1a4490; }
  a { color: #2255aa; }
  .actions { margin: 1.5em 0; display: flex; gap: 0.8em; align-items: center; }
  .meta { font-size: 0.85em; color: #888; }
  code { background: #fff; padding: 0.1em 0.35em; border-radius: 3px; border: 1px solid #ddd; }
</style>
</head>
<body>
<h1>Worktree <code>${escapeHtml(name)}</code> failed to start</h1>
<p class="sub">Phase: <code>${escapeHtml(err.phase)}</code> · <span class="meta">${Math.round(sinceMs / 1000)}s ago</span></p>

<div class="err">${escapeHtml(err.message)}</div>

<div class="actions">
  <form method="POST" action="/__router/retry/${escapeHtml(name)}">
    <button type="submit">Retry startup</button>
  </form>
  <a href="/">← back to router index</a>
</div>

${viteSection}
${fastifySection}

<h2>Per-worktree log</h2>
<p class="meta">Full output (both children, all attempts) lives at <code>${escapeHtml(logPath)}</code>.</p>

</body>
</html>
`;
}

export function renderWorkstreamsAppFallback(state: WorkstreamsAppState, logPath: string): string {
  const detail = state.phase === "failed"
    ? `<div class="err">${escapeHtml(state.message)}</div>`
    : `<p>The resident app is currently <strong>${escapeHtml(state.phase)}</strong>.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Workstreams app unavailable</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 52rem; margin: 3rem auto; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.35rem; }
  .err { margin: 1rem 0; padding: 0.8rem 1rem; background: #fff5f5; border-left: 4px solid #b43; white-space: pre-wrap; }
  .actions { display: flex; gap: 1rem; align-items: center; margin: 1.5rem 0; }
  button { font: inherit; padding: 0.45rem 0.8rem; }
  code { background: #f3f3f3; padding: 0.1rem 0.3rem; }
  a { color: #2456a6; }
</style>
</head>
<body>
<h1>Workstreams app unavailable</h1>
${detail}
<p>The dev router is still healthy. App output is in <code>${escapeHtml(logPath)}</code>.</p>
<p>If the log reports missing dependencies, run <code>pnpm install</code> in the main checkout, then retry. The router itself does not need a restart.</p>
<div class="actions">
  <form method="POST" action="/__router/retry/workstreams-app"><button type="submit">Retry app startup</button></form>
  <a href="/">Router diagnostics</a>
</div>
</body>
</html>`;
}

/**
 * The `/__router/status` JSON body: every worktree the router can see, joined
 * across disk discovery and the live map. Disk-discovery comes FIRST so cold
 * worktrees (not yet hit by a request) still appear — otherwise the JSON looks
 * empty when a freshly-created worktree exists but hasn't been warmed yet.
 */
export async function renderStatusJson(
  core: RouterCore,
  { workstreamsApp }: { workstreamsApp: WorkstreamsAppState | undefined },
): Promise<string> {
  const discovered = await discoverWorktrees(core);
  const state: Record<string, unknown> = {};
  for (const w of discovered) {
    const handle = core.getHandle(w.name);
    if (!handle) {
      state[w.name] = { state: "cold" };
      continue;
    }
    const ready = readyLifecycle(handle);
    if (ready) {
      state[w.name] = {
        state: "ready",
        frontendPort: ready.frontendPort,
        backendPort: ready.backendPort,
        dashboardPort: ready.dashboardPort,
        dashboardUrl: ready.dashboardUrl,
        vitePid: ready.vitePid,
        fastifyPid: ready.fastifyPid,
        socketDir: ready.socketDir,
        profileDir: ready.profileDir,
        startedAt: handle.startedAt,
        lastActivity: ready.lastActivity,
        idleMs: Date.now() - ready.lastActivity,
        // Non-null means this generation is executing source that has since
        // changed on disk. Reported, never acted on — see checkSourceFreshness.
        staleSince: ready.staleSince,
      };
    } else {
      // starting / failed — the only other in-map phases (stopping handles
      // are unlinked before the transition). Ports/pids aren't meaningful yet.
      state[w.name] = { state: handle.lifecycle.phase, startedAt: handle.startedAt };
    }
  }
  return JSON.stringify(
    {
      routerPort: ROUTER_PORT,
      routerPid: process.pid,
      idleTimeoutMs: IDLE_TIMEOUT_MS,
      workstreamsApp: workstreamsApp ?? { phase: "disabled" },
      worktrees: state,
    },
    null,
    2,
  );
}
