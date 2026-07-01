/**
 * Local CSP violation review runner (macOS dev tool, not shipped).
 *
 * Gathers the JSONL CSP violation logs from every local box
 * (`~/src/boxes/<box>/.callback-box/csp-reports.log`) and from prod (over SSH,
 * using `deploy/server-ip` like the deploy does), digests them via the shared
 * `csp-digest` primitives, writes a styled HTML report to the monorepo's
 * gitignored `scratch/`, `open`s it every run so you can see the run happened,
 * and fires a macOS notification ONLY when something's worth acting on:
 *
 *   - new violations since the last run  → "⚠️ N new CSP violations …"
 *   - clean across all sources (newly)   → "✅ CSP clean — candidate to harden"
 *
 * "Since last run" is tracked in a runner-owned state file
 * (`scratch/csp-report-state.json`) that is deliberately SEPARATE from
 * `csp-digest`'s per-box cursors, so a manual `pnpm csp-digest` and this runner
 * never consume each other's deltas. The harden-ready notification fires once on
 * transition to clean (guarded in state), not on every subsequent clean run.
 *
 * Meant to run unattended from a LaunchAgent — terminal output stays quiet; the
 * report + notification ARE the output. Everything degrades gracefully: prod
 * unreachable still reports local; missing `alerter` falls back to osascript.
 *
 *   pnpm csp-report
 *
 * See docs/scheduled/csp-violation-review.md for the review guidance this report
 * inlines, and docs/content-security-policy.md for the policy itself.
 */

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { cspReportLogPath } from "../webapp/routes/api-csp-report.js";
import { digestEntries, entriesSince, newestTs, parseCspLog, type CspDigest, type CspEntry } from "./csp-digest.js";

const execFileP = promisify(execFile);

const HOME = os.homedir();
const BOXES_DIR = path.join(HOME, "src/boxes");
const MONOREPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const SCRATCH_DIR = path.join(MONOREPO_ROOT, "scratch");
const REPORT_PATH = path.join(SCRATCH_DIR, "csp-report.html");
const STATE_PATH = path.join(SCRATCH_DIR, "csp-report-state.json");
const SERVER_IP_PATH = path.resolve(import.meta.dirname, "../../deploy/server-ip");
const PROD_LOG_GLOB = "/home/callback/boxes/*/.callback-box/csp-reports.log";

type Scope = "local" | "prod";

/** One CSP log source (a single box on local or prod) and its parsed entries. */
interface Source {
  scope: Scope;
  box: string;
  entries: CspEntry[];
}

/** A source's full-log digest plus the delta (entries newer than last run). */
interface SourceReport {
  key: string;
  scope: Scope;
  box: string;
  digest: CspDigest;
  /** Per-`directive ← origin` key → count seen only in the new delta. */
  newByKey: Map<string, number>;
  newTotal: number;
  newest: string | null;
}

interface RunnerState {
  /** source key → newest entry ts observed on the last run. */
  sources: Record<string, string>;
  /** True if we've already notified "clean — harden-ready" for the current clean streak. */
  lastNotifiedHardenReady: boolean;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── Gather ──────────────────────────────────────────────────────────────

/** Local boxes that actually have a CSP log file (a missing log = no reports yet). */
async function gatherLocal(): Promise<Source[]> {
  let dirents;
  try {
    dirents = await fs.readdir(BOXES_DIR, { withFileTypes: true });
  } catch (_e) {
    // No ~/src/boxes on this machine — nothing local to report.
    return [];
  }
  const sources: Source[] = [];
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    const logPath = cspReportLogPath(path.join(BOXES_DIR, d.name));
    if (!existsSync(logPath)) continue;
    const text = await fs.readFile(logPath, "utf-8").catch(() => "");
    sources.push({ scope: "local", box: d.name, entries: parseCspLog(text) });
  }
  return sources;
}

/**
 * Prod boxes over SSH. One remote command concatenates every box's log, each
 * prefixed by a `=== <path> ===` header we split back apart to attribute per box.
 * BatchMode + a short ConnectTimeout so an unreachable server fails fast instead
 * of hanging the unattended run.
 */
async function gatherProd(): Promise<{ sources: Source[]; error: string | null }> {
  let ip: string;
  try {
    ip = (await fs.readFile(SERVER_IP_PATH, "utf-8")).trim();
  } catch (_e) {
    return { sources: [], error: "deploy/server-ip not present in this checkout" };
  }
  if (ip === "") return { sources: [], error: "deploy/server-ip is empty" };
  // Trailing `exit 0` so a no-logs-yet server (the glob matches nothing, the loop's
  // last `[ -f ]` is false) doesn't look like a connection failure — only a real
  // ssh/connection error (exit 255) should surface as "unreachable".
  const remoteCmd = `for f in ${PROD_LOG_GLOB}; do [ -f "$f" ] && { echo "=== $f ==="; cat "$f"; }; done; exit 0`;
  try {
    const { stdout } = await execFileP(
      "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", `root@${ip}`, remoteCmd],
      { maxBuffer: 32_000_000 },
    );
    return { sources: parseProdSections(stdout), error: null };
  } catch (e) {
    return { sources: [], error: `prod unreachable — ${sshErrorReason(e)}` };
  }
}

/** A concise reason from a failed `ssh` execFile, without echoing the whole remote command. */
function sshErrorReason(e: unknown): string {
  if (e !== null && typeof e === "object" && "stderr" in e) {
    const firstLine = String(e.stderr).trim().split("\n")[0];
    if (firstLine !== undefined && firstLine !== "") return firstLine;
  }
  return "ssh failed";
}

/** Split the concatenated prod stream back into per-box sources by its `=== path ===` headers. */
function parseProdSections(stdout: string): Source[] {
  const sources: Source[] = [];
  const chunks = stdout.split(/^=== (.+?) ===$/m);
  // chunks: [preamble, headerPath1, body1, headerPath2, body2, ...]
  for (let i = 1; i < chunks.length; i += 2) {
    const headerPath = chunks[i];
    const body = chunks[i + 1] ?? "";
    const box = /\/boxes\/([^/]+)\//.exec(headerPath ?? "")?.[1] ?? "(unknown)";
    sources.push({ scope: "prod", box, entries: parseCspLog(body) });
  }
  return sources;
}

// ── State ───────────────────────────────────────────────────────────────

async function readState(): Promise<RunnerState> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(STATE_PATH, "utf-8"));
    if (parsed !== null && typeof parsed === "object") {
      const o = parsed as Partial<RunnerState>;
      return {
        sources: typeof o.sources === "object" && o.sources !== null ? o.sources : {},
        lastNotifiedHardenReady: o.lastNotifiedHardenReady === true,
      };
    }
  } catch (_e) {
    // First run or unreadable state — start from a clean baseline.
  }
  return { sources: {}, lastNotifiedHardenReady: false };
}

async function writeState(state: RunnerState): Promise<void> {
  await fs.mkdir(SCRATCH_DIR, { recursive: true });
  await fs.writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

// ── Digest per source ─────────────────────────────────────────────────────

/**
 * Full-log digest + the new-since-last-run delta. On a source's FIRST run (no
 * stored cursor) we establish a baseline: the full log is shown but nothing is
 * counted as "new", so the runner doesn't fire a notification for a pre-existing
 * backlog. Subsequent runs count only genuinely new entries.
 */
function reportForSource(source: Source, state: RunnerState): SourceReport {
  const key = `${source.scope}:${source.box}`;
  const since = state.sources[key] ?? null;
  const digest = digestEntries(source.entries);
  const delta = since === null ? [] : entriesSince(source.entries, since);
  const deltaDigest = digestEntries(delta);
  const newByKey = new Map<string, number>();
  for (const v of deltaDigest.violations) newByKey.set(`${v.directive} ${v.blocked}`, v.count);
  return { key, scope: source.scope, box: source.box, digest, newByKey, newTotal: deltaDigest.total, newest: newestTs(source.entries) };
}

// ── HTML report ───────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/["&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"));
}

function violationRows(report: SourceReport): string {
  return report.digest.violations
    .map((v) => {
      const newCount = report.newByKey.get(`${v.directive} ${v.blocked}`) ?? 0;
      const badge = newCount > 0 ? ` <span class="new">+${newCount} new</span>` : "";
      return `<tr${newCount > 0 ? ' class="row-new"' : ""}>
        <td class="dir">${esc(v.directive)}</td>
        <td class="org">${esc(v.blocked)}${badge}</td>
        <td class="num">${v.count}</td>
        <td class="ts">${esc(v.firstSeen)}</td>
        <td class="ts">${esc(v.lastSeen)}</td></tr>`;
    })
    .join("\n");
}

function scopeSection({ scope, reports, note }: { scope: Scope; reports: SourceReport[]; note: string | null }): string {
  const title = scope === "local" ? "Local boxes" : "Prod";
  const dirty = reports.filter((r) => !r.digest.clean);
  let body: string;
  if (note !== null) {
    body = `<p class="note">${esc(note)}</p>`;
  } else if (reports.length === 0) {
    body = "<p class=\"ok\">No CSP logs recorded yet.</p>";
  } else if (dirty.length === 0) {
    body = `<p class="ok">✅ Clean across ${reports.length} box(es) with logs — no violations recorded.</p>`;
  } else {
    body = dirty
      .map(
        (r) => `<h3>${esc(r.box)} <span class="count">(${r.digest.violations.length} distinct, ${r.digest.total} total)</span></h3>
      <table><thead><tr><th>Directive</th><th>Blocked origin</th><th>Count</th><th>First seen</th><th>Last seen</th></tr></thead>
      <tbody>${violationRows(r)}</tbody></table>`,
      )
      .join("\n");
  }
  return `<section><h2>${title}</h2>${body}</section>`;
}

const GUIDANCE_HTML = `
<section class="guidance"><h2>How to act on this</h2>
<p>For each violation, decide:</p>
<ul>
  <li><strong>Legitimate consumer</strong> (a new external image host, API, or embed origin) →
      add the specific allowlist entry in <code>src/lib/csp.ts</code> (and update its
      <code>test/lib/csp.doctest.md</code>).</li>
  <li><strong>Real bug or unexpected exfiltration</strong> → flag it for investigation. Do <strong>not</strong>
      harden while any violation is unresolved.</li>
  <li><strong>Known case:</strong> a figure using p5's opt-in <code>eval</code>/WASM features reports a
      <code>script-src</code> violation. Fix by iframe-isolating that figure — not by adding
      <code>'unsafe-eval'</code> app-wide.</li>
</ul>
<p>When the full log is clean across meaningful traffic, harden by changing the header name from
   <code>Content-Security-Policy-Report-Only</code> to <code>Content-Security-Policy</code> (keep
   <code>script-src 'self'</code>) in <code>registerCspReportingHeaders</code>
   (<code>src/webapp/server-root.ts</code>). Propose only — the boxholder confirms and deploys.</p>
</section>`;

function bannerHtml(
  { hardenReady, totalViolations, totalNew, prodError }:
  { hardenReady: boolean; totalViolations: number; totalNew: number; prodError: string | null },
): string {
  if (hardenReady) {
    return "<div class=\"banner harden\">✅ <strong>Safe to harden</strong> — no CSP violations recorded across all reachable sources. Flip Report-Only → enforcing (see below), then confirm &amp; deploy.</div>";
  }
  if (totalViolations > 0) {
    const newNote = totalNew > 0 ? `${totalNew} new violation(s) since last run. ` : "";
    return `<div class="banner warn"><strong>Do not harden yet.</strong> ${newNote}Resolve the violations below first.</div>`;
  }
  // No violations, but we can't declare harden-ready — usually prod was unreachable
  // (could be hiding violations) or nothing has been logged yet.
  const reason = prodError !== null ? "prod couldn't be reached, so its logs are unconfirmed" : "no CSP logs have been recorded yet";
  return `<div class="banner info">No violations recorded, but not confirmed harden-ready — ${reason}.</div>`;
}

function buildHtml(
  { local, prod, prodError, hardenReady, totalViolations, totalNew, generatedAt }:
  { local: SourceReport[]; prod: SourceReport[]; prodError: string | null; hardenReady: boolean; totalViolations: number; totalNew: number; generatedAt: string },
): string {
  const banner = bannerHtml({ hardenReady, totalViolations, totalNew, prodError });
  const prodNote = prodError !== null ? `<div class="banner info">Prod: ${esc(prodError)} — showing local only.</div>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>CSP violation review</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 1.25rem; }
  h1 { margin: 0 0 .25rem; } .sub { color: #888; margin: 0 0 1.5rem; }
  .banner { padding: .75rem 1rem; border-radius: .5rem; margin: .5rem 0; }
  .banner.harden { background: #e7f6e9; color: #14532d; border: 1px solid #86c99a; }
  .banner.warn { background: #fdf1e3; color: #7c3a03; border: 1px solid #e2a86a; }
  .banner.info { background: #eef2f8; color: #334155; border: 1px solid #b6c4dc; }
  section { margin: 1.75rem 0; } h2 { border-bottom: 1px solid #ccc4; padding-bottom: .25rem; }
  h3 { margin: 1rem 0 .35rem; } .count { color: #888; font-weight: normal; font-size: .85em; }
  table { border-collapse: collapse; width: 100%; margin: .35rem 0 1rem; font-size: 13.5px; }
  th, td { text-align: left; padding: .3rem .55rem; border-bottom: 1px solid #ccc4; vertical-align: top; }
  th { font-size: .8em; text-transform: uppercase; letter-spacing: .03em; color: #888; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; } td.ts { color: #888; font-size: .85em; white-space: nowrap; }
  td.dir { font-weight: 600; } td.org { word-break: break-all; }
  .row-new { background: #fff8e6; } tbody .row-new td { border-color: #e2c98a; }
  .new { background: #d97706; color: #fff; border-radius: .35rem; padding: 0 .35rem; font-size: .72em; font-weight: 700; margin-left: .35rem; }
  .ok { color: #14532d; } .note { color: #888; } code { background: #8881; padding: 0 .25rem; border-radius: .25rem; }
  .guidance li { margin: .35rem 0; }
</style></head><body>
<h1>CSP violation review</h1>
<p class="sub">Generated ${esc(generatedAt)}</p>
${banner}${prodNote}
${scopeSection({ scope: "local", reports: local, note: null })}
${scopeSection({ scope: "prod", reports: prod, note: prodError })}
${GUIDANCE_HTML}
</body></html>`;
}

// ── Notification ──────────────────────────────────────────────────────────

/**
 * Fire a macOS notification in a detached child so it outlives this script. With
 * `alerter` (clickable) a click opens the report; without it, fall back to
 * `osascript`. Title/message pass through the environment to sidestep shell
 * quoting. Never throws — a broken notifier must not break the run.
 */
function fireNotification(title: string, message: string): void {
  const script = `
if command -v alerter >/dev/null 2>&1; then
  RESULT=$(alerter --title "$CSP_TITLE" --message "$CSP_MSG" --timeout 900 --json 2>/dev/null)
  case "$RESULT" in *licked*) open "$CSP_REPORT" ;; esac
elif command -v osascript >/dev/null 2>&1; then
  osascript -e "display notification \\"$CSP_MSG\\" with title \\"$CSP_TITLE\\"" >/dev/null 2>&1
fi`;
  try {
    const child = spawn("sh", ["-c", script], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, CSP_TITLE: title, CSP_MSG: message, CSP_REPORT: REPORT_PATH },
    });
    child.unref();
  } catch (_e) {
    // Notifier unavailable — the report is still written and opened.
  }
}

function openReport(): void {
  try {
    spawn("open", [REPORT_PATH], { detached: true, stdio: "ignore" }).unref();
  } catch (_e) {
    // `open` only exists on macOS — a non-mac run still leaves the report on disk.
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const state = await readState();
  const [localSources, prod] = await Promise.all([gatherLocal(), gatherProd()]);

  const localReports = localSources.map((s) => reportForSource(s, state));
  const prodReports = prod.sources.map((s) => reportForSource(s, state));
  const allReports = [...localReports, ...prodReports];

  const totalNew = allReports.reduce((sum, r) => sum + r.newTotal, 0);
  const totalViolations = allReports.reduce((sum, r) => sum + r.digest.total, 0);
  // Harden-ready needs real evidence: at least one source with a log, all clean,
  // and prod reachable (an unreachable prod could be hiding violations).
  const hardenReady = allReports.length > 0 && allReports.every((r) => r.digest.clean) && prod.error === null;

  const html = buildHtml({
    local: localReports,
    prod: prodReports,
    prodError: prod.error,
    hardenReady,
    totalViolations,
    totalNew,
    generatedAt: new Date().toLocaleString(),
  });
  await fs.mkdir(SCRATCH_DIR, { recursive: true });
  await fs.writeFile(REPORT_PATH, html);
  openReport();

  // Notify only when interesting: new violations, or a fresh transition to clean.
  if (totalNew > 0) {
    const boxes = allReports.filter((r) => r.newTotal > 0).length;
    fireNotification("CSP violations", `⚠️ ${totalNew} new CSP violation(s) across ${boxes} box(es)`);
  } else if (hardenReady && !state.lastNotifiedHardenReady) {
    fireNotification("CSP review", "✅ CSP clean — candidate to harden");
  }

  // Advance per-source cursors and remember the harden-ready streak for next run.
  for (const r of allReports) {
    if (r.newest !== null) state.sources[r.key] = r.newest;
  }
  state.lastNotifiedHardenReady = hardenReady;
  await writeState(state);
}

main().catch((e: unknown) => {
  // Unattended run: surface to stderr for the LaunchAgent log, but exit 0 so a
  // transient failure doesn't get the agent throttled/disabled by launchd.
  process.stderr.write(`csp-report failed: ${errMessage(e)}\n`);
});
