import type http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";

import {
  collectAgentQuotas,
  quotaPace,
  type AgentQuota,
  type QuotaWindow,
} from "./agent-quotas.js";
import { escapeHtml } from "./router-docs.js";
import {
  collectOverlay,
  listIssues,
  parseFrontmatter,
  parseIssueFile,
  serveIssues,
  type IssueRecord,
} from "./router-issues.js";

interface RemovedState {
  at: string;
  finalSha?: string;
  merged: boolean;
}

interface ArchivedState {
  at: string;
}

export interface WorkstreamRow {
  name: string;
  path: string | null;
  git: {
    ahead: number | null;
    dirty: number | null;
    merged: boolean | null;
    tip: string | null;
  } | null;
  runtime: { state: string };
  agent: { state: string; reason: string };
  session: {
    agent: string | null;
    hasSession: boolean;
    tty: string | null;
    emoji: string | null;
    baseSha: string | null;
    removed: RemovedState | null;
    archived?: ArchivedState | null;
  };
  boxState: {
    testSetup: boolean;
    keepUnmerged: boolean;
    pristine: boolean | null;
  };
}

export interface WorkstreamsDeps {
  list(): Promise<WorkstreamRow[]>;
  quotas?(): Promise<AgentQuota[]>;
  run(verb: ActionVerb, name: string): Promise<void>;
  documents(): Promise<{
    issues: IssueRecord[];
    plans: PlanRecord[];
    worktreeIssues?: Array<{ worktree: string; issue: IssueRecord }>;
    worktreeTouchedSlugs?: Array<{ worktree: string; slug: string }>;
  }>;
}

export interface PlanRecord {
  title: string;
  status: string;
  workstream: string;
  relPath: string;
}

type ActionVerb =
  | "archive"
  | "close"
  | "confirm-tested"
  | "focus"
  | "release"
  | "reset-test"
  | "resume"
  | "unarchive";

const ACTION_PATH =
  /^\/workstreams\/action\/(archive|close|confirm-tested|focus|release|reset-test|resume|unarchive)\/([a-zA-Z0-9_.-]+)$/;

export function legacyIssuesRedirect(afterWorkstream: string): string | null {
  const pathname = afterWorkstream.split("?")[0] ?? afterWorkstream;
  if (pathname !== "/dev/issues" && !pathname.startsWith("/dev/issues/"))
    return null;
  const suffix = afterWorkstream.slice("/dev/issues".length);
  return `/workstreams/issues${suffix || "/"}`;
}

function defaultDeps(
  repoRoot: string,
  documentsRoot: string,
  worktreesRoot: string,
): WorkstreamsDeps {
  let documentsCache: { at: number; value: WorkstreamDocuments } | undefined;
  async function run(args: string[]): Promise<string> {
    const timeout =
      args[0] === "resume" ? 15 * 60_000 : args[0] === "list" ? 10_000 : 60_000;
    const child = execa(path.join(repoRoot, "bin/workstreams"), args, {
      cwd: repoRoot,
      timeout,
      killSignal: "SIGTERM",
      detached: true,
    });
    try {
      return (await child).stdout;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "timedOut" in error &&
        error.timedOut === true &&
        child.pid
      ) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          // The process group already exited.
        }
      }
      throw error;
    }
  }
  return {
    async list() {
      const stdout = await run(["list", "--json", "--include-removed"]);
      // This is the same-repository CLI's tested --json contract, not external input.
      return JSON.parse(stdout) as WorkstreamRow[];
    },
    async quotas() {
      return await collectAgentQuotas({ backgroundClaudeRefresh: true });
    },
    async run(verb, name) {
      await run(
        verb === "confirm-tested"
          ? [verb, name, "--agent-confirmed"]
          : [verb, name],
      );
    },
    async documents() {
      if (documentsCache && Date.now() - documentsCache.at < 60_000)
        return documentsCache.value;
      const issueOverlay = await listWorktreeIssueChanges(worktreesRoot);
      const value = {
        issues: await listIssues(path.join(documentsRoot, "issues")),
        plans: await listPlans(documentsRoot),
        ...issueOverlay,
      };
      documentsCache = { at: Date.now(), value };
      return value;
    },
  };
}

async function listWorktreeIssueChanges(worktreesRoot: string): Promise<{
  worktreeIssues: Array<{ worktree: string; issue: IssueRecord }>;
  worktreeTouchedSlugs: Array<{ worktree: string; slug: string }>;
}> {
  const out: Array<{ worktree: string; issue: IssueRecord }> = [];
  const touched: Array<{ worktree: string; slug: string }> = [];
  const overlay = await collectOverlay(worktreesRoot);
  for (const [relPath, entries] of overlay.byPath) {
    for (const worktree of new Set(entries.map((entry) => entry.worktree))) {
      const slug = path.posix.basename(relPath, ".md");
      const root = overlay.worktreeRoots.get(worktree);
      if (!root) continue;
      try {
        const issue = parseIssueFile(
          relPath,
          await fs.readFile(path.join(root, "issues", relPath), "utf8"),
        );
        out.push({ worktree, issue });
        touched.push({ worktree, slug });
      } catch {
        // Deleted or unreadable issue.
      }
    }
  }
  return { worktreeIssues: out, worktreeTouchedSlugs: touched };
}

type WorkstreamDocuments = Awaited<ReturnType<WorkstreamsDeps["documents"]>>;

export function issuesForWorkstream(
  documents: WorkstreamDocuments,
  workstream: string,
): IssueRecord[] {
  const touched = new Set(
    (documents.worktreeTouchedSlugs ?? []).map((entry) => entry.slug),
  );
  const main = documents.issues.filter((issue) => !touched.has(issue.slug));
  const candidates = new Map<
    string,
    Array<{ worktree: string; issue: IssueRecord }>
  >();
  for (const entry of documents.worktreeIssues ?? []) {
    const records = candidates.get(entry.issue.slug) ?? [];
    records.push(entry);
    candidates.set(entry.issue.slug, records);
  }
  const overlay = [...candidates.values()].map((records) => {
    records.sort((a, b) => a.worktree.localeCompare(b.worktree));
    return (
      records.find(
        (entry) => entry.issue.frontmatter.workstream === entry.worktree,
      ) ?? records[0]!
    ).issue;
  });
  return [...main, ...overlay]
    .filter((issue) => issue.frontmatter.workstream === workstream)
    .toSorted(
      (a, b) =>
        Number(a.closed) - Number(b.closed) ||
        a.frontmatter.title.localeCompare(b.frontmatter.title),
    );
}

async function listPlans(repoRoot: string): Promise<PlanRecord[]> {
  const records: PlanRecord[] = [];
  for (const dir of ["plans", "implemented-plans", "unimplemented-plans"]) {
    const root = path.join(repoRoot, "callback-box/docs", dir);
    const names = await fs.readdir(root).catch(() => []);
    for (const name of names) {
      if (
        !name.endsWith(".md") ||
        name === "README.md" ||
        name.endsWith(".review.md")
      )
        continue;
      const relPath = `callback-box/docs/${dir}/${name}`;
      const { data } = parseFrontmatter(
        await fs.readFile(path.join(root, name), "utf8"),
      );
      const title =
        typeof data.title === "string" ? data.title : name.replace(/\.md$/, "");
      records.push({
        title,
        status: typeof data.status === "string" ? data.status : "unknown",
        workstream:
          typeof data.workstream === "string" ? data.workstream : "unknown",
        relPath,
      });
    }
  }
  return records.toSorted((a, b) => a.title.localeCompare(b.title));
}

function emoji(row: WorkstreamRow): string {
  return row.session.emoji ?? "·";
}

function actionForm(verb: ActionVerb, row: WorkstreamRow): string {
  const label = verb[0]?.toUpperCase() + verb.slice(1);
  return `<form method="POST" action="/workstreams/action/${verb}/${encodeURIComponent(row.name)}"><button type="submit">${label}</button></form>`;
}

function actionsHtml(row: WorkstreamRow): string {
  const archive =
    row.session.archived != null
      ? actionForm("unarchive", row)
      : row.agent.state === "live"
        ? ""
        : actionForm("archive", row);
  const reset = row.boxState.testSetup ? actionForm("reset-test", row) : "";
  const release =
    row.agent.state !== "live" &&
    (row.boxState.testSetup || row.boxState.keepUnmerged)
      ? actionForm("release", row)
      : "";
  if (row.agent.state === "live")
    return (
      actionForm("focus", row) + actionForm("close", row) + reset + archive
    );
  if (row.session.removed?.merged === false) return "";
  if (row.session.hasSession)
    return actionForm("resume", row) + reset + release + archive;
  return reset + release + archive;
}

function agentStatusHtml(row: WorkstreamRow): string {
  const agent =
    row.session.agent === "claude"
      ? "Claude"
      : row.session.agent === "codex"
        ? "Codex"
        : "Agent";
  if (row.agent.state === "live")
    return `<span class="agent-status agent-live"><span aria-hidden="true">●</span> ${agent} active</span>`;
  if (row.agent.state === "unknown")
    return `<span class="agent-status">${agent} activity unknown</span>`;
  return `<span class="agent-status">${row.session.agent ? `${agent} inactive` : "No agent recorded"}</span>`;
}

function issueSummaryHtml(issues: IssueRecord[]): string {
  const open = issues.filter((issue) => !issue.closed);
  if (open.length === 0) return "";
  return `<div class="row-issues">${open
    .map(
      (issue) =>
        `<a href="${escapeHtml(issueHref(issue))}">${escapeHtml(issue.frontmatter.title)}</a>`,
    )
    .join("")}</div>`;
}

function rowHtml(
  row: WorkstreamRow,
  note: string,
  issues: IssueRecord[] = [],
): string {
  const box = row.boxState.keepUnmerged
    ? '<span class="chip held">keep unmerged</span>'
    : row.boxState.testSetup
      ? `<span class="chip held">test1 ${row.boxState.pristine === true ? "pristine" : "dirtied"}</span>`
      : "";
  const name = `<a class="workstream-link" href="/workstreams/${encodeURIComponent(row.name)}/"><span class="emoji">${escapeHtml(emoji(row))}</span>${escapeHtml(row.name)}</a>`;
  const main = `<div class="row-main">${name}<span>${escapeHtml(note)}</span>${agentStatusHtml(row)}${box}<span class="actions">${actionsHtml(row)}</span></div>`;
  return `<li>${main}${issueSummaryHtml(issues)}</li>`;
}

function section(params: {
  title: string;
  rows: WorkstreamRow[];
  note: (row: WorkstreamRow) => string;
  documents: WorkstreamDocuments;
}): string {
  const { title, rows, note, documents } = params;
  if (rows.length === 0) return "";
  return `<section><h2>${escapeHtml(title)} <small>${rows.length}</small></h2><ul>${rows.map((row) => rowHtml(row, note(row), issuesForWorkstream(documents, row.name))).join("")}</ul></section>`;
}

function issueHref(issue: IssueRecord): string {
  return `/workstreams/issues/${issue.visibility === "private" ? "private/" : ""}${issue.relPath}`;
}

function planHref(plan: PlanRecord): string {
  return `/main/dev/docs/${plan.relPath.replace(/^callback-box\//, "")}`;
}

function documentList(params: {
  issues: IssueRecord[];
  plans: PlanRecord[];
}): string {
  const issueRows = params.issues
    .map(
      (issue) =>
        `<li><a href="${escapeHtml(issueHref(issue))}">${escapeHtml(issue.frontmatter.title)}</a><span>${issue.closed ? "closed" : "open"}</span></li>`,
    )
    .join("");
  const planRows = params.plans
    .map(
      (plan) =>
        `<li><a href="${escapeHtml(planHref(plan))}">${escapeHtml(plan.title)}</a><span>${escapeHtml(plan.status)}</span></li>`,
    )
    .join("");
  return `${issueRows ? `<section><h2>Issues <small>${params.issues.length}</small></h2><ul>${issueRows}</ul></section>` : ""}${planRows ? `<section><h2>Plans <small>${params.plans.length}</small></h2><ul>${planRows}</ul></section>` : ""}`;
}

const PAGE_CSS = `
body { font: 14px/1.5 system-ui, sans-serif; max-width: 1000px; margin: 2em auto; padding: 0 1em; color: #222; }
h1 { font-size: 1.4em; }
h2 { font-size: 1em; margin-top: 1.8em; }
h2 small { color: #999; font-weight: 400; }
ul { list-style: none; padding: 0; }
li { padding: .55em 0; border-bottom: 1px solid #eee; }
nav a, .row-issues a { color: #2255aa; text-decoration: none; }
.row-main { display: flex; gap: 1em; align-items: center; }
.workstream-link, li > a { min-width: 18em; font: 600 14px ui-monospace, Menlo, monospace; color: #2255aa; text-decoration: none; }
.row-issues { display: flex; flex-direction: column; gap: .15em; margin: .35em 0 0 2.8em; }
.row-issues a::before { content: "Issue · "; color: #777; }
.emoji { display: inline-block; width: 1.8em; }
.chip { padding: .1em .45em; border-radius: 4px; background: #eee; font-size: .8em; white-space: nowrap; }
.held { background: #fff1c7; color: #765600; }
.actions { display: flex; gap: .4em; margin-left: auto; }
.actions form { margin: 0; }
button, input { box-sizing: border-box; font: inherit; }
button { padding: .35em .65em; }
.agent-status { padding: .15em .5em; border-radius: 999px; background: #f1f3f5; color: #59636e; font-size: .82em; white-space: nowrap; }
.agent-live { background: #dcfce7; color: #166534; font-weight: 650; }
.page-header { margin-top: 1.2em; }
.heading-row { display: flex; align-items: center; justify-content: space-between; gap: 1em; }
.heading-row h1 { margin: .2em 0; }
.search-form { display: flex; gap: .5em; max-width: 38em; margin: .8em 0 1.2em; }
.search-form input { min-width: 0; flex: 1; padding: .55em .7em; border: 1px solid #aeb5bd; border-radius: 6px; }
.search-form button { padding: .55em .85em; }
.quota-details { position: relative; }
.quota-details > summary { cursor: pointer; color: #2255aa; font-weight: 600; list-style-position: inside; }
.quota-panel { position: absolute; z-index: 2; right: 0; width: min(46rem, calc(100vw - 2em)); padding: 1em; background: #fff; border: 1px solid #ccd2d8; border-radius: 8px; box-shadow: 0 8px 24px #0002; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.flash { background: #eef6ff; border: 1px solid #bbd8f5; padding: .6em .8em; }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: .35em 1em; }
.facts dt { font-weight: 600; }
.facts dd { margin: 0; }
.quota-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1em; }
.quota-card { border: 1px solid #ddd; border-radius: 6px; padding: .8em; }
.quota-card h3 { font-size: 1em; margin: 0 0 .5em; }
.quota-window { margin-top: .7em; }
.quota-window p { margin: .2em 0; }
.quota-window progress { width: 100%; }
.on-track { color: #176b3a; font-weight: 600; }
.over-pace { color: #9a3412; font-weight: 600; }
.muted { color: #666; font-size: .9em; }
.archived-list { opacity: .82; }
@media (max-width: 700px) {
  .row-main { align-items: flex-start; flex-wrap: wrap; }
  .workstream-link { min-width: 100%; }
  .row-issues { margin-left: 0; }
  .actions { margin-left: 0; }
  .quota-grid { grid-template-columns: 1fr; }
  .quota-panel { position: fixed; left: 1em; right: 1em; width: auto; }
  .heading-row { align-items: flex-start; }
}`;

function pageShell(title: string, body: string, refresh = false): string {
  const refreshMeta = refresh ? '<meta http-equiv="refresh" content="30">' : "";
  const navItems = [
    '<a href="/">router</a>',
    '<a href="/workstreams/">workstreams</a>',
    '<a href="/workstreams/issues/">issues</a>',
    '<a href="/workstreams/issues/?needs=manual-testing&amp;assigned=true">manual testing issues</a>',
    '<a href="/workstreams/plans/">plans</a>',
    '<a href="/workstreams/testing/">test queue</a>',
  ];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${refreshMeta}<title>${escapeHtml(title)}</title>
  <style>${PAGE_CSS}</style>
</head>
<body><nav>${navItems.join(" · ")}</nav>${body}</body>
</html>`;
}

function formatReset(resetsAt: string): string {
  return resetsAt.replace("T", " ").replace(/:00\.000Z$/, "Z");
}

function quotaWindowHtml(window: QuotaWindow, now: Date): string {
  if (new Date(window.resetsAt).getTime() <= now.getTime()) {
    return `<div class="quota-window"><strong>${escapeHtml(window.label)}</strong><p class="muted">Expired snapshot · awaiting a fresh quota update.</p></div>`;
  }
  const used = Math.min(100, Math.max(0, window.usedPercent));
  const pace = quotaPace(window, now);
  const paceHtml = pace
    ? pace.onTrack
      ? `<p class="on-track">On track · ${Math.round(pace.differencePoints)} points under budget (${Math.round(pace.expectedPercent)}% of window elapsed)</p>`
      : `<p class="over-pace">Over pace · ${Math.round(Math.abs(pace.differencePoints))} points over budget (${Math.round(pace.expectedPercent)}% of window elapsed)</p>`
    : '<p class="muted">Pace unavailable for this window.</p>';
  return `<div class="quota-window"><strong>${escapeHtml(window.label)}</strong><p>${Math.round(window.usedPercent)}% used</p><progress max="100" value="${String(used)}" aria-label="${escapeHtml(window.label)} usage"></progress>${paceHtml}<p class="muted">Resets ${escapeHtml(formatReset(window.resetsAt))}</p></div>`;
}

export function quotaHtml(quotas: AgentQuota[], now = new Date()): string {
  if (quotas.length === 0) return "";
  const cards = quotas
    .map((quota) => {
      const title = quota.provider === "claude" ? "Claude account" : "Codex";
      const captured = `<p class="muted">${quota.stale ? "Stale · " : ""}Updated ${escapeHtml(formatReset(quota.fetchedAt))}</p>`;
      const content =
        quota.status === "available"
          ? `${quota.message ? `<p class="muted">Refresh failed: ${escapeHtml(quota.message)}</p>` : ""}${quota.windows.map((window) => quotaWindowHtml(window, now)).join("")}`
          : `<p>${escapeHtml(quota.message ?? "Quota unavailable.")}</p>`;
      const credits = quota.credits
        ? `<p class="muted">Credits: ${quota.credits.unlimited ? "unlimited" : escapeHtml(quota.credits.balance ?? "unavailable")}</p>`
        : "";
      return `<article class="quota-card"><h3>${title}</h3>${content}${credits}${captured}</article>`;
    })
    .join("");
  const paces = quotas.flatMap((quota) =>
    quota.status === "available"
      ? quota.windows
          .map((window) => quotaPace(window, now))
          .filter((pace) => pace !== null)
      : [],
  );
  const paceSummary = paces.some((pace) => !pace.onTrack)
    ? " · over pace"
    : paces.length > 0
      ? " · on track"
      : "";
  return `<details class="quota-details"><summary>Quotas${paceSummary}</summary><div class="quota-panel" role="region" aria-labelledby="agent-capacity"><h2 id="agent-capacity" class="sr-only">Agent capacity</h2><div class="quota-grid">${cards}</div></div></details>`;
}

export function relativeTime(value: string, now = new Date()): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value;
  const seconds = Math.round((time - now.getTime()) / 1000);
  if (Math.abs(seconds) < 60) return "just now";
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 365 * 24 * 60 * 60],
    ["month", 30 * 24 * 60 * 60],
    ["week", 7 * 24 * 60 * 60],
    ["day", 24 * 60 * 60],
    ["hour", 60 * 60],
    ["minute", 60],
  ];
  const [unit, size] = units.find(([, size]) => Math.abs(seconds) >= size) ?? [
    "minute",
    60,
  ];
  return new Intl.RelativeTimeFormat("en", { numeric: "always" }).format(
    Math.round(seconds / size),
    unit,
  );
}

function renderDetail(
  name: string,
  row: WorkstreamRow | undefined,
  documents: { issues: IssueRecord[]; plans: PlanRecord[] },
): string {
  const state =
    row?.path === null
      ? "culled"
      : (row?.agent.state ?? "registry record unavailable");
  const facts = `<dl class="facts"><dt>State</dt><dd>${escapeHtml(state)}</dd><dt>Path</dt><dd>${escapeHtml(row?.path ?? "none")}</dd><dt>Git</dt><dd>${row?.git ? `${String(row.git.ahead ?? "?")} ahead, ${String(row.git.dirty ?? "?")} dirty` : "unavailable"}</dd><dt>Box</dt><dd>${row?.boxState.testSetup ? "test-setup" : row?.boxState.keepUnmerged ? "keep unmerged" : "no pin"}</dd></dl>`;
  return pageShell(
    name,
    `<h1>${escapeHtml(row?.session.emoji ?? "·")} ${escapeHtml(name)}</h1>${facts}${row ? `<div class="actions">${actionsHtml(row)}</div>` : ""}${documentList(documents)}`,
  );
}

function renderPlans(plans: PlanRecord[]): string {
  const statuses = [
    "draft",
    "active",
    "partial",
    "implemented",
    "superseded",
    "parked",
  ];
  const sections = statuses
    .map((status) => {
      const matching = plans.filter((plan) => plan.status === status);
      if (matching.length === 0) return "";
      const rows = matching
        .map(
          (plan) =>
            `<li><a href="${escapeHtml(planHref(plan))}">${escapeHtml(plan.title)}</a><a href="/workstreams/${encodeURIComponent(plan.workstream)}/">${escapeHtml(plan.workstream)}</a></li>`,
        )
        .join("");
      return `<section><h2>${escapeHtml(status)} <small>${matching.length}</small></h2><ul>${rows}</ul></section>`;
    })
    .join("");
  return pageShell(
    "plans",
    `<h1>plans</h1>${sections || "<p>No plans found.</p>"}`,
  );
}

function testingRow(
  issue: IssueRecord,
  worktree: string | null,
  row: WorkstreamRow | undefined,
): string {
  const name = issue.frontmatter.workstream;
  const target = worktree
    ? `/${encodeURIComponent(worktree)}/test1/`
    : "/main/test1/";
  const reset = row?.boxState.testSetup ? actionForm("reset-test", row) : "";
  const confirm = worktree
    ? ""
    : `<form method="POST" action="/workstreams/action/confirm-tested/${encodeURIComponent(path.posix.basename(issue.relPath))}"><button type="submit">Confirm</button></form>`;
  return `<li><a href="${escapeHtml(issueHref(issue))}#manual-testing">${escapeHtml(issue.frontmatter.title)}</a><a href="/workstreams/${encodeURIComponent(name)}/">${escapeHtml(name)}</a><a href="${target}">${worktree ? "worktree test1" : "main test1"}</a><span class="actions">${row ? actionForm("resume", row) : ""}${reset}${confirm}</span></li>`;
}

function renderTesting(
  rows: WorkstreamRow[],
  documents: Awaited<ReturnType<WorkstreamsDeps["documents"]>>,
): string {
  const rowByName = new Map(rows.map((row) => [row.name, row]));
  const changedSlugs = new Set(
    (documents.worktreeTouchedSlugs ?? []).map((entry) => entry.slug),
  );
  const landed = documents.issues.filter(
    (issue) =>
      !changedSlugs.has(issue.slug) &&
      !issue.closed &&
      issue.frontmatter.needs.includes("manual-testing"),
  );
  const pending = (documents.worktreeIssues ?? []).filter(
    ({ issue }) =>
      !issue.closed && issue.frontmatter.needs.includes("manual-testing"),
  );
  const landedHtml = landed
    .map((issue) =>
      testingRow(issue, null, rowByName.get(issue.frontmatter.workstream)),
    )
    .join("");
  const pendingHtml = pending
    .map(({ worktree, issue }) =>
      testingRow(issue, worktree, rowByName.get(worktree)),
    )
    .join("");
  return pageShell(
    "testing",
    `<h1>manual testing</h1><section><h2>Landed, awaiting verification <small>${landed.length}</small></h2>${landedHtml ? `<ul>${landedHtml}</ul>` : "<p>Nothing waiting.</p>"}</section><section><h2>Pre-merge, testable in place <small>${pending.length}</small></h2>${pendingHtml ? `<ul>${pendingHtml}</ul>` : "<p>Nothing waiting.</p>"}</section>`,
  );
}

function searchHtml(
  query: string,
  rows: WorkstreamRow[],
  documents: { issues: IssueRecord[]; plans: PlanRecord[] },
): string {
  if (!query) return "";
  const needle = query.toLocaleLowerCase();
  const workstreams = rows.filter((row) =>
    row.name.toLocaleLowerCase().includes(needle),
  );
  const issues = documents.issues.filter((issue) =>
    issue.frontmatter.title.toLocaleLowerCase().includes(needle),
  );
  const plans = documents.plans.filter((plan) =>
    plan.title.toLocaleLowerCase().includes(needle),
  );
  const workstreamRows = workstreams
    .map((row) => rowHtml(row, row.path === null ? "culled" : row.agent.state))
    .join("");
  return `<section><h2>Search results</h2>${workstreamRows ? `<ul>${workstreamRows}</ul>` : ""}${documentList({ issues, plans }) || "<p>No matches.</p>"}</section>`;
}

export function renderWorkstreams(
  rows: WorkstreamRow[],
  flash = "",
  query = "",
  documents = { issues: [] as IssueRecord[], plans: [] as PlanRecord[] },
  quotas: AgentQuota[] = [],
  now = new Date(),
): string {
  const archived = rows
    .filter((row) => row.session.archived != null)
    .toSorted((a, b) =>
      (b.session.archived?.at ?? "").localeCompare(
        a.session.archived?.at ?? "",
      ),
    );
  const archivedNames = new Set(archived.map((row) => row.name));
  const current = rows.filter((row) => !archivedNames.has(row.name));
  const attached = current.filter((row) => row.path !== null);
  const held = attached.filter(
    (row) =>
      row.agent.state !== "live" &&
      (row.boxState.keepUnmerged || row.boxState.testSetup),
  );
  const heldNames = new Set(held.map((row) => row.name));
  const untouched = attached.filter(
    (row) =>
      !heldNames.has(row.name) &&
      row.agent.state !== "live" &&
      row.git?.dirty === 0 &&
      row.git.tip !== null &&
      row.git.tip === row.session.baseSha,
  );
  const untouchedNames = new Set(untouched.map((row) => row.name));
  const mergedOpen = attached.filter(
    (row) =>
      !heldNames.has(row.name) &&
      !untouchedNames.has(row.name) &&
      row.git?.merged === true &&
      (row.git.tip !== row.session.baseSha || row.git.dirty !== 0) &&
      row.agent.state === "live",
  );
  const excluded = new Set([
    ...heldNames,
    ...untouchedNames,
    ...mergedOpen.map((row) => row.name),
  ]);
  const inProgress = attached.filter((row) => !excluded.has(row.name));
  const removed = current.filter(
    (row) => row.path === null && row.session.removed !== null,
  );
  const culled = removed
    .filter((row) => row.session.removed?.merged === true)
    .sort((a, b) =>
      (b.session.removed?.at ?? "").localeCompare(a.session.removed?.at ?? ""),
    )
    .slice(0, 15);
  const forced = removed.filter((row) => row.session.removed?.merged === false);

  const body = [
    section({
      title: "In progress",
      rows: inProgress,
      documents,
      note: (row) =>
        row.agent.state === "live"
          ? "working"
          : row.agent.state === "unknown"
            ? "liveness unknown"
            : "session closed",
    }),
    section({
      title: "Merged ✓, session still open",
      rows: mergedOpen,
      documents,
      note: () => "close freely",
    }),
    section({
      title: "Untouched",
      rows: untouched,
      documents,
      note: () => "created, no work committed",
    }),
    section({
      title: "Held for testing",
      rows: held,
      documents,
      note: () => "worktree held for testing",
    }),
    section({
      title: "Recently culled",
      rows: culled,
      documents,
      note: (row) =>
        `removed ${relativeTime(row.session.removed?.at ?? "", now)}`,
    }),
    section({
      title: "Removed with unmerged work",
      rows: forced,
      documents,
      note: (row) =>
        `final ${row.session.removed?.finalSha?.slice(0, 10) ?? "SHA unavailable"}`,
    }),
    section({
      title: "Archived",
      rows: archived,
      documents,
      note: (row) =>
        `archived ${relativeTime(row.session.archived?.at ?? "", now)}`,
    }).replace("<ul>", '<ul class="archived-list">'),
  ].join("");

  const search = `<form class="search-form" role="search" method="GET" action="/workstreams/"><input type="search" name="q" value="${escapeHtml(query)}" aria-label="Search workstreams, issues, and plans" placeholder="Search workstreams, issues, and plans"><button type="submit">Search</button></form>`;
  return pageShell(
    "workstreams",
    `<header class="page-header"><div class="heading-row"><h1>workstreams</h1>${quotaHtml(quotas, now)}</div>${search}</header>${flash ? `<p class="flash">${escapeHtml(flash)}</p>` : ""}${searchHtml(query, rows, documents)}${body || "<p>No workstreams recorded.</p>"}`,
    true,
  );
}

function firstErrorLine(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "stderr" in error &&
    typeof error.stderr === "string"
  ) {
    const line = error.stderr.split("\n").find((part) => part.trim() !== "");
    if (line) return line;
  }
  return error instanceof Error
    ? (error.message.split("\n")[0] ?? "command failed")
    : String(error);
}

async function serveAction(
  pathname: string,
  deps: WorkstreamsDeps,
  res: http.ServerResponse,
): Promise<void> {
  const match = ACTION_PATH.exec(pathname);
  if (!match) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("unknown workstreams action\n");
    return;
  }
  const verb = match[1] as ActionVerb;
  const name = match[2] ?? "";
  const validTarget =
    verb === "confirm-tested"
      ? /^[a-zA-Z0-9_-]+\.md$/.test(name)
      : /^[a-zA-Z0-9_-]+$/.test(name);
  if (!validTarget) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("invalid workstreams action target\n");
    return;
  }
  let flash = `${verb} ${name}: done`;
  try {
    await deps.run(verb, name);
  } catch (error) {
    flash = `${verb} ${name}: ${firstErrorLine(error)}`;
  }
  res.writeHead(303, {
    location: `/workstreams/?flash=${encodeURIComponent(flash)}`,
  });
  res.end();
}

export async function serveWorkstreams(params: {
  method: string;
  pathname: string;
  repoRoot: string;
  mainRoot?: string;
  worktreesRoot?: string;
  res: http.ServerResponse;
  deps?: WorkstreamsDeps;
  flash?: string;
  query?: string;
}): Promise<void> {
  const { method, pathname, repoRoot, res } = params;
  const deps =
    params.deps ??
    defaultDeps(
      repoRoot,
      params.mainRoot ?? repoRoot,
      params.worktreesRoot ?? path.dirname(repoRoot),
    );
  if (method === "POST" && pathname.startsWith("/workstreams/action/")) {
    await serveAction(pathname, deps, res);
    return;
  }
  if (
    pathname === "/workstreams/issues" ||
    pathname.startsWith("/workstreams/issues/")
  ) {
    if (pathname === "/workstreams/issues") {
      res.writeHead(301, { location: "/workstreams/issues/" });
      res.end();
      return;
    }
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    await serveIssues({
      base: "/workstreams",
      mainRoot: params.mainRoot ?? repoRoot,
      worktreesRoot: params.worktreesRoot ?? path.dirname(repoRoot),
      rel: pathname.slice("/workstreams/issues".length),
      query: new URLSearchParams(params.query ?? ""),
      res,
    });
    return;
  }
  if (pathname === "/workstreams/plans" || pathname === "/workstreams/plans/") {
    if (pathname === "/workstreams/plans") {
      res.writeHead(301, { location: "/workstreams/plans/" });
      res.end();
      return;
    }
    const { plans } = await deps.documents();
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'",
    });
    res.end(method === "HEAD" ? undefined : renderPlans(plans));
    return;
  }
  if (
    pathname === "/workstreams/testing" ||
    pathname === "/workstreams/testing/"
  ) {
    if (pathname === "/workstreams/testing") {
      res.writeHead(301, { location: "/workstreams/testing/" });
      res.end();
      return;
    }
    const [rows, documents] = await Promise.all([
      deps.list(),
      deps.documents(),
    ]);
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'",
    });
    res.end(method === "HEAD" ? undefined : renderTesting(rows, documents));
    return;
  }
  const detailMatch = /^\/workstreams\/([\w-]+)\/$/.exec(pathname);
  if (detailMatch) {
    const name = detailMatch[1] ?? "";
    const [rows, documents] = await Promise.all([
      deps.list(),
      deps.documents(),
    ]);
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'",
    });
    res.end(
      method === "HEAD"
        ? undefined
        : renderDetail(
            name,
            rows.find((row) => row.name === name),
            {
              issues: issuesForWorkstream(documents, name),
              plans: documents.plans.filter((plan) => plan.workstream === name),
            },
          ),
    );
    return;
  }
  if (pathname === "/workstreams") {
    res.writeHead(301, { location: "/workstreams/" });
    res.end();
    return;
  }
  if (pathname !== "/workstreams/") {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("workstreams page not found\n");
    return;
  }
  try {
    const query =
      new URLSearchParams(params.query ?? "").get("q")?.trim() ?? "";
    const [rows, documents, quotas] = await Promise.all([
      deps.list(),
      deps.documents(),
      deps.quotas?.() ?? Promise.resolve([]),
    ]);
    const html = renderWorkstreams(
      rows,
      params.flash ?? "",
      query,
      documents,
      quotas,
    );
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'",
    });
    res.end(method === "HEAD" ? undefined : html);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`workstreams listing failed: ${message.split("\n")[0]}\n`);
  }
}
