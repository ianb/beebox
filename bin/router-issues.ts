// The /<worktree>/dev/issues/ space: a server-rendered browser over the
// monorepo-root issues/ tree (issues/CLAUDE.md is the data model), overlaid
// with what every active worktree has added/changed/deleted relative to
// main. Sibling to router-docs.ts, which dispatches into this module from
// serveDev — never import router.ts from here (router.ts -> router-docs.ts
// -> router-issues.ts is the one-way chain; see bin/CLAUDE.md).

import path from "node:path";
import fs from "node:fs/promises";
import type http from "node:http";
import { execa } from "execa";
import { escapeHtml, renderDevShell, devBreadcrumbs, renderMarkdownToHtml } from "./router-docs.js";

// --- data model (issues/CLAUDE.md) ------------------------------------------

const CATEGORIES = ["bugs", "features", "code-quality", "docs-and-chores", "decisions", "exploration"] as const;
type Category = (typeof CATEGORIES)[number];

export interface IssueFrontmatter {
  title: string;
  needs: string[];
  labels: string[];
  area?: string;
  filedBy?: string;
  discoveredIn?: string;
  resolution?: string;
  design?: string;
}

export type ResearchState = "none" | "awaiting" | "researched";

export interface IssueRecord {
  // Path relative to issues/, e.g. "bugs/2026-01-01-slug.md" or
  // "closed/bugs/2026-01-01-slug.md".
  relPath: string;
  category: string;
  closed: boolean;
  slug: string;
  frontmatter: IssueFrontmatter;
  research: ResearchState;
}

// --- hand-rolled frontmatter parser ------------------------------------------
// issues/ frontmatter is a small subset of YAML: `--- ... ---` delimiters,
// `key: value` scalars, quoted strings, flow lists (`[a, b]`), and block
// lists (`key:` then `- item` lines). No nesting, no multi-line scalars —
// deliberately minimal rather than pulling in a YAML dependency.

function unquote(s: string): string {
  // Double-quoted YAML: strip the delimiters AND unescape the backslash escapes
  // (\" \\ \n \t ...). Without the unescape, a title with inner quotes —
  // written as `title: "Agent \"give up\""` — renders every quote as a literal
  // `\"` on the page.
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s.slice(1, -1).replace(/\\(["\\/nt])/g, (_m, c: string) =>
      c === "n" ? "\n" : c === "t" ? "\t" : c);
  }
  // Single-quoted YAML: `''` is the escaped single quote.
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

export function parseFrontmatter(src: string): { data: Record<string, string | string[]>; body: string } {
  const lines = src.split("\n");
  if ((lines[0] ?? "").trim() !== "---") return { data: {}, body: src };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === "---") { end = i; break; }
  }
  if (end === -1) return { data: {}, body: src };

  const data: Record<string, string | string[]> = {};
  let blockKey: string | null = null;
  let blockItems: string[] | null = null;
  const flushBlock = () => {
    if (blockKey !== null && blockItems !== null) data[blockKey] = blockItems;
    blockKey = null;
    blockItems = null;
  };

  for (const line of lines.slice(1, end)) {
    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && blockKey !== null && blockItems !== null) {
      blockItems.push(unquote(listMatch[1]!.trim()));
      continue;
    }
    flushBlock();
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    const value = (rawValue ?? "").trim();
    if (value === "") {
      // No inline value — may be a block list on following lines. If it
      // isn't, flushBlock() above (on the next key) just drops it, which
      // matches YAML's "null" reading of an empty scalar.
      blockKey = key!;
      blockItems = [];
      continue;
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      data[key!] = inner === "" ? [] : inner.split(",").map((s) => unquote(s.trim()));
      continue;
    }
    data[key!] = unquote(value);
  }
  flushBlock();

  const body = lines.slice(end + 1).join("\n");
  return { data, body };
}

function asString(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asStringList(v: string | string[] | undefined): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

function detectResearchState(body: string): ResearchState {
  if (/^## Research \(incomplete\)/m.test(body)) return "awaiting";
  if (/^## Research \(\d{4}-\d{2}-\d{2}\)/m.test(body)) return "researched";
  return "none";
}

// Parse one issue file's contents into a record. `relPath` is e.g.
// "bugs/2026-01-01-slug.md" or "closed/bugs/2026-01-01-slug.md". Falls back
// to a filename-derived title when frontmatter has none (an older/stray
// file might use an H1 instead — see the caller for a real example) rather
// than dropping the issue from the browser entirely.
export function parseIssueFile(relPath: string, src: string): IssueRecord {
  const segments = relPath.split("/");
  const closed = segments[0] === "closed";
  const category = closed ? (segments[1] ?? "") : (segments[0] ?? "");
  const filename = segments[segments.length - 1] ?? relPath;
  const slug = filename.replace(/\.md$/, "");

  const { data, body } = parseFrontmatter(src);
  const h1 = body.match(/^#\s+(.+)$/m);
  const title = asString(data.title) ?? h1?.[1]?.trim() ?? slug;

  const area = asString(data.area);
  const filedBy = asString(data["filed-by"]);
  const discoveredIn = asString(data["discovered-in"]);
  const resolution = asString(data.resolution);
  const design = asString(data.design);
  return {
    relPath,
    category,
    closed,
    slug,
    frontmatter: {
      title,
      needs: asStringList(data.needs),
      labels: asStringList(data.labels),
      ...(area !== undefined ? { area } : {}),
      ...(filedBy !== undefined ? { filedBy } : {}),
      ...(discoveredIn !== undefined ? { discoveredIn } : {}),
      ...(resolution !== undefined ? { resolution } : {}),
      ...(design !== undefined ? { design } : {}),
    },
    research: detectResearchState(body),
  };
}

// --- enumerating the main checkout's issues/ tree ----------------------------

async function listMdFiles(dir: string): Promise<string[]> {
  try {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    return dirents.filter((d) => d.isFile() && d.name.endsWith(".md")).map((d) => d.name).sort();
  } catch {
    return [];
  }
}

// Enumerate every issue under `issuesRoot` (the tracked issues/ dir of the
// canonical checkout — always main's, per the caller). Only files that live
// in a recognized category subdir (or closed/<category>) count; a stray file
// sitting directly under issues/ (outside the documented category-dir
// convention) is invisible to the browser, matching the documented data
// model rather than guessing at ad hoc layouts.
export async function listIssues(issuesRoot: string): Promise<IssueRecord[]> {
  const records: IssueRecord[] = [];
  for (const category of CATEGORIES) {
    const dir = path.join(issuesRoot, category);
    for (const file of await listMdFiles(dir)) {
      const relPath = `${category}/${file}`;
      try {
        records.push(parseIssueFile(relPath, await fs.readFile(path.join(dir, file), "utf8")));
      } catch { /* unreadable — skip */ }
    }
    const closedDir = path.join(issuesRoot, "closed", category);
    for (const file of await listMdFiles(closedDir)) {
      const relPath = `closed/${category}/${file}`;
      try {
        records.push(parseIssueFile(relPath, await fs.readFile(path.join(closedDir, file), "utf8")));
      } catch { /* unreadable — skip */ }
    }
  }
  return records;
}

// --- cross-worktree overlay --------------------------------------------------

export type OverlayStatus = "added" | "modified" | "deleted" | "renamed";

export interface OverlayEntry {
  worktree: string;
  status: OverlayStatus;
  committed: boolean;
  oldPath?: string;
}

interface NameStatusRecord {
  code: "A" | "M" | "D" | "R";
  path: string;
  oldPath?: string;
}

// Parse `git diff --name-status -z` output. Renames (R###) carry two paths
// (old, new); everything else carries one. Copy (C###) is treated like a
// rename for overlay purposes (both a source and destination path exist).
export function parseNameStatusZ(stdout: string): NameStatusRecord[] {
  const tokens = stdout.split("\0").filter((t) => t.length > 0);
  const out: NameStatusRecord[] = [];
  let i = 0;
  while (i < tokens.length) {
    const code = tokens[i++];
    if (code === undefined) break;
    const letter = code[0];
    if (letter === "R" || letter === "C") {
      const oldPath = tokens[i++];
      const newPath = tokens[i++];
      if (oldPath !== undefined && newPath !== undefined) out.push({ code: "R", path: newPath, oldPath });
    } else if (letter === "A" || letter === "M" || letter === "D") {
      const p = tokens[i++];
      if (p !== undefined) out.push({ code: letter, path: p });
    } else {
      i++; // unrecognized status code — skip its path token defensively
    }
  }
  return out;
}

// Parse `git ls-files --others --exclude-standard -z` output (NUL-separated
// paths, no status codes).
export function parseNulPaths(stdout: string): string[] {
  return stdout.split("\0").filter((p) => p.length > 0);
}

function statusToOverlay(code: "A" | "M" | "D" | "R"): OverlayStatus {
  if (code === "A") return "added";
  if (code === "D") return "deleted";
  if (code === "R") return "renamed";
  return "modified";
}

function stripIssuesPrefix(p: string): string {
  return p.startsWith("issues/") ? p.slice("issues/".length) : p;
}

export interface OverlayResult {
  // issue relPath (relative to issues/, e.g. "bugs/foo.md") -> entries
  byPath: Map<string, OverlayEntry[]>;
  // worktree name -> its checkout root, for detail-page diffing
  worktreeRoots: Map<string, string>;
}

async function hasGitMarker(dir: string): Promise<boolean> {
  try {
    await fs.stat(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

// Enumerate active worktrees (any dir directly under worktreesRoot with a
// .git file/dir) and collect their issues/ overlay concurrently. A worktree
// whose git commands fail (mid-teardown, not actually a repo, etc.) is
// logged and skipped rather than failing the whole page.
export async function collectOverlay(worktreesRoot: string): Promise<OverlayResult> {
  const byPath = new Map<string, OverlayEntry[]>();
  const worktreeRoots = new Map<string, string>();
  let names: string[];
  try {
    const dirents = await fs.readdir(worktreesRoot, { withFileTypes: true });
    names = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return { byPath, worktreeRoots };
  }

  await Promise.all(names.map(async (name) => {
    const root = path.join(worktreesRoot, name);
    if (!(await hasGitMarker(root))) return;
    worktreeRoots.set(name, root);
    try {
      const entries = await worktreeIssueOverlayWithPaths(name, root);
      for (const [relPath, list] of entries) {
        const existing = byPath.get(relPath);
        if (existing) existing.push(...list);
        else byPath.set(relPath, list);
      }
    } catch (err) {
      console.error(`[issues] skipping worktree overlay for ${name}: ${(err as Error).message}`);
    }
  }));

  return { byPath, worktreeRoots };
}

// Like worktreeIssueOverlay but keyed by relPath (the shape collectOverlay
// actually needs) — kept separate so worktreeIssueOverlay's git-command
// parsing stays unit-testable against raw stdout without a filesystem.
async function worktreeIssueOverlayWithPaths(worktree: string, worktreeRoot: string): Promise<Map<string, OverlayEntry[]>> {
  const run = (args: string[]) => execa("git", args, { cwd: worktreeRoot });
  const [committed, uncommitted, untracked] = await Promise.all([
    run(["diff", "--name-status", "-z", "main...HEAD", "--", "issues/"]),
    run(["diff", "--name-status", "-z", "HEAD", "--", "issues/"]),
    run(["ls-files", "--others", "--exclude-standard", "-z", "--", "issues/*.md", "issues/**/*.md"]),
  ]);
  return mergeOverlaySources(worktree, committed.stdout, uncommitted.stdout, untracked.stdout);
}

// Pure merge step (unit-testable without spawning git): three raw git
// outputs -> per-relPath overlay entries.
export function mergeOverlaySources(
  worktree: string,
  committedNameStatusZ: string,
  uncommittedNameStatusZ: string,
  untrackedNulPaths: string,
): Map<string, OverlayEntry[]> {
  const out = new Map<string, OverlayEntry[]>();
  const add = (relPath: string, entry: OverlayEntry) => {
    const list = out.get(relPath);
    if (list) list.push(entry);
    else out.set(relPath, [entry]);
  };

  for (const rec of parseNameStatusZ(committedNameStatusZ)) {
    const relPath = stripIssuesPrefix(rec.path);
    const entry: OverlayEntry = { worktree, status: statusToOverlay(rec.code), committed: true };
    if (rec.oldPath) entry.oldPath = stripIssuesPrefix(rec.oldPath);
    add(relPath, entry);
    if (rec.code === "R" && rec.oldPath) add(stripIssuesPrefix(rec.oldPath), { ...entry });
  }
  for (const rec of parseNameStatusZ(uncommittedNameStatusZ)) {
    const relPath = stripIssuesPrefix(rec.path);
    const entry: OverlayEntry = { worktree, status: statusToOverlay(rec.code), committed: false };
    if (rec.oldPath) entry.oldPath = stripIssuesPrefix(rec.oldPath);
    add(relPath, entry);
    if (rec.code === "R" && rec.oldPath) add(stripIssuesPrefix(rec.oldPath), { ...entry });
  }
  for (const p of parseNulPaths(untrackedNulPaths)) {
    add(stripIssuesPrefix(p), { worktree, status: "added", committed: false });
  }
  return out;
}

// --- link rewriting -----------------------------------------------------------

// Rewrite relative markdown links to .md files (same-category `foo.md`,
// cross-category `../bugs/foo.md`) so they navigate within the issue
// browser instead of 404ing (the browser doesn't serve raw issues/ files).
// `dirPath` is the current issue's directory relative to issues/ (e.g.
// "bugs" or "closed/bugs"); `issuesBase` is like "/main/dev/issues".
// Absolute paths, external URLs, and anchors are left untouched.
export function rewriteIssueLinks(md: string, dirPath: string, issuesBase: string): string {
  return md.replace(/\]\(([^()\s]+)\)/g, (full: string, link: string) => {
    if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(link) || link.startsWith("/") || link.startsWith("#")) return full;
    const [target, anchor] = link.split("#");
    if (!target || !target.endsWith(".md")) return full;
    const resolved = path.posix.normalize(path.posix.join(dirPath, target));
    if (resolved.startsWith("..")) return full; // escapes issues/ — leave alone
    return `](${issuesBase}/${resolved}${anchor ? `#${anchor}` : ""})`;
  });
}

// --- UI: shared bits ----------------------------------------------------------

function facetChips(fr: IssueFrontmatter, research: ResearchState): string {
  const chips: string[] = [];
  for (const need of fr.needs) chips.push(`<span class="chip chip-needs">needs:${escapeHtml(need)}</span>`);
  for (const label of fr.labels) chips.push(`<span class="chip chip-label">${escapeHtml(label)}</span>`);
  if (fr.area) chips.push(`<span class="chip chip-area">${escapeHtml(fr.area)}</span>`);
  if (fr.filedBy) chips.push(`<span class="chip chip-filedby">filed:${escapeHtml(fr.filedBy)}</span>`);
  if (research === "awaiting") chips.push(`<span class="chip chip-research">awaiting research</span>`);
  else if (research === "researched") chips.push(`<span class="chip chip-research-done">researched</span>`);
  return chips.join("");
}

function worktreeBadges(entries: OverlayEntry[] | undefined): string {
  if (!entries || entries.length === 0) return "";
  // One badge per worktree, preferring the uncommitted (more current) entry
  // when both exist for that worktree.
  const byWorktree = new Map<string, OverlayEntry>();
  for (const e of entries) {
    const existing = byWorktree.get(e.worktree);
    if (!existing || (existing.committed && !e.committed)) byWorktree.set(e.worktree, e);
  }
  const marks: Record<OverlayStatus, string> = { added: "+", modified: "~", deleted: "−", renamed: "→" };
  return [...byWorktree.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([wt, e]) => `<span class="badge badge-${e.status}${e.committed ? "" : " uncommitted"}" title="${e.status}${e.committed ? "" : " (uncommitted)"} on ${escapeHtml(wt)}">${marks[e.status]}${escapeHtml(wt)}</span>`)
    .join("");
}

const ISSUES_CSS = `
  .filters { margin: 0 0 1.4em; font: 13px ui-monospace, Menlo, monospace; }
  .filters .chip { cursor: default; }
  .filters a.chip { cursor: pointer; }
  .filters .active { background: #2255aa; color: #fff; }
  .filters .clear { margin-left: 0.3em; color: #999; text-decoration: none; }
  .chip { display: inline-block; padding: 0.15em 0.55em; margin: 0.15em 0.3em 0.15em 0; border-radius: 10px; background: #eef1f5; color: #555; font-size: 0.85em; text-decoration: none; }
  .chip-research { background: #fdeee0; color: #a2380a; }
  .chip-research-done { background: #e6f4ea; color: #1e6b34; }
  .chip-label { background: #ece4fb; color: #5a34a8; }
  .badge { display: inline-block; padding: 0.1em 0.5em; margin: 0.15em 0.3em 0.15em 0; border-radius: 4px; font: 12px ui-monospace, Menlo, monospace; background: #f0f0f0; color: #444; }
  .badge-added { background: #e6f4ea; color: #1e6b34; }
  .badge-deleted { background: #fbe9e7; color: #a23522; }
  .badge-modified { background: #eef3fb; color: #2255aa; }
  .badge-renamed { background: #f3eefb; color: #6f42c1; }
  .badge.uncommitted { border: 1px dashed currentColor; }
  ul.issues { list-style: none; padding: 0; margin: 0 0 1.6em; border: 1px solid #e3e3e3; border-radius: 8px; overflow: hidden; }
  ul.issues li { display: flex; align-items: center; justify-content: space-between; gap: 1.2em; padding: 0.7em 1em; border-bottom: 1px solid #eee; }
  ul.issues li:last-child { border-bottom: none; }
  ul.issues li:hover { background: #f6f8fa; }
  ul.issues .issue-main { min-width: 0; }
  ul.issues a.title { display: block; font-weight: 600; text-decoration: none; color: #222; }
  ul.issues a.title:hover { color: #2255aa; text-decoration: underline; }
  ul.issues .meta { display: block; color: #888; font: 12px ui-monospace, Menlo, monospace; margin-top: 0.2em; }
  ul.issues .issue-pills { flex: 0 0 auto; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.2em; max-width: 45%; }
  ul.issues .issue-pills .chip, ul.issues .issue-pills .badge { font-size: 0.78em; opacity: 0.85; margin: 0; }
  h2.cat { display: flex; align-items: baseline; gap: 0.5em; font-weight: 500; color: #444; }
  h2.cat .count { color: #999; font-size: 0.7em; font-weight: 400; }
  details.closed-group summary { cursor: pointer; color: #888; margin: 0.6em 0; }
  details.closed-group ul.issues { margin-top: 0.5em; }
  table.facts { border-collapse: collapse; margin: 0.8em 0 1.4em; font-size: 0.92em; }
  table.facts th, table.facts td { border: 1px solid #ddd; padding: 0.35em 0.7em; text-align: left; }
  table.facts th { background: #f4f4f4; width: 9em; }
  .wt-diff { margin: 1.4em 0; }
  .wt-diff h3 { font: 13px ui-monospace, Menlo, monospace; color: #555; margin-bottom: 0.3em; }
  .wt-diff pre { font-size: 0.82em; }
  .diff-add { color: #1e6b34; } .diff-del { color: #a23522; }
`;

// --- UI: index ----------------------------------------------------------------

export interface Filters {
  category?: string;
  area?: string;
  needs?: string;
  labels?: string;
  research?: string;
  worktreeTouched: boolean;
  status: "open" | "closed" | "all";
}

export function parseFilters(query: URLSearchParams): Filters {
  const status = query.get("status");
  const category = query.get("category");
  const area = query.get("area");
  const needs = query.get("needs");
  const labels = query.get("labels");
  const research = query.get("research");
  return {
    ...(category !== null ? { category } : {}),
    ...(area !== null ? { area } : {}),
    ...(needs !== null ? { needs } : {}),
    ...(labels !== null ? { labels } : {}),
    ...(research !== null ? { research } : {}),
    worktreeTouched: query.get("worktree") === "touched",
    status: status === "closed" || status === "all" ? status : "open",
  };
}

export function matches(issue: IssueRecord, f: Filters, touched: boolean): boolean {
  if (f.category && issue.category !== f.category) return false;
  if (f.area && issue.frontmatter.area !== f.area) return false;
  if (f.needs && !issue.frontmatter.needs.includes(f.needs)) return false;
  if (f.labels && !issue.frontmatter.labels.includes(f.labels)) return false;
  if (f.research === "awaiting" && issue.research !== "awaiting") return false;
  if (f.worktreeTouched && !touched) return false;
  return true;
}

export interface IssueFacets {
  categories: string[];
  areas: string[];
  needs: string[];
  labels: string[];
}

// Derive the distinct facet values from a set of issues. Categories are the
// fixed taxonomy; areas/needs/labels are collected from frontmatter and sorted.
export function deriveFacets(issues: IssueRecord[]): IssueFacets {
  return {
    categories: [...CATEGORIES],
    areas: [...new Set(issues.map((i) => i.frontmatter.area).filter((a): a is string => !!a))].sort(),
    needs: [...new Set(issues.flatMap((i) => i.frontmatter.needs))].sort(),
    labels: [...new Set(issues.flatMap((i) => i.frontmatter.labels))].sort(),
  };
}

function filterChipsHtml(base: string, f: Filters, facets: IssueFacets): string {
  const qs = (overrides: Record<string, string | undefined>): string => {
    const p = new URLSearchParams();
    const merged = {
      category: f.category, area: f.area, needs: f.needs, labels: f.labels,
      research: f.research, worktree: f.worktreeTouched ? "touched" : undefined,
      status: f.status === "open" ? undefined : f.status,
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `${base}/issues/${s ? `?${s}` : ""}`;
  };
  const group = (label: string, key: keyof Filters, values: string[], active: string | undefined): string => {
    const items = values.map((v) =>
      `<a class="chip${active === v ? " active" : ""}" href="${qs({ [key]: active === v ? undefined : v })}">${escapeHtml(v)}</a>`,
    ).join("");
    return `<span>${escapeHtml(label)}: ${items}</span>`;
  };
  const statusGroup = (["open", "all", "closed"] as const).map((s) =>
    `<a class="chip${f.status === s ? " active" : ""}" href="${qs({ status: s === "open" ? undefined : s })}">${s}</a>`,
  ).join("");
  const researchChip = `<a class="chip${f.research === "awaiting" ? " active" : ""}" href="${qs({ research: f.research === "awaiting" ? undefined : "awaiting" })}">awaiting research</a>`;
  const worktreeChip = `<a class="chip${f.worktreeTouched ? " active" : ""}" href="${qs({ worktree: f.worktreeTouched ? undefined : "touched" })}">touched by any worktree</a>`;
  const anyActive = f.category || f.area || f.needs || f.labels || f.research || f.worktreeTouched || f.status !== "open";
  const clear = anyActive ? `<a class="clear" href="${base}/issues/">clear all ×</a>` : "";
  const labelsRow = facets.labels.length ? `<div>${group("labels", "labels", facets.labels, f.labels)}</div>` : "";
  return `<div class="filters">
    <div>status: ${statusGroup} ${researchChip} ${worktreeChip}${clear}</div>
    <div>${group("category", "category", facets.categories, f.category)}</div>
    <div>${group("area", "area", facets.areas, f.area)}</div>
    <div>${group("needs", "needs", facets.needs, f.needs)}</div>
    ${labelsRow}
  </div>`;
}

function issueRowHtml(base: string, issue: IssueRecord, overlay: OverlayEntry[] | undefined): string {
  const href = `${base}/issues/${issue.relPath}`;
  // The slug starts with the filing date, so "date · slug" would print the
  // date twice — split it into "date · rest-of-slug" instead.
  const date = issue.slug.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
  const shortSlug = date ? issue.slug.slice(date.length).replace(/^-/, "") : issue.slug;
  const pills = `${facetChips(issue.frontmatter, issue.research)}${worktreeBadges(overlay)}`;
  return `<li>
    <div class="issue-main">
      <a class="title" href="${href}">${escapeHtml(issue.frontmatter.title)}</a>
      <span class="meta">${escapeHtml(date)}${date && shortSlug ? " · " : ""}${escapeHtml(shortSlug)}</span>
    </div>
    <div class="issue-pills">${pills}</div>
  </li>`;
}

async function readWorktreeOnlyIssue(worktreeRoot: string, relPath: string): Promise<IssueRecord | null> {
  try {
    const src = await fs.readFile(path.join(worktreeRoot, "issues", relPath), "utf8");
    return parseIssueFile(relPath, src);
  } catch {
    return null;
  }
}

async function renderIssueIndex(base: string, mainIssuesRoot: string, worktreesRoot: string, query: URLSearchParams): Promise<string> {
  const [issues, overlay] = await Promise.all([listIssues(mainIssuesRoot), collectOverlay(worktreesRoot)]);
  const mainPaths = new Set(issues.map((i) => i.relPath));

  // Worktree-only issues: paths the overlay knows about (added somewhere)
  // that don't exist on main. Read their frontmatter from whichever
  // worktree has them (first one found).
  const worktreeOnly: Array<{ issue: IssueRecord; entries: OverlayEntry[] }> = [];
  for (const [relPath, entries] of overlay.byPath) {
    if (mainPaths.has(relPath)) continue;
    const addedFrom = entries.find((e) => e.status === "added" || e.status === "renamed");
    const root = addedFrom ? overlay.worktreeRoots.get(addedFrom.worktree) : undefined;
    if (!root) continue;
    const issue = await readWorktreeOnlyIssue(root, relPath);
    if (issue) worktreeOnly.push({ issue, entries });
  }

  const f = parseFilters(query);
  // Worktree-only issues honor the same filters as main's (they are all
  // touched-by-a-worktree by definition, so that predicate is always true).
  const worktreeOnlyVisible = worktreeOnly.filter(({ issue }) =>
    (f.status === "all" || (f.status === "closed" ? issue.closed : !issue.closed)) && matches(issue, f, true),
  );
  const facets = deriveFacets(issues);

  const statusFiltered = issues.filter((i) => f.status === "all" || (f.status === "closed" ? i.closed : !i.closed));
  const visible = statusFiltered.filter((i) => matches(i, f, overlay.byPath.has(i.relPath)));

  const byCategory = new Map<string, { open: IssueRecord[]; closed: IssueRecord[] }>();
  for (const cat of CATEGORIES) byCategory.set(cat, { open: [], closed: [] });
  for (const issue of visible) {
    const bucket = byCategory.get(issue.category);
    if (!bucket) continue;
    (issue.closed ? bucket.closed : bucket.open).push(issue);
  }

  const categoryHtml = CATEGORIES.map((cat) => {
    const bucket = byCategory.get(cat)!;
    if (bucket.open.length === 0 && bucket.closed.length === 0) return "";
    const openList = bucket.open.length
      ? `<ul class="issues">${bucket.open.map((i) => issueRowHtml(base, i, overlay.byPath.get(i.relPath))).join("")}</ul>`
      : `<p class="empty">no open items</p>`;
    const closedList = bucket.closed.length && f.status !== "closed"
      ? `<details class="closed-group"><summary>${bucket.closed.length} closed</summary><ul class="issues">${bucket.closed.map((i) => issueRowHtml(base, i, overlay.byPath.get(i.relPath))).join("")}</ul></details>`
      : (f.status === "closed" && bucket.closed.length
        ? `<ul class="issues">${bucket.closed.map((i) => issueRowHtml(base, i, overlay.byPath.get(i.relPath))).join("")}</ul>`
        : "");
    const count = f.status === "closed" ? bucket.closed.length : bucket.open.length;
    return `<h2 class="cat">${escapeHtml(cat)} <span class="count">${count}</span></h2>${f.status === "closed" ? closedList : openList}${f.status === "all" ? closedList : ""}`;
  }).join("");

  const worktreeOnlyHtml = worktreeOnlyVisible.length
    ? `<h2 class="cat">worktree-only <span class="count">${worktreeOnlyVisible.length}</span></h2>
       <p style="color:#888;font-size:0.85em;margin-top:0">Issues that exist only on a worktree, not yet on main.</p>
       <ul class="issues">${worktreeOnlyVisible.map(({ issue, entries }) => issueRowHtml(base, issue, entries)).join("")}</ul>`
    : "";

  const body = `<h1>issues</h1>
${filterChipsHtml(base, f, facets)}
${categoryHtml || `<p class="empty">no issues match these filters</p>`}
${worktreeOnlyHtml}`;
  return renderDevShell("issues", devBreadcrumbs(base, "issues"), body, ISSUES_CSS);
}

// --- UI: detail ----------------------------------------------------------------

function factsTableHtml(fr: IssueFrontmatter, research: ResearchState, closed: boolean): string {
  const rows: Array<[string, string]> = [];
  if (fr.needs.length) rows.push(["needs", fr.needs.join(", ")]);
  if (fr.labels.length) rows.push(["labels", fr.labels.join(", ")]);
  if (fr.area) rows.push(["area", fr.area]);
  if (fr.filedBy) rows.push(["filed-by", fr.filedBy]);
  if (fr.discoveredIn) rows.push(["discovered-in", fr.discoveredIn]);
  if (fr.design) rows.push(["design", fr.design]);
  if (closed && fr.resolution) rows.push(["resolution", fr.resolution]);
  rows.push(["research", research === "none" ? "—" : research]);
  if (!rows.length) return "";
  return `<table class="facts">${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}</table>`;
}

function escapeDiffLine(line: string): string {
  const escaped = escapeHtml(line);
  if (line.startsWith("+") && !line.startsWith("+++")) return `<span class="diff-add">${escaped}</span>`;
  if (line.startsWith("-") && !line.startsWith("---")) return `<span class="diff-del">${escaped}</span>`;
  return escaped;
}

async function worktreeDiffHtml(worktree: string, worktreeRoot: string, relPath: string): Promise<string> {
  const gitPath = `issues/${relPath}`;
  const sections: string[] = [];
  try {
    const { stdout } = await execa("git", ["diff", "main...HEAD", "--", gitPath], { cwd: worktreeRoot });
    if (stdout.trim()) sections.push(`<h3>${escapeHtml(worktree)} — committed since main</h3><pre>${stdout.split("\n").map(escapeDiffLine).join("\n")}</pre>`);
  } catch { /* skip */ }
  try {
    const { stdout } = await execa("git", ["diff", "HEAD", "--", gitPath], { cwd: worktreeRoot });
    if (stdout.trim()) sections.push(`<h3>${escapeHtml(worktree)} — uncommitted</h3><pre>${stdout.split("\n").map(escapeDiffLine).join("\n")}</pre>`);
  } catch { /* skip */ }
  return sections.join("");
}

async function renderIssueDetail(base: string, mainIssuesRoot: string, worktreesRoot: string, relPath: string, res: http.ServerResponse): Promise<void> {
  const resolved = path.resolve(mainIssuesRoot, relPath);
  if (!resolved.startsWith(mainIssuesRoot + path.sep) || !resolved.endsWith(".md")) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden\n");
    return;
  }

  const overlay = await collectOverlay(worktreesRoot);
  const dirPath = path.posix.dirname(relPath.split(path.sep).join("/"));
  const issuesBase = `${base}/issues`;

  let src: string;
  let worktreeOnlyLabel = "";
  try {
    src = await fs.readFile(resolved, "utf8");
  } catch {
    // Not on main — maybe a worktree-only issue.
    const entries = overlay.byPath.get(relPath);
    const addedFrom = entries?.find((e) => e.status === "added" || e.status === "renamed");
    const root = addedFrom ? overlay.worktreeRoots.get(addedFrom.worktree) : undefined;
    if (!root) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`not found: ${relPath}\n`);
      return;
    }
    try {
      src = await fs.readFile(path.join(root, "issues", relPath), "utf8");
      worktreeOnlyLabel = `<p style="color:#a2380a;font:13px ui-monospace,monospace">worktree-only — exists on <strong>${escapeHtml(addedFrom!.worktree)}</strong>, not on main</p>`;
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`not found: ${relPath}\n`);
      return;
    }
  }

  const issue = parseIssueFile(relPath, src);
  const rewritten = rewriteIssueLinks(src, dirPath, issuesBase);
  const { body } = parseFrontmatter(rewritten);
  const bodyHtml = renderMarkdownToHtml(body);

  const entries = overlay.byPath.get(relPath) ?? [];
  const byWorktree = new Map<string, OverlayEntry>();
  for (const e of entries) {
    const existing = byWorktree.get(e.worktree);
    if (!existing) byWorktree.set(e.worktree, e);
  }
  const diffSections = worktreeOnlyLabel
    ? []
    : await Promise.all([...byWorktree.keys()].map(async (wt) => {
        const root = overlay.worktreeRoots.get(wt);
        return root ? worktreeDiffHtml(wt, root, relPath) : "";
      }));
  const diffHtml = diffSections.filter(Boolean).length
    ? `<div class="wt-diff">${diffSections.join("")}</div>`
    : "";

  const html = `<h1>${escapeHtml(issue.frontmatter.title)}</h1>
${worktreeOnlyLabel}
${factsTableHtml(issue.frontmatter, issue.research, issue.closed)}
${bodyHtml}
${diffHtml}`;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(renderDevShell(issue.frontmatter.title, devBreadcrumbs(base, `issues/${relPath}`), html, ISSUES_CSS));
}

// --- dispatch -------------------------------------------------------------------

/**
 * Dispatch everything under /<name>/dev/issues/. `rel` is the URL after
 * "/issues" (e.g. "" | "/" | "/bugs/foo.md"); `query` is the parsed query
 * string. `mainRoot` is always the canonical checkout's root — the issue set
 * is main's regardless of which /<name>/dev/ prefix this request came
 * through — while `worktreesRoot` supplies the cross-worktree overlay.
 */
export async function serveIssues(params: {
  base: string;
  mainRoot: string;
  worktreesRoot: string;
  rel: string;
  query: URLSearchParams;
  res: http.ServerResponse;
}): Promise<void> {
  const { base, mainRoot, worktreesRoot, rel, query, res } = params;
  const mainIssuesRoot = path.join(mainRoot, "issues");

  if (rel === "" || rel === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(await renderIssueIndex(base, mainIssuesRoot, worktreesRoot, query));
    return;
  }

  // `rel` arrives already percent-decoded by serveDev — don't decode again
  // (a second pass would throw URIError on any literal "%" in a filename).
  const relPath = rel.replace(/^\//, "");
  await renderIssueDetail(base, mainIssuesRoot, worktreesRoot, relPath, res);
}
