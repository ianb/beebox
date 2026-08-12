// The /workstreams/issues/ space: a server-rendered browser over the
// monorepo-root issues/ tree (issues/CLAUDE.md is the data model), overlaid
// with what every active worktree has added/changed/deleted relative to
// main. Sibling to router-docs.ts, which dispatches into this module from
// serveDev — never import router.ts from here (router.ts -> router-docs.ts
// -> router-issues.ts is the one-way chain; see bin/CLAUDE.md).

import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import type http from "node:http";
import { execa } from "execa";
import {
  escapeHtml,
  renderDevShell,
  devBreadcrumbs,
  renderMarkdownToHtml,
} from "./router-docs.js";

// --- data model (issues/CLAUDE.md) ------------------------------------------

const CATEGORIES = [
  "bugs",
  "features",
  "code-quality",
  "docs-and-chores",
  "decisions",
  "exploration",
  "watch",
] as const;
const ISSUE_REL_RE =
  /^(?:closed\/)?(?:bugs|features|code-quality|docs-and-chores|decisions|exploration|watch)\/[^/]+\.md$/;
const PRIORITY_SCRIPT = `
document.addEventListener("submit", async (event) => {
  const form = event.target instanceof HTMLFormElement
    ? event.target.closest(".priority-controls form")
    : null;
  if (!form) return;
  event.preventDefault();
  const group = form.closest(".priority-controls");
  const row = form.closest("li");
  if (!group || !row) return;
  const buttons = [...group.querySelectorAll("button")];
  for (const button of buttons) button.disabled = true;
  row.querySelector(".priority-error")?.remove();
  try {
    const url = new URL(form.action);
    url.searchParams.set("format", "json");
    const response = await fetch(url, { method: "POST" });
    if (!response.ok) throw new Error((await response.text()).trim() || "Priority update failed");
    for (const button of buttons) {
      const active = button === form.querySelector("button");
      button.classList.toggle("active", active);
      button.setAttribute("aria-checked", String(active));
    }
    const selected = url.searchParams.get("priority");
    const filter = new URLSearchParams(location.search).get("priority");
    if (filter && filter !== selected) row.remove();
  } catch (error) {
    const message = document.createElement("span");
    message.className = "priority-error";
    message.setAttribute("role", "alert");
    message.textContent = error instanceof Error ? error.message : String(error);
    group.insertAdjacentElement("afterend", message);
  } finally {
    for (const button of buttons) button.disabled = false;
  }
});
`;
type Category = (typeof CATEGORIES)[number];
export type IssuePriority =
  | "important"
  | "normal"
  | "uncategorized"
  | "backlog";
const PRIORITY_ORDER: Record<IssuePriority, number> = {
  important: 0,
  normal: 1,
  uncategorized: 2,
  backlog: 3,
};

export interface IssueFrontmatter {
  title: string;
  workstream: string;
  needs: string[];
  labels: string[];
  priority: IssuePriority;
  area?: string;
  filedBy?: string;
  discoveredBy?: string;
  discoveredIn?: string;
  resolution?: string;
  design?: string;
}

export type ResearchState = "none" | "awaiting" | "researched";

// "public" is the tracked, source-available issues/ tree; "private" is the
// shadow repo mounted at private-issues/ (see
// callback-box/docs/implemented-plans/private-issues-shadow-repo.md section H). This is a
// RECORD field, not a path prefix — relPath stays issue-relative for both
// sources ("bugs/2026-08-01-foo.md"), so category/closed parsing in
// parseIssueFile never has to know which source it came from. Only URLs carry
// a `private/` prefix (addVisibilityPrefix/stripVisibilityPrefix below).
export type Visibility = "public" | "private";

export interface IssueRecord {
  // Path relative to issues/ (public) or private-issues/ (private) — e.g.
  // "bugs/2026-01-01-slug.md" or "closed/bugs/2026-01-01-slug.md" — for
  // BOTH sources.
  relPath: string;
  category: string;
  closed: boolean;
  slug: string;
  frontmatter: IssueFrontmatter;
  research: ResearchState;
  visibility: Visibility;
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
    return s
      .slice(1, -1)
      .replace(/\\(["\\/nt])/g, (_m, c: string) =>
        c === "n" ? "\n" : c === "t" ? "\t" : c,
      );
  }
  // Single-quoted YAML: `''` is the escaped single quote.
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

export function parseFrontmatter(src: string): {
  data: Record<string, string | string[]>;
  body: string;
} {
  const lines = src.split("\n");
  if ((lines[0] ?? "").trim() !== "---") return { data: {}, body: src };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === "---") {
      end = i;
      break;
    }
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
      data[key!] =
        inner === "" ? [] : inner.split(",").map((s) => unquote(s.trim()));
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
// "bugs/2026-01-01-slug.md" or "closed/bugs/2026-01-01-slug.md" — issue-
// relative regardless of `visibility` (omitted = "public"), so this parsing
// is identical for a private-repo file; the caller supplies which source it
// came from. Falls back to a filename-derived title when frontmatter has
// none (an older/stray file might use an H1 instead — see the caller for a
// real example) rather than dropping the issue from the browser entirely.
export function parseIssueFile(
  relPath: string,
  src: string,
  visibility?: Visibility,
): IssueRecord {
  const v = visibility ?? "public";
  const segments = relPath.split("/");
  const closed = segments[0] === "closed";
  const category = closed ? (segments[1] ?? "") : (segments[0] ?? "");
  const filename = segments[segments.length - 1] ?? relPath;
  const slug = filename.replace(/\.md$/, "");

  const { data, body } = parseFrontmatter(src);
  const h1 = body.match(/^#\s+(.+)$/m);
  const title = asString(data.title) ?? h1?.[1]?.trim() ?? slug;

  const area = asString(data.area);
  const priorityValue = asString(data.priority);
  const priority: IssuePriority =
    priorityValue === "important" ||
    priorityValue === "normal" ||
    priorityValue === "backlog"
      ? priorityValue
      : "uncategorized";
  const filedBy = asString(data["filed-by"]);
  const discoveredBy = asString(data["discovered-by"]);
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
      workstream: asString(data.workstream) ?? "unknown",
      needs: asStringList(data.needs),
      labels: asStringList(data.labels),
      priority,
      ...(area !== undefined ? { area } : {}),
      ...(filedBy !== undefined ? { filedBy } : {}),
      ...(discoveredBy !== undefined ? { discoveredBy } : {}),
      ...(discoveredIn !== undefined ? { discoveredIn } : {}),
      ...(resolution !== undefined ? { resolution } : {}),
      ...(design !== undefined ? { design } : {}),
    },
    research: detectResearchState(body),
    visibility: v,
  };
}

// --- enumerating the main checkout's issues/ tree ----------------------------

async function listMdFiles(dir: string): Promise<string[]> {
  try {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    return dirents
      .filter((d) => d.isFile() && d.name.endsWith(".md"))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

// Enumerate every issue under `issuesRoot` — the tracked issues/ dir of the
// canonical checkout for "public" (always main's, per the caller), or the
// private-issues/ symlink target for "private" (categories sit at ITS root,
// no issues/ prefix inside that repo — same category-dir shape either way,
// so this one function serves both). Only files that live in a recognized
// category subdir (or closed/<category>) count; a stray file sitting
// directly under the root (e.g. the private repo's README.md, outside the
// documented category-dir convention) is invisible to the browser, matching
// the documented data model rather than guessing at ad hoc layouts. An
// absent root (visibility "private" when the developer hasn't opted in)
// naturally yields zero records with no error — listMdFiles already treats
// a missing directory as empty.
export async function listIssues(
  issuesRoot: string,
  visibility?: Visibility,
): Promise<IssueRecord[]> {
  const v = visibility ?? "public";
  const records: IssueRecord[] = [];
  for (const category of CATEGORIES) {
    const dir = path.join(issuesRoot, category);
    for (const file of await listMdFiles(dir)) {
      const relPath = `${category}/${file}`;
      try {
        records.push(
          parseIssueFile(
            relPath,
            await fs.readFile(path.join(dir, file), "utf8"),
            v,
          ),
        );
      } catch {
        /* unreadable — skip */
      }
    }
    const closedDir = path.join(issuesRoot, "closed", category);
    for (const file of await listMdFiles(closedDir)) {
      const relPath = `closed/${category}/${file}`;
      try {
        records.push(
          parseIssueFile(
            relPath,
            await fs.readFile(path.join(closedDir, file), "utf8"),
            v,
          ),
        );
      } catch {
        /* unreadable — skip */
      }
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
      if (oldPath !== undefined && newPath !== undefined)
        out.push({ code: "R", path: newPath, oldPath });
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

// Pathspecs scoping a git command to exactly the recognized category dirs
// (and their closed/ mirrors), non-recursively into each — e.g.
// "bugs/*.md", "closed/bugs/*.md". Used for the PRIVATE overlay, whose
// categories sit at the private repo's root with no "issues/" prefix to
// scope by: without this, a root file like the private README.md would
// match a bare "*.md" pathspec and show up as a phantom issue.
function categoryPathspecs(): string[] {
  // :(glob) makes `*` stop at `/` (default pathspec `*` crosses directory
  // separators, which would admit nested files listIssues never enumerates —
  // phantom worktree-only records).
  return CATEGORIES.flatMap((cat) => [
    `:(glob)${cat}/*.md`,
    `:(glob)closed/${cat}/*.md`,
  ]);
}

export interface OverlayResult {
  // issue relPath (relative to issues/, e.g. "bugs/foo.md") -> entries, for
  // PUBLIC issues.
  byPath: Map<string, OverlayEntry[]>;
  // Same shape, for PRIVATE issues (relPath relative to private-issues/).
  // Kept as a separate map — never merged into byPath — so a public and a
  // private issue that happen to share a relPath can never cross-attribute
  // overlay badges.
  byPathPrivate: Map<string, OverlayEntry[]>;
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

function mergeInto(
  target: Map<string, OverlayEntry[]>,
  source: Map<string, OverlayEntry[]>,
): void {
  for (const [relPath, list] of source) {
    const existing = target.get(relPath);
    if (existing) existing.push(...list);
    else target.set(relPath, list);
  }
}

// Enumerate active worktrees (any dir directly under worktreesRoot with a
// .git file/dir) and collect their issues/ AND private-issues/ overlays
// concurrently. A worktree whose PUBLIC git commands fail (mid-teardown, not
// actually a repo, etc.) is logged and skipped rather than failing the whole
// page. The PRIVATE side is a soft dependency — most developers never opt
// in, so an absent mount or a failing private git command is skipped
// silently (see worktreePrivateOverlayWithPaths), never logged as if it were
// a real error.
export async function collectOverlay(
  worktreesRoot: string,
): Promise<OverlayResult> {
  const byPath = new Map<string, OverlayEntry[]>();
  const byPathPrivate = new Map<string, OverlayEntry[]>();
  const worktreeRoots = new Map<string, string>();
  let names: string[];
  try {
    const dirents = await fs.readdir(worktreesRoot, { withFileTypes: true });
    names = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return { byPath, byPathPrivate, worktreeRoots };
  }

  await Promise.all(
    names.map(async (name) => {
      const root = path.join(worktreesRoot, name);
      if (!(await hasGitMarker(root))) return;
      worktreeRoots.set(name, root);
      try {
        mergeInto(byPath, await worktreeIssueOverlayWithPaths(name, root));
      } catch (err) {
        console.error(
          `[issues] skipping worktree overlay for ${name}: ${(err as Error).message}`,
        );
      }
      try {
        mergeInto(
          byPathPrivate,
          await worktreePrivateOverlayWithPaths(name, root),
        );
      } catch {
        /* no private mount, or its git commands failed — soft dependency, stays silent */
      }
    }),
  );

  return { byPath, byPathPrivate, worktreeRoots };
}

// Like worktreeIssueOverlay but keyed by relPath (the shape collectOverlay
// actually needs) — kept separate so worktreeIssueOverlay's git-command
// parsing stays unit-testable against raw stdout without a filesystem.
async function worktreeIssueOverlayWithPaths(
  worktree: string,
  worktreeRoot: string,
): Promise<Map<string, OverlayEntry[]>> {
  const run = (args: string[]) => execa("git", args, { cwd: worktreeRoot });
  const [committed, uncommitted, untracked] = await Promise.all([
    run(["diff", "--name-status", "-z", "main...HEAD", "--", "issues/"]),
    run(["diff", "--name-status", "-z", "HEAD", "--", "issues/"]),
    run([
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      "issues/*.md",
      "issues/**/*.md",
    ]),
  ]);
  return mergeOverlaySources(
    worktree,
    committed.stdout,
    uncommitted.stdout,
    untracked.stdout,
  );
}

// Like worktreeIssueOverlayWithPaths, but for the PRIVATE mount at
// <worktreeRoot>/private-issues — a symlink to a private git worktree that
// may not exist (developer hasn't opted in). Its categories sit at the
// private repo's ROOT, not under an issues/ prefix, so pathspecs are scoped
// to the recognized category dirs directly (categoryPathspecs()) rather than
// the "issues/" prefix the public overlay uses — without that scoping, a
// root file like the private repo's README.md would match and show up as a
// phantom issue. Paths git returns are already root-relative with no
// "issues/" prefix, so mergeOverlaySources's stripIssuesPrefix is a no-op
// for them (it only strips when the prefix is actually present) — no
// separate merge step needed. An absent mount returns an empty map rather
// than attempting (and failing) a git command against it.
async function worktreePrivateOverlayWithPaths(
  worktree: string,
  worktreeRoot: string,
): Promise<Map<string, OverlayEntry[]>> {
  const privateRoot = path.join(worktreeRoot, "private-issues");
  if (!(await hasGitMarker(privateRoot))) return new Map();
  const pathspecs = categoryPathspecs();
  const run = (args: string[]) => execa("git", args, { cwd: privateRoot });
  const [committed, uncommitted, untracked] = await Promise.all([
    run(["diff", "--name-status", "-z", "main...HEAD", "--", ...pathspecs]),
    run(["diff", "--name-status", "-z", "HEAD", "--", ...pathspecs]),
    run([
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...pathspecs,
    ]),
  ]);
  return mergeOverlaySources(
    worktree,
    committed.stdout,
    uncommitted.stdout,
    untracked.stdout,
  );
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
    const entry: OverlayEntry = {
      worktree,
      status: statusToOverlay(rec.code),
      committed: true,
    };
    if (rec.oldPath) entry.oldPath = stripIssuesPrefix(rec.oldPath);
    add(relPath, entry);
    if (rec.code === "R" && rec.oldPath)
      add(stripIssuesPrefix(rec.oldPath), { ...entry });
  }
  for (const rec of parseNameStatusZ(uncommittedNameStatusZ)) {
    const relPath = stripIssuesPrefix(rec.path);
    const entry: OverlayEntry = {
      worktree,
      status: statusToOverlay(rec.code),
      committed: false,
    };
    if (rec.oldPath) entry.oldPath = stripIssuesPrefix(rec.oldPath);
    add(relPath, entry);
    if (rec.code === "R" && rec.oldPath)
      add(stripIssuesPrefix(rec.oldPath), { ...entry });
  }
  for (const p of parseNulPaths(untrackedNulPaths)) {
    add(stripIssuesPrefix(p), { worktree, status: "added", committed: false });
  }
  return out;
}

// --- link rewriting -----------------------------------------------------------

export interface RewrittenIssueLinks {
  md: string;
  // hrefs — exactly as they'll appear in the rendered <a href="..."> — that
  // point at a closed issue. Fed to appendClosedIssuePills to mark them.
  closedHrefs: Set<string>;
}

// Rewrite relative markdown links to .md files (same-category `foo.md`,
// cross-category `../bugs/foo.md`) so they navigate within the issue
// browser instead of 404ing (the browser doesn't serve raw issues/ files).
// `dirPath` is the current issue's directory relative to issues/ (e.g.
// "bugs" or "closed/bugs"); `issuesBase` is like "/workstreams/issues".
// Absolute paths, external URLs, and anchors are left untouched. Also
// collects which of the rewritten hrefs land under closed/ (a link whose
// target is a closed issue), so the caller can pill them.
export function rewriteIssueLinks(
  md: string,
  dirPath: string,
  issuesBase: string,
): RewrittenIssueLinks {
  const closedHrefs = new Set<string>();
  const out = md.replace(/\]\(([^()\s]+)\)/g, (full: string, link: string) => {
    if (
      /^([a-z][a-z0-9+.-]*:)?\/\//i.test(link) ||
      link.startsWith("/") ||
      link.startsWith("#")
    )
      return full;
    const [target, anchor] = link.split("#");
    if (!target || !target.endsWith(".md")) return full;
    const resolved = path.posix.normalize(path.posix.join(dirPath, target));
    if (resolved.startsWith("..")) return full; // escapes issues/ — leave alone
    const href = `${issuesBase}/${resolved}${anchor ? `#${anchor}` : ""}`;
    if (resolved === "closed" || resolved.startsWith("closed/"))
      closedHrefs.add(href);
    return `](${href})`;
  });
  return { md: out, closedHrefs };
}

// Like rewriteIssueLinks's closed-detection, but for arbitrary repo markdown
// (the /dev/docs browser) where links to issues/ files are never rewritten
// to browser routes — the original link text IS the href that ends up in
// the rendered HTML. `docDirRel` is the doc's directory relative to the
// repo root (posix-style; "." for a repo-root file, which
// path.posix.join/normalize handle natively).
export function findClosedIssueLinkHrefs(
  md: string,
  docDirRel: string,
): Set<string> {
  const closedHrefs = new Set<string>();
  for (const m of md.matchAll(/\]\(([^()\s]+)\)/g)) {
    const link = m[1]!;
    if (
      /^([a-z][a-z0-9+.-]*:)?\/\//i.test(link) ||
      link.startsWith("/") ||
      link.startsWith("#")
    )
      continue;
    const [target] = link.split("#");
    if (!target || !target.endsWith(".md")) continue;
    const resolved = path.posix.normalize(path.posix.join(docDirRel, target));
    if (resolved === "issues/closed" || resolved.startsWith("issues/closed/"))
      closedHrefs.add(link);
  }
  return closedHrefs;
}

// Post-process rendered HTML to append a small muted "closed" pill right
// after any <a> whose href is in `closedHrefs`. Runs on the final HTML
// (after Markdoc + highlighting + autolinking) rather than on the markdown
// source, so it only has to match against a plain attribute string — no
// need to re-parse markdown link syntax or dodge code/pre blocks (an <a>
// tag never appears inside one). `closedHrefs` holds raw href text; this
// escapes each one the same way Markdoc escapes the rendered attribute
// before comparing.
export function appendClosedIssuePills(
  html: string,
  closedHrefs: ReadonlySet<string>,
): string {
  if (closedHrefs.size === 0) return html;
  const escaped = new Set([...closedHrefs].map(escapeHtml));
  return html.replace(
    /<a\b[^>]*\bhref="([^"]*)"[^>]*>[\s\S]*?<\/a>/g,
    (tag: string, href: string) =>
      escaped.has(href)
        ? `${tag}<span class="chip chip-closed-link">closed</span>`
        : tag,
  );
}

// --- URL visibility prefix ------------------------------------------------------
// The record model never encodes privacy in relPath (see IssueRecord) — only
// URLs do, via a "private/" segment right after "/issues". These two
// functions are the one place that adds/strips it, operating on the URL-rel
// string (no leading slash, no "/issues" prefix) so callers can round-trip
// through them instead of hand-building the prefix.

export function addVisibilityPrefix(
  relPath: string,
  visibility: Visibility,
): string {
  return visibility === "private" ? `private/${relPath}` : relPath;
}

export function stripVisibilityPrefix(urlRel: string): {
  visibility: Visibility;
  relPath: string;
} {
  if (urlRel === "private" || urlRel.startsWith("private/")) {
    return { visibility: "private", relPath: urlRel.slice("private/".length) };
  }
  return { visibility: "public", relPath: urlRel };
}

// The issues-space base for a given visibility — what dirPath-relative links
// inside an issue's markdown resolve against (rewriteIssueLinks' issuesBase).
function issuesBaseFor(base: string, visibility: Visibility): string {
  return visibility === "private" ? `${base}/issues/private` : `${base}/issues`;
}

function issueDetailHref(
  base: string,
  issue: Pick<IssueRecord, "relPath" | "visibility">,
): string {
  return `${base}/issues/${addVisibilityPrefix(issue.relPath, issue.visibility)}`;
}

// The right overlay map for an issue's visibility — never cross the two, so
// a public and private issue sharing a relPath can't attribute badges to
// each other.
function overlayEntriesFor(
  overlay: OverlayResult,
  issue: Pick<IssueRecord, "relPath" | "visibility">,
): OverlayEntry[] | undefined {
  return (
    issue.visibility === "private" ? overlay.byPathPrivate : overlay.byPath
  ).get(issue.relPath);
}

// --- UI: shared bits ----------------------------------------------------------

function facetChips(
  fr: IssueFrontmatter,
  research: ResearchState,
  visibility: Visibility,
): string {
  const chips: string[] = [];
  if (visibility === "private")
    chips.push(`<span class="chip chip-private">private</span>`);
  for (const need of fr.needs)
    chips.push(
      `<span class="chip chip-needs">needs:${escapeHtml(need)}</span>`,
    );
  for (const label of fr.labels)
    chips.push(`<span class="chip chip-label">${escapeHtml(label)}</span>`);
  if (fr.area)
    chips.push(`<span class="chip chip-area">${escapeHtml(fr.area)}</span>`);
  if (fr.filedBy)
    chips.push(
      `<span class="chip chip-filedby">filed:${escapeHtml(fr.filedBy)}</span>`,
    );
  if (fr.discoveredBy)
    chips.push(
      `<span class="chip chip-discoveredby">discovered:${escapeHtml(fr.discoveredBy)}</span>`,
    );
  if (research === "awaiting")
    chips.push(`<span class="chip chip-research">awaiting research</span>`);
  else if (research === "researched")
    chips.push(`<span class="chip chip-research-done">researched</span>`);
  return chips.join("");
}

function worktreeBadges(entries: OverlayEntry[] | undefined): string {
  if (!entries || entries.length === 0) return "";
  // One badge per worktree, preferring the uncommitted (more current) entry
  // when both exist for that worktree.
  const byWorktree = new Map<string, OverlayEntry>();
  for (const e of entries) {
    const existing = byWorktree.get(e.worktree);
    if (!existing || (existing.committed && !e.committed))
      byWorktree.set(e.worktree, e);
  }
  const marks: Record<OverlayStatus, string> = {
    added: "+",
    modified: "~",
    deleted: "−",
    renamed: "→",
  };
  return [...byWorktree.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([wt, e]) =>
        `<span class="badge badge-${e.status}${e.committed ? "" : " uncommitted"}" title="${e.status}${e.committed ? "" : " (uncommitted)"} on ${escapeHtml(wt)}">${marks[e.status]}${escapeHtml(wt)}</span>`,
    )
    .join("");
}

const ISSUES_CSS = `
  .filters { margin: 0 0 1.4em; font: 13px ui-monospace, Menlo, monospace; }
  .filters .chip { cursor: default; }
  .filters a.chip { cursor: pointer; }
  .filters .active { background: #2255aa; color: #fff; }
  .filters .clear { margin-left: 0.3em; color: #999; text-decoration: none; }
  .chip { display: inline-block; padding: 0.15em 0.55em; margin: 0.15em 0.3em 0.15em 0; border-radius: 10px; background: #eef1f5; color: #555; font-size: 0.85em; text-decoration: none; }
  .chip-closed-link { margin: 0 0 0 0.4em; font-size: 0.78em; }
  .chip-private { background: #eee; color: #666; border: 1px dashed #bbb; }
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
  ul.issues .issue-controls { flex: 0 0 auto; display: flex; align-items: center; justify-content: flex-end; gap: 0.7em; max-width: 58%; }
  .priority-controls { display: flex; flex: 0 0 auto; }
  .priority-controls form { margin: 0; }
  .priority-controls button { padding: 0.2em 0.45em; border: 1px solid #bbc2ca; border-right-width: 0; background: #fff; color: #555; font: 11px ui-monospace, Menlo, monospace; cursor: pointer; }
  .priority-controls form:first-child button { border-radius: 4px 0 0 4px; }
  .priority-controls form:last-child button { border-right-width: 1px; border-radius: 0 4px 4px 0; }
  .priority-controls button.active { background: #2255aa; color: #fff; font-weight: 700; }
  .priority-target { display: block; margin-top: 0.15em; color: #888; font: 10px ui-monospace, Menlo, monospace; text-align: right; }
  .priority-error { display: block; max-width: 22em; margin-top: 0.2em; color: #a23522; font-size: 0.8em; }
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
  @media (max-width: 700px) {
    ul.issues li { align-items: flex-start; flex-direction: column; gap: 0.55em; }
    ul.issues .issue-controls { align-items: flex-start; flex-direction: column; max-width: 100%; }
    ul.issues .issue-pills { justify-content: flex-start; max-width: 100%; }
    .priority-target { text-align: left; }
  }
`;

// --- UI: index ----------------------------------------------------------------

export interface Filters {
  category?: string;
  area?: string;
  needs?: string;
  labels?: string;
  priority?: string;
  research?: string;
  visibility?: Visibility;
  assigned: boolean;
  unassigned: boolean;
  worktreeTouched: boolean;
  status: "open" | "closed" | "all";
}

export function parseFilters(query: URLSearchParams): Filters {
  const status = query.get("status");
  const category = query.get("category");
  const area = query.get("area");
  const needs = query.get("needs");
  const labels = query.get("labels");
  const priority = query.get("priority");
  const research = query.get("research");
  const visibility = query.get("visibility");
  return {
    ...(category !== null ? { category } : {}),
    ...(area !== null ? { area } : {}),
    ...(needs !== null ? { needs } : {}),
    ...(labels !== null ? { labels } : {}),
    ...(priority !== null ? { priority } : {}),
    ...(research !== null ? { research } : {}),
    ...(visibility === "public" || visibility === "private"
      ? { visibility }
      : {}),
    assigned: query.get("assigned") === "true",
    unassigned: query.get("assigned") === "false",
    worktreeTouched: query.get("worktree") === "touched",
    status: status === "closed" || status === "all" ? status : "open",
  };
}

export function matches(
  issue: IssueRecord,
  f: Filters,
  touched: boolean,
): boolean {
  if (f.category && issue.category !== f.category) return false;
  if (f.area && issue.frontmatter.area !== f.area) return false;
  if (f.needs && !issue.frontmatter.needs.includes(f.needs)) return false;
  if (f.labels && !issue.frontmatter.labels.includes(f.labels)) return false;
  if (f.priority && issue.frontmatter.priority !== f.priority) return false;
  if (f.research === "awaiting" && issue.research !== "awaiting") return false;
  if (f.visibility && issue.visibility !== f.visibility) return false;
  if (
    f.assigned &&
    (issue.frontmatter.workstream === "unattached" ||
      issue.frontmatter.workstream === "unknown")
  )
    return false;
  if (
    f.unassigned &&
    issue.frontmatter.workstream !== "unattached" &&
    issue.frontmatter.workstream !== "unknown"
  )
    return false;
  if (f.worktreeTouched && !touched) return false;
  return true;
}

export function compareIssuePriority(a: IssueRecord, b: IssueRecord): number {
  return (
    PRIORITY_ORDER[a.frontmatter.priority] -
    PRIORITY_ORDER[b.frontmatter.priority]
  );
}

export function setIssuePriority(
  source: string,
  priority: IssuePriority,
): string {
  const opening = /^(?:\uFEFF)?---[ \t]*(\r?\n)/.exec(source);
  if (!opening) throw new Error("issue has no writable YAML frontmatter");
  const newline = opening[1] ?? "\n";
  const closing = /^---[ \t]*\r?$/gm;
  closing.lastIndex = opening[0].length;
  const end = closing.exec(source)?.index;
  if (end === undefined)
    throw new Error("issue has no writable YAML frontmatter");
  const priorityLine = /^priority:[^\r\n]*(?:\r?\n)?/m;
  if (priority === "uncategorized") return source.replace(priorityLine, "");
  const line = `priority: ${priority}`;
  if (priorityLine.test(source))
    return source.replace(priorityLine, `${line}${newline}`);
  return `${source.slice(0, end)}${line}${newline}${source.slice(end)}`;
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
    areas: [
      ...new Set(
        issues.map((i) => i.frontmatter.area).filter((a): a is string => !!a),
      ),
    ].sort(),
    needs: [...new Set(issues.flatMap((i) => i.frontmatter.needs))].sort(),
    labels: [...new Set(issues.flatMap((i) => i.frontmatter.labels))].sort(),
  };
}

function filterChipsHtml(
  base: string,
  f: Filters,
  facets: IssueFacets,
): string {
  const qs = (overrides: Record<string, string | undefined>): string => {
    const p = new URLSearchParams();
    const merged = {
      category: f.category,
      area: f.area,
      needs: f.needs,
      labels: f.labels,
      priority: f.priority,
      research: f.research,
      visibility: f.visibility,
      worktree: f.worktreeTouched ? "touched" : undefined,
      assigned: f.assigned ? "true" : f.unassigned ? "false" : undefined,
      status: f.status === "open" ? undefined : f.status,
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `${base}/issues/${s ? `?${s}` : ""}`;
  };
  const group = (
    label: string,
    key: keyof Filters,
    values: string[],
    active: string | undefined,
  ): string => {
    const items = values
      .map(
        (v) =>
          `<a class="chip${active === v ? " active" : ""}" href="${qs({ [key]: active === v ? undefined : v })}">${escapeHtml(v)}</a>`,
      )
      .join("");
    return `<span>${escapeHtml(label)}: ${items}</span>`;
  };
  const statusGroup = (["open", "all", "closed"] as const)
    .map(
      (s) =>
        `<a class="chip${f.status === s ? " active" : ""}" href="${qs({ status: s === "open" ? undefined : s })}">${s}</a>`,
    )
    .join("");
  const researchChip = `<a class="chip${f.research === "awaiting" ? " active" : ""}" href="${qs({ research: f.research === "awaiting" ? undefined : "awaiting" })}">awaiting research</a>`;
  const worktreeChip = `<a class="chip${f.worktreeTouched ? " active" : ""}" href="${qs({ worktree: f.worktreeTouched ? undefined : "touched" })}">touched by any worktree</a>`;
  const assignedChip = `<a class="chip${f.assigned ? " active" : ""}" href="${qs({ assigned: f.assigned ? undefined : "true" })}">assigned to a workstream</a>`;
  const unassignedChip = `<a class="chip${f.unassigned ? " active" : ""}" href="${qs({ assigned: f.unassigned ? undefined : "false" })}">unassigned</a>`;
  const visibilityGroup = (["public", "private"] as const)
    .map(
      (v) =>
        `<a class="chip${f.visibility === v ? " active" : ""}" href="${qs({ visibility: f.visibility === v ? undefined : v })}">${v}</a>`,
    )
    .join("");
  const anyActive =
    f.category ||
    f.area ||
    f.needs ||
    f.labels ||
    f.priority ||
    f.research ||
    f.visibility ||
    f.assigned ||
    f.unassigned ||
    f.worktreeTouched ||
    f.status !== "open";
  const clear = anyActive
    ? `<a class="clear" href="${base}/issues/">clear all ×</a>`
    : "";
  const labelsRow = facets.labels.length
    ? `<div>${group("labels", "labels", facets.labels, f.labels)}</div>`
    : "";
  return `<div class="filters">
    <div>status: ${statusGroup} ${researchChip} ${assignedChip} ${unassignedChip} ${worktreeChip}${clear}</div>
    <div>${group("priority", "priority", ["important", "normal", "uncategorized", "backlog"], f.priority)}</div>
    <div>visibility: ${visibilityGroup}</div>
    <div>${group("category", "category", facets.categories, f.category)}</div>
    <div>${group("area", "area", facets.areas, f.area)}</div>
    <div>${group("needs", "needs", facets.needs, f.needs)}</div>
    ${labelsRow}
  </div>`;
}

function issueRowHtml(
  base: string,
  issue: IssueRecord,
  overlay: OverlayEntry[] | undefined,
  returnQuery: string,
): string {
  const href = issueDetailHref(base, issue);
  // The slug starts with the filing date, so "date · slug" would print the
  // date twice — split it into "date · rest-of-slug" instead.
  const date = issue.slug.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
  const shortSlug = date
    ? issue.slug.slice(date.length).replace(/^-/, "")
    : issue.slug;
  const workstream = `<a class="chip" href="/workstreams/${encodeURIComponent(issue.frontmatter.workstream)}/">${escapeHtml(issue.frontmatter.workstream)}</a>`;
  const pills = `${workstream}${facetChips(issue.frontmatter, issue.research, issue.visibility)}${worktreeBadges(overlay)}`;
  const editWorktrees = [
    ...new Set((overlay ?? []).map((entry) => entry.worktree)),
  ].toSorted();
  const editWorktree =
    editWorktrees.find(
      (worktree) => worktree === issue.frontmatter.workstream,
    ) ?? editWorktrees[0];
  const editTarget = editWorktree ? `worktree ${editWorktree}` : "main";
  const editTargetHtml = editWorktree
    ? `<span class="priority-target">saves to worktree ${escapeHtml(editWorktree)}</span>`
    : "";
  const priorityControls = (
    ["important", "normal", "backlog", "uncategorized"] as const
  )
    .map((priority) => {
      const active = issue.frontmatter.priority === priority;
      const label = priority[0]!.toUpperCase() + priority.slice(1);
      const action = `${base}/issues/action/priority?visibility=${issue.visibility}&amp;issue=${encodeURIComponent(issue.relPath)}&amp;priority=${priority}${returnQuery ? `&amp;return=${encodeURIComponent(returnQuery)}` : ""}`;
      return `<form method="POST" action="${action}"><button type="submit" role="radio" aria-checked="${active ? "true" : "false"}"${active ? ' class="active"' : ""}>${label}</button></form>`;
    })
    .join("");
  return `<li>
    <div class="issue-main">
      <a class="title" href="${href}">${escapeHtml(issue.frontmatter.title)}</a>
      <span class="meta">${escapeHtml(date)}${date && shortSlug ? " · " : ""}${escapeHtml(shortSlug)}</span>
    </div>
    <div class="issue-controls"><div><div class="priority-controls" role="radiogroup" aria-label="Priority for ${escapeHtml(issue.frontmatter.title)}; saves to ${escapeHtml(editTarget)}">${priorityControls}</div>${editTargetHtml}</div><div class="issue-pills">${pills}</div></div>
  </li>`;
}

// worktreeRoot is the WORKTREE checkout root; the visibility-appropriate
// subdirectory (issues/ or private-issues/) is joined here so callers never
// hand-build that path.
async function readWorktreeOnlyIssue(
  worktreeRoot: string,
  relPath: string,
  visibility: Visibility,
): Promise<IssueRecord | null> {
  const dir =
    visibility === "private"
      ? path.join(worktreeRoot, "private-issues")
      : path.join(worktreeRoot, "issues");
  try {
    const src = await fs.readFile(path.join(dir, relPath), "utf8");
    return parseIssueFile(relPath, src, visibility);
  } catch {
    return null;
  }
}

async function authoritativeOverlayIssues(
  main: IssueRecord[],
  overlayByPath: Map<string, OverlayEntry[]>,
  worktreeRoots: Map<string, string>,
  visibility: Visibility,
): Promise<IssueRecord[]> {
  const touchedSlugs = new Set<string>();
  const candidates = new Map<
    string,
    Array<{ issue: IssueRecord; worktree: string }>
  >();
  for (const [relPath, entries] of overlayByPath) {
    const slug = path.posix.basename(relPath, ".md");
    for (const worktree of new Set(entries.map((entry) => entry.worktree))) {
      const root = worktreeRoots.get(worktree);
      if (!root) continue;
      const issue = await readWorktreeOnlyIssue(root, relPath, visibility);
      if (!issue) continue;
      touchedSlugs.add(slug);
      const records = candidates.get(slug) ?? [];
      records.push({ issue, worktree });
      candidates.set(slug, records);
    }
  }
  const selected = [...candidates.values()].map(
    (records) => preferredIssueCandidate(records)!.issue,
  );
  return [
    ...main.filter((issue) => !touchedSlugs.has(issue.slug)),
    ...selected,
  ];
}

function preferredIssueCandidate<
  T extends { issue: IssueRecord; worktree: string },
>(records: T[]): T | undefined {
  const sorted = records.toSorted((a, b) =>
    a.worktree.localeCompare(b.worktree),
  );
  return (
    sorted.find(
      ({ issue, worktree }) => issue.frontmatter.workstream === worktree,
    ) ?? sorted[0]
  );
}

async function renderIssueIndex(
  base: string,
  roots: { mainIssuesRoot: string; mainPrivateRoot: string },
  worktreesRoot: string,
  query: URLSearchParams,
): Promise<string> {
  const [publicIssues, privateIssues, overlay] = await Promise.all([
    listIssues(roots.mainIssuesRoot, "public"),
    listIssues(roots.mainPrivateRoot, "private"),
    collectOverlay(worktreesRoot),
  ]);
  // Private records render interleaved with public ones in the same
  // category sections, distinguished only by the "private" chip — the
  // simplest coherent presentation per the plan, rather than a parallel set
  // of sections.
  const [authoritativePublic, authoritativePrivate] = await Promise.all([
    authoritativeOverlayIssues(
      publicIssues,
      overlay.byPath,
      overlay.worktreeRoots,
      "public",
    ),
    authoritativeOverlayIssues(
      privateIssues,
      overlay.byPathPrivate,
      overlay.worktreeRoots,
      "private",
    ),
  ]);
  const issues = [...authoritativePublic, ...authoritativePrivate];

  const f = parseFilters(query);
  const facets = deriveFacets(issues);

  const statusFiltered = issues.filter(
    (i) => f.status === "all" || (f.status === "closed" ? i.closed : !i.closed),
  );
  const visible = statusFiltered.filter((i) =>
    matches(i, f, overlayEntriesFor(overlay, i) !== undefined),
  );

  const byCategory = new Map<
    string,
    { open: IssueRecord[]; closed: IssueRecord[] }
  >();
  for (const cat of CATEGORIES) byCategory.set(cat, { open: [], closed: [] });
  for (const issue of visible) {
    const bucket = byCategory.get(issue.category);
    if (!bucket) continue;
    (issue.closed ? bucket.closed : bucket.open).push(issue);
  }
  for (const bucket of byCategory.values()) {
    bucket.open.sort(compareIssuePriority);
    bucket.closed.sort(compareIssuePriority);
  }

  const returnQuery = query.toString();
  const row = (i: IssueRecord): string =>
    issueRowHtml(base, i, overlayEntriesFor(overlay, i), returnQuery);
  const categoryHtml = CATEGORIES.map((cat) => {
    const bucket = byCategory.get(cat)!;
    if (bucket.open.length === 0 && bucket.closed.length === 0) return "";
    const openList = bucket.open.length
      ? `<ul class="issues">${bucket.open.map(row).join("")}</ul>`
      : `<p class="empty">no open items</p>`;
    const closedList =
      bucket.closed.length && f.status !== "closed"
        ? `<details class="closed-group"><summary>${bucket.closed.length} closed</summary><ul class="issues">${bucket.closed.map(row).join("")}</ul></details>`
        : f.status === "closed" && bucket.closed.length
          ? `<ul class="issues">${bucket.closed.map(row).join("")}</ul>`
          : "";
    const count =
      f.status === "closed" ? bucket.closed.length : bucket.open.length;
    return `<h2 class="cat">${escapeHtml(cat)} <span class="count">${count}</span></h2>${f.status === "closed" ? closedList : openList}${f.status === "all" ? closedList : ""}`;
  }).join("");

  const body = `<h1>issues</h1>
${filterChipsHtml(base, f, facets)}
${categoryHtml || `<p class="empty">no issues match these filters</p>`}<script src="${base}/issues/priority.js" defer></script>`;
  return renderDevShell(
    "issues",
    devBreadcrumbs(base, "issues"),
    body,
    ISSUES_CSS,
  );
}

async function priorityTarget(params: {
  roots: { mainIssuesRoot: string; mainPrivateRoot: string };
  worktreesRoot: string;
  relPath: string;
  visibility: Visibility;
}): Promise<string> {
  const { roots, worktreesRoot, relPath, visibility } = params;
  const overlay = await collectOverlay(worktreesRoot);
  const entries =
    (visibility === "private" ? overlay.byPathPrivate : overlay.byPath).get(
      relPath,
    ) ?? [];
  const candidates = await Promise.all(
    [...new Set(entries.map((entry) => entry.worktree))]
      .sort()
      .map(async (worktree) => {
        const root = overlay.worktreeRoots.get(worktree);
        if (!root) return null;
        const issue = await readWorktreeOnlyIssue(root, relPath, visibility);
        return issue ? { issue, root, worktree } : null;
      }),
  );
  const existing = candidates.filter(
    (candidate): candidate is NonNullable<typeof candidate> =>
      candidate !== null,
  );
  const selected = preferredIssueCandidate(existing);
  if (selected) {
    return path.join(
      selected.root,
      visibility === "private" ? "private-issues" : "issues",
      relPath,
    );
  }
  return path.join(
    visibility === "private" ? roots.mainPrivateRoot : roots.mainIssuesRoot,
    relPath,
  );
}

async function servePriorityAction(params: {
  base: string;
  roots: { mainIssuesRoot: string; mainPrivateRoot: string };
  worktreesRoot: string;
  query: URLSearchParams;
  res: http.ServerResponse;
}): Promise<void> {
  const { base, roots, worktreesRoot, query, res } = params;
  const relPath = query.get("issue") ?? "";
  const visibility = query.get("visibility");
  const priority = query.get("priority");
  if (
    !ISSUE_REL_RE.test(relPath) ||
    (visibility !== "public" && visibility !== "private") ||
    (priority !== "important" &&
      priority !== "normal" &&
      priority !== "backlog" &&
      priority !== "uncategorized")
  ) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("invalid issue priority action\n");
    return;
  }
  try {
    const target = await priorityTarget({
      roots,
      worktreesRoot,
      relPath,
      visibility,
    });
    const before = await fs.stat(target, { bigint: true });
    const source = await fs.readFile(target, "utf8");
    const afterRead = await fs.stat(target, { bigint: true });
    if (
      before.ino !== afterRead.ino ||
      before.mtimeNs !== afterRead.mtimeNs ||
      before.size !== afterRead.size
    )
      throw new Error("issue changed while its priority was being read");
    const updated = setIssuePriority(source, priority);
    const temporary = `${target}.priority-${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, updated, {
        mode: Number(afterRead.mode & 0o777n),
      });
      const beforeRename = await fs.stat(target, { bigint: true });
      if (
        beforeRename.ino !== afterRead.ino ||
        beforeRename.mtimeNs !== afterRead.mtimeNs ||
        beforeRename.size !== afterRead.size
      )
        throw new Error("issue changed while its priority was being saved");
      await fs.rename(temporary, target);
    } finally {
      await fs.unlink(temporary).catch(() => undefined);
    }
  } catch (error) {
    if (query.get("format") === "json") {
      res.writeHead(409, { "content-type": "text/plain; charset=utf-8" });
      res.end(error instanceof Error ? error.message : String(error));
      return;
    }
    res.writeHead(409, { "content-type": "text/html; charset=utf-8" });
    res.end(
      renderDevShell(
        "priority update failed",
        devBreadcrumbs(base, "issues"),
        `<h1>Priority update failed</h1><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p><p><a href="${base}/issues/">Return to issues</a></p>`,
      ),
    );
    return;
  }
  if (query.get("format") === "json") {
    res.writeHead(204);
    res.end();
    return;
  }
  const returnQuery = new URLSearchParams(query.get("return") ?? "").toString();
  res.writeHead(303, {
    location: `${base}/issues/${returnQuery ? `?${returnQuery}` : ""}`,
  });
  res.end();
}

// --- UI: detail ----------------------------------------------------------------

function factsTableHtml(
  fr: IssueFrontmatter,
  research: ResearchState,
  closed: boolean,
): string {
  const rows: Array<[string, string]> = [];
  rows.push(["workstream", fr.workstream]);
  if (fr.needs.length) rows.push(["needs", fr.needs.join(", ")]);
  if (fr.labels.length) rows.push(["labels", fr.labels.join(", ")]);
  rows.push(["priority", fr.priority]);
  if (fr.area) rows.push(["area", fr.area]);
  if (fr.filedBy) rows.push(["filed-by", fr.filedBy]);
  if (fr.discoveredBy) rows.push(["discovered-by", fr.discoveredBy]);
  if (fr.discoveredIn) rows.push(["discovered-in", fr.discoveredIn]);
  if (fr.design) rows.push(["design", fr.design]);
  if (closed && fr.resolution) rows.push(["resolution", fr.resolution]);
  rows.push(["research", research === "none" ? "—" : research]);
  if (!rows.length) return "";
  return `<table class="facts">${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}</table>`;
}

function escapeDiffLine(line: string): string {
  const escaped = escapeHtml(line);
  if (line.startsWith("+") && !line.startsWith("+++"))
    return `<span class="diff-add">${escaped}</span>`;
  if (line.startsWith("-") && !line.startsWith("---"))
    return `<span class="diff-del">${escaped}</span>`;
  return escaped;
}

// `gitCwd`/`gitPath` are already visibility-resolved by the caller: for a
// public issue, cwd is the worktree root and the path carries the "issues/"
// prefix; for a private one, cwd is `<worktreeRoot>/private-issues` and the
// path is repo-root-relative with NO prefix (the private repo's categories
// sit at its own root).
async function worktreeDiffHtml(
  worktree: string,
  gitCwd: string,
  gitPath: string,
): Promise<string> {
  const sections: string[] = [];
  try {
    const { stdout } = await execa(
      "git",
      ["diff", "main...HEAD", "--", gitPath],
      { cwd: gitCwd },
    );
    if (stdout.trim())
      sections.push(
        `<h3>${escapeHtml(worktree)} — committed since main</h3><pre>${stdout.split("\n").map(escapeDiffLine).join("\n")}</pre>`,
      );
  } catch {
    /* skip */
  }
  try {
    const { stdout } = await execa("git", ["diff", "HEAD", "--", gitPath], {
      cwd: gitCwd,
    });
    if (stdout.trim())
      sections.push(
        `<h3>${escapeHtml(worktree)} — uncommitted</h3><pre>${stdout.split("\n").map(escapeDiffLine).join("\n")}</pre>`,
      );
  } catch {
    /* skip */
  }
  return sections.join("");
}

async function renderIssueDetail(
  base: string,
  roots: { mainIssuesRoot: string; mainPrivateRoot: string },
  worktreesRoot: string,
  urlRel: string,
  res: http.ServerResponse,
): Promise<void> {
  const { visibility, relPath } = stripVisibilityPrefix(urlRel);
  const contentRoot =
    visibility === "private" ? roots.mainPrivateRoot : roots.mainIssuesRoot;
  const resolved = path.resolve(contentRoot, relPath);
  if (
    !resolved.startsWith(contentRoot + path.sep) ||
    !resolved.endsWith(".md")
  ) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden\n");
    return;
  }

  const overlay = await collectOverlay(worktreesRoot);
  const overlayByPath =
    visibility === "private" ? overlay.byPathPrivate : overlay.byPath;
  const dirPath = path.posix.dirname(relPath.split(path.sep).join("/"));
  const issuesBase = issuesBaseFor(base, visibility);

  let src: string;
  let worktreeOnlyLabel = "";
  try {
    src = await fs.readFile(resolved, "utf8");
  } catch {
    // Not on main — maybe a worktree-only issue.
    const entries = overlayByPath.get(relPath);
    const addedFrom = entries?.find(
      (e) => e.status === "added" || e.status === "renamed",
    );
    const root = addedFrom
      ? overlay.worktreeRoots.get(addedFrom.worktree)
      : undefined;
    if (!root) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`not found: ${relPath}\n`);
      return;
    }
    const dir =
      visibility === "private"
        ? path.join(root, "private-issues")
        : path.join(root, "issues");
    try {
      src = await fs.readFile(path.join(dir, relPath), "utf8");
      worktreeOnlyLabel = `<p style="color:#a2380a;font:13px ui-monospace,monospace">worktree-only — exists on <strong>${escapeHtml(addedFrom!.worktree)}</strong>, not on main</p>`;
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`not found: ${relPath}\n`);
      return;
    }
  }

  const issue = parseIssueFile(relPath, src, visibility);
  const { md: rewritten, closedHrefs } = rewriteIssueLinks(
    src,
    dirPath,
    issuesBase,
  );
  const { body } = parseFrontmatter(rewritten);
  const bodyHtml = appendClosedIssuePills(
    renderMarkdownToHtml(body),
    closedHrefs,
  );

  const entries = overlayByPath.get(relPath) ?? [];
  const byWorktree = new Map<string, OverlayEntry>();
  for (const e of entries) {
    const existing = byWorktree.get(e.worktree);
    if (!existing) byWorktree.set(e.worktree, e);
  }
  const diffSections = worktreeOnlyLabel
    ? []
    : await Promise.all(
        [...byWorktree.keys()].map(async (wt) => {
          const root = overlay.worktreeRoots.get(wt);
          if (!root) return "";
          const gitCwd =
            visibility === "private" ? path.join(root, "private-issues") : root;
          const gitPath =
            visibility === "private" ? relPath : `issues/${relPath}`;
          return worktreeDiffHtml(wt, gitCwd, gitPath);
        }),
      );
  const diffHtml = diffSections.filter(Boolean).length
    ? `<div class="wt-diff">${diffSections.join("")}</div>`
    : "";
  const manualActions = issue.frontmatter.needs.includes("manual-testing")
    ? `<div class="issue-actions"><form method="POST" action="/workstreams/action/resume/${encodeURIComponent(issue.frontmatter.workstream)}"><button type="submit">Open workstream</button></form>${!worktreeOnlyLabel && visibility === "public" ? `<form method="POST" action="/workstreams/action/confirm-tested/${encodeURIComponent(path.posix.basename(relPath))}"><button type="submit">Confirm</button></form>` : ""}</div>`
    : "";

  const html = `<h1>${escapeHtml(issue.frontmatter.title)}</h1>
${worktreeOnlyLabel}
${manualActions}
${factsTableHtml(issue.frontmatter, issue.research, issue.closed)}
${bodyHtml}
${diffHtml}`;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    renderDevShell(
      issue.frontmatter.title,
      devBreadcrumbs(
        base,
        `issues/${addVisibilityPrefix(relPath, visibility)}`,
      ),
      html,
      ISSUES_CSS,
    ),
  );
}

// --- dispatch -------------------------------------------------------------------

/**
 * Dispatch everything under /workstreams/issues/. `rel` is the URL after
 * "/issues" (e.g. "" | "/" | "/bugs/foo.md" | "/private/bugs/foo.md");
 * `query` is the parsed query string. `mainRoot` is always the canonical
 * checkout's root — the issue set is main's regardless of which
 * /<name>/dev/ prefix this request came through — while `worktreesRoot`
 * supplies the cross-worktree overlay. A leading "private/" URL segment
 * (stripped by stripVisibilityPrefix in renderIssueDetail) selects the
 * private source, mounted at `<mainRoot>/private-issues/` — a symlink that
 * may simply not exist for a developer who hasn't opted in, in which case
 * it contributes zero records rather than an error.
 */
export async function serveIssues(params: {
  base: string;
  method: string;
  mainRoot: string;
  worktreesRoot: string;
  rel: string;
  query: URLSearchParams;
  res: http.ServerResponse;
}): Promise<void> {
  const { base, method, mainRoot, worktreesRoot, rel, query, res } = params;
  const roots = {
    mainIssuesRoot: path.join(mainRoot, "issues"),
    mainPrivateRoot: path.join(mainRoot, "private-issues"),
  };

  if (method === "GET" && rel === "/priority.js") {
    res.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(PRIORITY_SCRIPT);
    return;
  }

  if (method === "POST" && rel === "/action/priority") {
    await servePriorityAction({ base, roots, worktreesRoot, query, res });
    return;
  }

  if (rel === "" || rel === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(await renderIssueIndex(base, roots, worktreesRoot, query));
    return;
  }

  // `rel` arrives already percent-decoded by serveDev — don't decode again
  // (a second pass would throw URIError on any literal "%" in a filename).
  const urlRel = rel.replace(/^\//, "");
  await renderIssueDetail(base, roots, worktreesRoot, urlRel, res);
}
