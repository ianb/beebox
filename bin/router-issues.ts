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
const pending = new Map();
const editor = document.querySelector(".issue-editor-bar");
const save = editor?.querySelector("[data-save]");
const reset = editor?.querySelector("[data-reset]");
const count = editor?.querySelector("[data-dirty-count]");
const status = editor?.querySelector("[data-save-status]");
const issueBrowser = document.querySelector("[data-issue-browser]");
const detailPane = document.querySelector("[data-issue-detail]");
const detailEndpoint = issueBrowser?.dataset.detailEndpoint;
let detailRequest;

function selectedIssue() {
  return new URLSearchParams(location.search).get("issue");
}

function issueUrl(issue, hash = "") {
  const url = new URL(location.href);
  if (issue) url.searchParams.set("issue", issue);
  else url.searchParams.delete("issue");
  url.hash = hash;
  return url;
}

function revealHash(hash) {
  if (!hash || !detailPane) return false;
  const target = detailPane.querySelector("#" + CSS.escape(decodeURIComponent(hash.slice(1))));
  if (!target) return false;
  target.scrollIntoView();
  return true;
}

function markSelected(issue) {
  for (const link of document.querySelectorAll("[data-issue-link]")) {
    const selected = link.dataset.issueLink === issue;
    link.closest("li")?.classList.toggle("selected", selected);
    if (selected) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  }
}

function clearIssue(options = {}) {
  const selectedLink = document.querySelector('[data-issue-link][aria-current="true"]');
  detailRequest?.abort();
  issueBrowser?.classList.remove("has-selection");
  markSelected(null);
  if (detailPane) {
    detailPane.removeAttribute("aria-busy");
    detailPane.innerHTML = '<p class="issue-detail-empty">Select an issue to read it.</p>';
  }
  if (options.focus) selectedLink?.focus();
}

async function openIssue(issue, options = {}) {
  if (!detailPane || !detailEndpoint) return;
  if (
    options.push &&
    selectedIssue() === issue &&
    issueBrowser?.classList.contains("has-selection")
  ) {
    if (location.hash !== (options.hash ?? "")) {
      history.pushState({}, "", issueUrl(issue, options.hash));
    }
    revealHash(options.hash);
    return;
  }
  detailRequest?.abort();
  detailRequest = new AbortController();
  issueBrowser?.classList.add("has-selection");
  markSelected(issue);
  detailPane.setAttribute("aria-busy", "true");
  detailPane.innerHTML = '<div class="issue-detail-loading" role="status"><strong>Loading issue…</strong><span>Reading the issue and worktree changes.</span></div>';
  if (options.push) history.pushState({}, "", issueUrl(issue, options.hash));
  try {
    const url = new URL(detailEndpoint, location.origin);
    url.searchParams.set("issue", issue);
    const response = await fetch(url, { signal: detailRequest.signal });
    if (!response.ok) throw new Error((await response.text()).trim() || "Issue failed to load");
    detailPane.innerHTML = await response.text();
    detailPane.removeAttribute("aria-busy");
    if (!revealHash(options.hash) && options.focus) {
      const heading = detailPane.querySelector("h1");
      heading?.setAttribute("tabindex", "-1");
      heading?.focus();
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    detailPane.removeAttribute("aria-busy");
    detailPane.innerHTML = '<div class="issue-detail-error" role="alert"><strong>Could not load issue</strong><span></span><button type="button" data-retry-issue>Retry</button></div>';
    detailPane.querySelector("span").textContent = error instanceof Error ? error.message : String(error);
  }
}

document.addEventListener("click", (event) => {
  const link = event.target instanceof Element ? event.target.closest("a") : null;
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  let issue = link.dataset.issueLink;
  let hash = "";
  if (!issue && detailPane?.contains(link)) {
    const url = new URL(link.href);
    const issuesPrefix = detailEndpoint?.replace(/detail$/, "") ?? "";
    if (url.origin === location.origin && url.pathname.startsWith(issuesPrefix)) {
      issue = decodeURIComponent(url.pathname.slice(issuesPrefix.length));
      hash = url.hash;
    }
  }
  if (!issue) return;
  event.preventDefault();
  openIssue(issue, {
    push: true,
    focus: true,
    hash,
  });
});

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element) || !event.target.closest("[data-close-issue]")) return;
  history.pushState({}, "", issueUrl(null));
  clearIssue({ focus: true });
});

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element) || !event.target.closest("[data-retry-issue]")) return;
  const issue = selectedIssue();
  if (issue) openIssue(issue);
});

addEventListener("popstate", () => {
  const issue = selectedIssue();
  if (issue) openIssue(issue, { focus: true, hash: location.hash });
  else clearIssue({ focus: true });
});

function updateEditor() {
  const size = pending.size;
  if (count) count.textContent = size === 1 ? "1 unsaved issue" : size + " unsaved issues";
  if (save) save.disabled = size === 0;
  if (reset) reset.disabled = size === 0;
}

function selectPriority(group, priority) {
  for (const button of group.querySelectorAll("button")) {
    const active = button.dataset.priority === priority;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  }
}

function updatePending(controls) {
  const priority = controls.querySelector(".priority-controls button.active")?.dataset.priority;
  const nextAction = controls.querySelector("[data-next-action]")?.value ?? "";
  const originalNextAction = controls.dataset.originalNextAction ?? "";
  const key = controls.dataset.visibility + ":" + controls.dataset.issue;
  if (priority === controls.dataset.originalPriority && nextAction === originalNextAction) {
    pending.delete(key);
  } else {
    pending.set(key, {
      issue: controls.dataset.issue,
      visibility: controls.dataset.visibility,
      priority,
      originalPriority: controls.dataset.originalPriority,
      nextAction,
      originalNextAction,
    });
  }
  if (status) status.textContent = "";
  updateEditor();
}

document.addEventListener("submit", (event) => {
  const form = event.target instanceof HTMLFormElement
    ? event.target.closest(".priority-controls form")
    : null;
  if (!form) return;
  event.preventDefault();
  const group = form.closest(".priority-controls");
  if (!group) return;
  const button = form.querySelector("button");
  const priority = button?.dataset.priority;
  if (!priority) return;
  selectPriority(group, priority);
  const controls = group.closest(".issue-editor-controls");
  if (controls) updatePending(controls);
});

document.addEventListener("change", (event) => {
  const select = event.target instanceof Element
    ? event.target.closest("[data-next-action]")
    : null;
  if (!select) return;
  const controls = select.closest(".issue-editor-controls");
  if (controls) updatePending(controls);
});

document.addEventListener("click", async (event) => {
  const button = event.target instanceof Element
    ? event.target.closest("[data-copy-path]")
    : null;
  if (!button) return;
  if (button.disabled) return;
  const copyPath = button.dataset.copyPath;
  button.disabled = true;
  try {
    try {
      await navigator.clipboard.writeText(copyPath);
    } catch {
      const field = document.createElement("textarea");
      field.value = copyPath;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.append(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      button.focus();
      if (!copied) throw new Error("copy command failed");
    }
    button.textContent = "Copied";
    button.setAttribute("aria-label", "Copied " + copyPath);
    button.classList.add("copied");
    setTimeout(() => {
      button.textContent = "Copy";
      button.setAttribute("aria-label", "Copy issue path " + copyPath);
      button.classList.remove("copied");
      button.disabled = false;
    }, 1200);
  } catch {
    button.textContent = "Copy failed";
    button.setAttribute("aria-label", "Copy failed for " + copyPath);
    button.classList.add("copy-failed");
    if (status) status.textContent = "Could not copy " + copyPath;
    setTimeout(() => {
      button.textContent = "Copy";
      button.setAttribute("aria-label", "Copy issue path " + copyPath);
      button.classList.remove("copy-failed");
      button.disabled = false;
    }, 2000);
  }
});

reset?.addEventListener("click", () => {
  for (const controls of document.querySelectorAll(".issue-editor-controls")) {
    const group = controls.querySelector(".priority-controls");
    selectPriority(group, group.dataset.originalPriority);
    const nextAction = controls.querySelector("[data-next-action]");
    if (nextAction) nextAction.value = controls.dataset.originalNextAction ?? "";
  }
  pending.clear();
  if (status) status.textContent = "Changes reset";
  updateEditor();
});

save?.addEventListener("click", async () => {
  if (pending.size === 0) return;
  save.disabled = true;
  reset.disabled = true;
  if (status) status.textContent = "Saving and committing…";
  try {
    const response = await fetch(save.dataset.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changes: [...pending.values()] }),
    });
    if (!response.ok) throw new Error((await response.text()).trim() || "Save failed");
    if (status) status.textContent = "Saved; refreshing…";
    pending.clear();
    location.reload();
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : String(error);
    updateEditor();
  }
});

addEventListener("beforeunload", (event) => {
  if (pending.size === 0) return;
  event.preventDefault();
});

const initialIssue = selectedIssue();
if (initialIssue) {
  issueBrowser?.classList.add("has-selection");
  markSelected(initialIssue);
  if (issueBrowser?.dataset.initialIssue !== initialIssue) {
    openIssue(initialIssue, { hash: location.hash });
  }
}
`;
type Category = (typeof CATEGORIES)[number];
export type IssuePriority =
  | "important"
  | "normal"
  | "uncategorized"
  | "backlog";
export type IssueNextAction = "reconfirm" | "duplicate" | "invalid" | "fixed";
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
  nextAction?: IssueNextAction;
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
  const nextActionValue = asString(data["next-action"]);
  const nextAction: IssueNextAction | undefined =
    nextActionValue === "reconfirm" ||
    nextActionValue === "duplicate" ||
    nextActionValue === "invalid" ||
    nextActionValue === "fixed"
      ? nextActionValue
      : undefined;
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
      ...(nextAction !== undefined ? { nextAction } : {}),
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
  const needs = fr.needs.toSorted((a, b) => {
    if (a === "manual-testing") return -1;
    if (b === "manual-testing") return 1;
    return 0;
  });
  for (const need of needs) {
    const needClass = need === "manual-testing" ? " chip-manual-testing" : "";
    chips.push(
      `<span class="chip chip-needs${needClass}">needs:${escapeHtml(need)}</span>`,
    );
  }
  if (fr.nextAction) {
    const label: Record<IssueNextAction, string> = {
      reconfirm: "Reconfirm?",
      duplicate: "Dup?",
      invalid: "Invalid?",
      fixed: "Fixed?",
    };
    chips.push(
      `<span class="chip chip-next-action">next:${label[fr.nextAction]}</span>`,
    );
  }
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
  body { max-width: 1500px; }
  .issue-editor-bar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 0.8em; margin: 0 -0.4em 1em; padding: 0.65em 0.4em; border-bottom: 1px solid #d8dde3; background: rgba(255, 255, 255, 0.96); }
  .issue-editor-bar h1 { flex: 0 0 auto; margin: 0; }
  .issue-editor-filters { display: flex; min-width: 0; flex: 1 1 auto; flex-wrap: wrap; gap: 0.3em; align-items: center; }
  .issue-editor-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 0.5em; }
  .issue-editor-actions button { padding: 0.3em 0.7em; }
  .issue-editor-actions button:disabled { cursor: default; opacity: 0.45; }
  .dirty-count, .save-status { color: #666; font: 12px ui-monospace, Menlo, monospace; }
  .save-status { max-width: 24em; color: #a23522; }
  .issue-browser { display: grid; grid-template-columns: minmax(30em, 0.9fr) minmax(0, 1.1fr); gap: 1.2em; align-items: start; }
  .issue-list-pane, .issue-detail-pane { min-width: 0; max-height: calc(100vh - 7em); overflow: auto; }
  .issue-list-pane { padding-right: 0.2em; }
  .issue-detail-pane { padding: 0 0.8em 2em 1.3em; border-left: 1px solid #d8dde3; }
  .issue-detail-pane h1 { margin-top: 0; }
  .issue-detail-empty { margin: 3em 1em; color: #888; text-align: center; }
  .issue-detail-loading, .issue-detail-error { display: flex; min-height: 10em; flex-direction: column; align-items: center; justify-content: center; gap: 0.5em; color: #666; text-align: center; }
  .issue-detail-loading span, .issue-detail-error span { font-size: 0.9em; }
  .issue-detail-error { color: #a23522; }
  .issue-detail-header { display: none; justify-content: flex-end; margin-bottom: 0.5em; }
  .issue-browser.has-selection .issue-detail-header { display: flex; }
  .issue-detail-header button { padding: 0.25em 0.65em; }
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
  .chip-manual-testing { background: #9a5b00; color: #fff; font-weight: 650; }
  .chip-next-action { background: #f7e6b5; color: #754300; font-weight: 650; }
  .chip-label { background: #ece4fb; color: #5a34a8; }
  .badge { display: inline-block; padding: 0.1em 0.5em; margin: 0.15em 0.3em 0.15em 0; border-radius: 4px; font: 12px ui-monospace, Menlo, monospace; background: #f0f0f0; color: #444; }
  .badge-added { background: #e6f4ea; color: #1e6b34; }
  .badge-deleted { background: #fbe9e7; color: #a23522; }
  .badge-modified { background: #eef3fb; color: #2255aa; }
  .badge-renamed { background: #f3eefb; color: #6f42c1; }
  .badge.uncommitted { border: 1px dashed currentColor; }
  ul.issues { list-style: none; padding: 0; margin: 0 0 1.6em; border: 1px solid #e3e3e3; border-radius: 8px; overflow: hidden; }
  ul.issues li { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 1.2em; padding: 0.7em 1em; border-bottom: 1px solid #eee; }
  ul.issues li:last-child { border-bottom: none; }
  ul.issues li:hover { background: #f6f8fa; }
  ul.issues li.selected { background: #eaf1fb; box-shadow: inset 3px 0 #2255aa; }
  ul.issues .issue-main { display: flex; min-width: 0; flex-direction: column; align-items: flex-start; }
  ul.issues .issue-title-row { display: flex; min-width: 0; align-items: baseline; gap: 0.5em; }
  ul.issues a.title { display: block; font-weight: 600; text-decoration: none; color: #222; }
  ul.issues a.title:hover { color: #2255aa; text-decoration: underline; }
  .copy-issue-path { flex: 0 0 auto; padding: 0.1em 0.35em; border: 1px solid #ccd2d8; border-radius: 4px; background: #fff; color: #66717c; font: 600 10px ui-monospace, Menlo, monospace; cursor: pointer; }
  .copy-issue-path.copied { border-color: #3f7b50; color: #2f6b40; }
  .copy-issue-path.copy-failed { border-color: #a23522; color: #a23522; }
  ul.issues .meta { display: block; color: #888; font: 12px ui-monospace, Menlo, monospace; margin-top: 0.2em; }
  ul.issues .issue-priority { min-width: 0; justify-self: end; }
  .priority-controls { display: flex; flex: 0 0 auto; }
  .priority-controls form { margin: 0; }
  .priority-controls button { min-width: 2.25em; padding: 0.25em 0.5em; border: 1px solid #bbc2ca; border-right-width: 0; background: #fff; color: #555; font: 600 13px ui-monospace, Menlo, monospace; cursor: pointer; }
  .priority-controls form:first-child button { border-radius: 4px 0 0 4px; }
  .priority-controls form:last-child button { border-right-width: 1px; border-radius: 0 4px 4px 0; }
  .priority-controls button.active { background: #2255aa; color: #fff; font-weight: 700; }
  .priority-controls button[data-priority="important"].active { background: #b8422d; }
  .priority-controls button[data-priority="normal"].active { background: #555; }
  .priority-controls button[data-priority="backlog"].active { background: #58738f; }
  .issue-editor-controls { display: flex; align-items: center; gap: 0.45em; }
  .next-action-control { padding: 0.25em 0.45em; border: 1px solid #bbc2ca; border-radius: 4px; background: #fff; color: #666; font: 600 12px ui-monospace, Menlo, monospace; }
  .priority-target { display: block; margin-top: 0.15em; color: #888; font: 10px ui-monospace, Menlo, monospace; text-align: right; }
  .priority-error { display: block; max-width: 22em; margin-top: 0.2em; color: #a23522; font-size: 0.8em; }
  ul.issues .issue-pills { display: flex; flex-wrap: wrap; justify-content: flex-start; gap: 0.2em; margin-top: 0.35em; }
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
  @media (max-width: 1000px) {
    ul.issues li { grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 0.7em; }
    ul.issues .issue-priority { justify-self: end; }
  }
  @media (max-width: 700px) {
    .issue-editor-bar { align-items: flex-start; flex-wrap: wrap; }
    .issue-editor-filters { order: 3; flex-basis: 100%; }
    .issue-editor-actions { margin-left: auto; }
    ul.issues li { grid-template-columns: minmax(0, 1fr); }
    ul.issues .issue-priority { justify-self: start; }
    .priority-target { text-align: left; }
    .issue-browser { display: block; }
    .issue-list-pane, .issue-detail-pane { max-height: none; overflow: visible; }
    .issue-detail-pane { display: none; padding: 0; border-left: none; }
    .issue-browser.has-selection .issue-list-pane { display: none; }
    .issue-browser.has-selection .issue-detail-pane { display: block; }
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
  sort: "date" | "priority";
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
  const sort = query.get("sort");
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
    sort: sort === "priority" ? "priority" : "date",
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

export function compareIssueDateDescending(
  a: IssueRecord,
  b: IssueRecord,
): number {
  const aDate = a.slug.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
  const bDate = b.slug.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
  if (aDate !== bDate) return aDate < bDate ? 1 : -1;
  return a.slug.localeCompare(b.slug);
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
  const frontmatter = source.slice(0, end);
  const remainder = source.slice(end);
  if (priority === "uncategorized")
    return `${frontmatter.replace(priorityLine, "")}${remainder}`;
  const line = `priority: ${priority}`;
  if (priorityLine.test(frontmatter))
    return `${frontmatter.replace(priorityLine, `${line}${newline}`)}${remainder}`;
  return `${source.slice(0, end)}${line}${newline}${source.slice(end)}`;
}

export function setIssueNextAction(
  source: string,
  nextAction: IssueNextAction | undefined,
): string {
  const opening = /^(?:\uFEFF)?---[ \t]*(\r?\n)/.exec(source);
  if (!opening) throw new Error("issue has no writable YAML frontmatter");
  const newline = opening[1] ?? "\n";
  const closing = /^---[ \t]*\r?$/gm;
  closing.lastIndex = opening[0].length;
  const end = closing.exec(source)?.index;
  if (end === undefined)
    throw new Error("issue has no writable YAML frontmatter");
  const actionLine = /^next-action:[^\r\n]*(?:\r?\n)?/m;
  const frontmatter = source.slice(0, end);
  const remainder = source.slice(end);
  if (nextAction === undefined)
    return `${frontmatter.replace(actionLine, "")}${remainder}`;
  const line = `next-action: ${nextAction}`;
  if (actionLine.test(frontmatter))
    return `${frontmatter.replace(actionLine, `${line}${newline}`)}${remainder}`;
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
  selectedIssue?: string,
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
      sort: f.sort === "date" ? undefined : f.sort,
      issue: selectedIssue,
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
  const sortGroup = ([
    ["date", "newest filed"],
    ["priority", "priority"],
  ] as const)
    .map(
      ([value, label]) =>
        `<a class="chip${f.sort === value ? " active" : ""}" href="${qs({ sort: value === "date" ? undefined : value })}">${label}</a>`,
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
    f.status !== "open" ||
    f.sort !== "date";
  const clear = anyActive
    ? `<a class="clear" href="${base}/issues/">clear all ×</a>`
    : "";
  const labelsRow = facets.labels.length
    ? `<div>${group("labels", "labels", facets.labels, f.labels)}</div>`
    : "";
  return `<div class="filters">
    <div>status: ${statusGroup} ${researchChip} ${assignedChip} ${unassignedChip} ${worktreeChip}${clear}</div>
    <div>sort: ${sortGroup}</div>
    <div>${group("priority", "priority", ["important", "normal", "uncategorized", "backlog"], f.priority)}</div>
    <div>visibility: ${visibilityGroup}</div>
    <div>${group("category", "category", facets.categories, f.category)}</div>
    <div>${group("area", "area", facets.areas, f.area)}</div>
    <div>${group("needs", "needs", facets.needs, f.needs)}</div>
    ${labelsRow}
  </div>`;
}

function activeFiltersHtml(f: Filters): string {
  const filters = [
    `status: ${f.status}`,
    `sort: ${f.sort === "date" ? "newest filed" : "priority"}`,
    f.priority ? `priority: ${f.priority}` : undefined,
    f.category ? `category: ${f.category}` : undefined,
    f.area ? `area: ${f.area}` : undefined,
    f.needs ? `needs: ${f.needs}` : undefined,
    f.labels ? `label: ${f.labels}` : undefined,
    f.research ? `research: ${f.research}` : undefined,
    f.visibility ? `visibility: ${f.visibility}` : undefined,
    f.assigned ? "assigned" : undefined,
    f.unassigned ? "unassigned" : undefined,
    f.worktreeTouched ? "touched by worktree" : undefined,
  ].filter((filter): filter is string => filter !== undefined);
  return filters
    .map((filter) => `<span class="chip">${escapeHtml(filter)}</span>`)
    .join("");
}

function issueRowHtml(
  base: string,
  issue: IssueRecord,
  overlay: OverlayEntry[] | undefined,
  returnQuery: string,
  selectedIssue?: string,
): string {
  const paneQuery = new URLSearchParams(returnQuery);
  const paneIssue = addVisibilityPrefix(issue.relPath, issue.visibility);
  paneQuery.set("issue", paneIssue);
  const href = `${base}/issues/?${paneQuery.toString()}`;
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
      const symbol = {
        important: "!",
        normal: "−",
        backlog: "↓",
        uncategorized: "?",
      }[priority];
      const action = `${base}/issues/action/priority?visibility=${issue.visibility}&amp;issue=${encodeURIComponent(issue.relPath)}&amp;priority=${priority}&amp;originalPriority=${issue.frontmatter.priority}${returnQuery ? `&amp;return=${encodeURIComponent(returnQuery)}` : ""}`;
      return `<form method="POST" action="${action}"><button type="submit" role="radio" data-priority="${priority}" aria-label="${label}" title="${label}" aria-checked="${active ? "true" : "false"}"${active ? ' class="active"' : ""}>${symbol}</button></form>`;
    })
    .join("");
  const nextAction = issue.frontmatter.nextAction ?? "";
  const nextActionOptions = [
    ["", "Next action…"],
    ["reconfirm", "Reconfirm?"],
    ["duplicate", "Dup?"],
    ["invalid", "Invalid?"],
    ["fixed", "Fixed?"],
  ]
    .map(
      ([value, label]) =>
        `<option value="${value}"${nextAction === value ? " selected" : ""}>${label}</option>`,
    )
    .join("");
  const copyPath = `${issue.visibility === "private" ? "private-issues" : "issues"}/${issue.relPath}`;
  const selected = paneIssue === selectedIssue;
  return `<li${selected ? ' class="selected"' : ""}>
    <div class="issue-main">
      <div class="issue-title-row"><a class="title" href="${href}" data-issue-link="${escapeHtml(paneIssue)}"${selected ? ' aria-current="true"' : ""}>${escapeHtml(issue.frontmatter.title)}</a><button type="button" class="copy-issue-path" data-copy-path="${escapeHtml(copyPath)}" aria-label="Copy issue path ${escapeHtml(copyPath)}" title="Copy ${escapeHtml(copyPath)}">Copy</button></div>
      <span class="meta">${escapeHtml(date)}${date && shortSlug ? " · " : ""}${escapeHtml(shortSlug)}</span>
      <div class="issue-pills">${pills}</div>
    </div>
    <div class="issue-priority"><div class="issue-editor-controls" data-issue="${escapeHtml(issue.relPath)}" data-visibility="${issue.visibility}" data-original-priority="${issue.frontmatter.priority}" data-original-next-action="${nextAction}"><div class="priority-controls" role="radiogroup" aria-label="Priority for ${escapeHtml(issue.frontmatter.title)}; saves to ${escapeHtml(editTarget)}">${priorityControls}</div><select class="next-action-control" data-next-action aria-label="Next action for ${escapeHtml(issue.frontmatter.title)}" title="Ask the next agent to verify and apply this outcome">${nextActionOptions}</select></div>${editTargetHtml}</div>
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
  const selectedIssue = query.get("issue") ?? undefined;
  const selectedDetail = selectedIssue
    ? await buildIssueDetail(base, roots, selectedIssue, overlay)
    : undefined;

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
    const comparator =
      f.sort === "priority"
        ? (a: IssueRecord, b: IssueRecord) =>
            compareIssuePriority(a, b) || compareIssueDateDescending(a, b)
        : compareIssueDateDescending;
    bucket.open.sort(comparator);
    bucket.closed.sort(comparator);
  }

  const returnQuery = query.toString();
  const row = (i: IssueRecord): string =>
    issueRowHtml(
      base,
      i,
      overlayEntriesFor(overlay, i),
      returnQuery,
      selectedIssue,
    );
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

  const initialDetail = selectedDetail
    ? selectedDetail.status === 200
      ? selectedDetail.body
      : `<div class="issue-detail-error" role="alert"><strong>Could not load issue</strong><span>${escapeHtml(selectedDetail.body.trim())}</span><button type="button" data-retry-issue>Retry</button></div>`
    : `<p class="issue-detail-empty">Select an issue to read it.</p>`;
  const body = `<div class="issue-editor-bar">
  <h1>issues</h1>
  <div class="issue-editor-filters" aria-label="Active filters">${activeFiltersHtml(f)}</div>
  <div class="issue-editor-actions">
    <span class="dirty-count" data-dirty-count aria-live="polite">0 unsaved issues</span>
    <span class="save-status" data-save-status role="alert"></span>
    <button type="button" data-reset disabled>Reset</button>
    <button type="button" data-save data-endpoint="${base}/issues/action/save-priorities" disabled>Save</button>
  </div>
</div>
<div class="issue-browser${selectedIssue ? " has-selection" : ""}" data-issue-browser data-detail-endpoint="${base}/issues/detail"${selectedIssue ? ` data-initial-issue="${escapeHtml(selectedIssue)}"` : ""}>
  <section class="issue-list-pane" aria-label="Issue list">
    ${filterChipsHtml(base, f, facets, selectedIssue)}
    ${categoryHtml || `<p class="empty">no issues match these filters</p>`}
  </section>
  <section class="issue-detail-pane" aria-label="Issue detail">
    <div class="issue-detail-header"><button type="button" data-close-issue>Back to issues</button></div>
    <div data-issue-detail aria-live="polite">${initialDetail}</div>
  </section>
</div><script src="${base}/issues/priority.js" defer></script>`;
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
  overlay?: OverlayResult;
}): Promise<string> {
  const { roots, worktreesRoot, relPath, visibility } = params;
  const overlay = params.overlay ?? (await collectOverlay(worktreesRoot));
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

interface PriorityChange {
  issue: string;
  visibility: Visibility;
  priority: IssuePriority;
  originalPriority?: IssuePriority;
  nextAction?: IssueNextAction | "";
  originalNextAction?: IssueNextAction | "";
}

function isPriority(value: unknown): value is IssuePriority {
  return (
    value === "important" ||
    value === "normal" ||
    value === "backlog" ||
    value === "uncategorized"
  );
}

function isNextAction(value: unknown): value is IssueNextAction | "" {
  return (
    value === "" ||
    value === "reconfirm" ||
    value === "duplicate" ||
    value === "invalid" ||
    value === "fixed"
  );
}

function validatePriorityChange(value: unknown): PriorityChange {
  if (!value || typeof value !== "object")
    throw new Error("invalid priority change");
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.issue !== "string" ||
    !ISSUE_REL_RE.test(candidate.issue) ||
    (candidate.visibility !== "public" && candidate.visibility !== "private") ||
    !isPriority(candidate.priority) ||
    (candidate.originalPriority !== undefined &&
      !isPriority(candidate.originalPriority)) ||
    (candidate.nextAction !== undefined && !isNextAction(candidate.nextAction)) ||
    (candidate.originalNextAction !== undefined &&
      !isNextAction(candidate.originalNextAction))
  )
    throw new Error("invalid priority change");
  return {
    issue: candidate.issue,
    visibility: candidate.visibility,
    priority: candidate.priority,
    ...(candidate.originalPriority !== undefined
      ? { originalPriority: candidate.originalPriority }
      : {}),
    ...(candidate.nextAction !== undefined
      ? { nextAction: candidate.nextAction }
      : {}),
    ...(candidate.originalNextAction !== undefined
      ? { originalNextAction: candidate.originalNextAction }
      : {}),
  };
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("priority save is too large");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid priority save body");
  }
}

async function commitPriorityTargets(targets: string[]): Promise<void> {
  const byRepo = new Map<string, string[]>();
  for (const target of targets) {
    const canonicalTarget = await fs.realpath(target);
    const { stdout } = await execa("git", ["rev-parse", "--show-toplevel"], {
      cwd: path.dirname(canonicalTarget),
    });
    const repoRoot = stdout.trim();
    const repoTargets = byRepo.get(repoRoot) ?? [];
    repoTargets.push(path.relative(repoRoot, canonicalTarget));
    byRepo.set(repoRoot, repoTargets);
  }
  for (const [repoRoot, repoTargets] of byRepo) {
    await execa("git", ["add", "--", ...repoTargets], { cwd: repoRoot });
    const staged = await execa(
      "git",
      ["diff", "--cached", "--quiet", "--", ...repoTargets],
      { cwd: repoRoot, reject: false },
    );
    if (staged.exitCode === 0) continue;
    if (staged.exitCode !== 1)
      throw new Error(`could not inspect staged issue priorities in ${repoRoot}`);
    await execa(
      "git",
      ["commit", "--only", "-m", "Update issue metadata", "--", ...repoTargets],
      { cwd: repoRoot },
    );
  }
}

async function assertPriorityOnlyTarget(params: {
  target: string;
  source: string;
  currentPriority: IssuePriority;
  currentNextAction: IssueNextAction | undefined;
  issue: string;
}): Promise<void> {
  const { target, source, currentPriority, currentNextAction, issue } = params;
  const canonicalTarget = await fs.realpath(target);
  const { stdout } = await execa("git", ["rev-parse", "--show-toplevel"], {
    cwd: path.dirname(canonicalTarget),
  });
  const repoRoot = stdout.trim();
  const repoPath = path.relative(repoRoot, canonicalTarget);
  const head = await execa("git", ["show", `HEAD:${repoPath}`], {
    cwd: repoRoot,
    reject: false,
    stripFinalNewline: false,
  });
  if (head.exitCode !== 0)
    throw new Error(`commit this new issue before changing its priority: ${issue}`);
  const normalizedHead = setIssueNextAction(
    setIssuePriority(head.stdout, currentPriority),
    currentNextAction,
  );
  if (normalizedHead !== source)
    throw new Error(`issue has other uncommitted edits: ${issue}`);
  const staged = await execa(
    "git",
    ["diff", "--cached", "--quiet", "--", repoPath],
    { cwd: repoRoot, reject: false },
  );
  if (staged.exitCode === 1)
    throw new Error(`issue has staged edits: ${issue}`);
  if (staged.exitCode !== 0)
    throw new Error(`could not inspect issue state: ${issue}`);
}

async function savePriorityChanges(params: {
  changes: PriorityChange[];
  roots: { mainIssuesRoot: string; mainPrivateRoot: string };
  worktreesRoot: string;
}): Promise<number> {
  const { changes, roots, worktreesRoot } = params;
  if (changes.length === 0) return 0;
  if (changes.length > 1_000) throw new Error("too many priority changes");
  const keys = new Set<string>();
  const overlay = await collectOverlay(worktreesRoot);
  const prepared = await Promise.all(
    changes.map(async (change) => {
      const key = `${change.visibility}:${change.issue}`;
      if (keys.has(key)) throw new Error(`duplicate priority change: ${change.issue}`);
      keys.add(key);
      const target = await priorityTarget({
        roots,
        worktreesRoot,
        relPath: change.issue,
        visibility: change.visibility,
        overlay,
      });
      const before = await fs.stat(target, { bigint: true });
      const source = await fs.readFile(target, "utf8");
      const afterRead = await fs.stat(target, { bigint: true });
      if (
        before.ino !== afterRead.ino ||
        before.mtimeNs !== afterRead.mtimeNs ||
        before.size !== afterRead.size
      )
        throw new Error(`issue changed while being read: ${change.issue}`);
      const currentPriority = parseIssueFile(
        change.issue,
        source,
        change.visibility,
      ).frontmatter.priority;
      const currentNextAction = parseIssueFile(
        change.issue,
        source,
        change.visibility,
      ).frontmatter.nextAction;
      if (
        change.originalPriority !== undefined &&
        change.originalPriority !== currentPriority
      )
        throw new Error(`issue priority changed since the page loaded: ${change.issue}`);
      if (
        change.originalNextAction !== undefined &&
        change.originalNextAction !== (currentNextAction ?? "")
      )
        throw new Error(`issue next action changed since the page loaded: ${change.issue}`);
      await assertPriorityOnlyTarget({
        target,
        source,
        currentPriority,
        currentNextAction,
        issue: change.issue,
      });
      const priorityUpdated = setIssuePriority(source, change.priority);
      const updated =
        change.nextAction === undefined
          ? priorityUpdated
          : setIssueNextAction(
              priorityUpdated,
              change.nextAction === "" ? undefined : change.nextAction,
            );
      return {
        change,
        target,
        source,
        updated,
        stat: afterRead,
      };
    }),
  );
  const changed = prepared.filter(({ source, updated }) => source !== updated);
  const temporaries = new Map<string, string>();
  try {
    for (const item of changed) {
      const temporary = `${item.target}.priority-${randomUUID()}.tmp`;
      await fs.writeFile(temporary, item.updated, {
        mode: Number(item.stat.mode & 0o777n),
      });
      temporaries.set(item.target, temporary);
    }
    for (const item of changed) {
      const current = await fs.stat(item.target, { bigint: true });
      if (
        current.ino !== item.stat.ino ||
        current.mtimeNs !== item.stat.mtimeNs ||
        current.size !== item.stat.size
      )
        throw new Error(`issue changed while being saved: ${item.change.issue}`);
    }
    const renamed: typeof changed = [];
    try {
      for (const item of changed) {
        await fs.rename(temporaries.get(item.target)!, item.target);
        renamed.push(item);
      }
    } catch (error) {
      await Promise.all(
        renamed.map(async (item) =>
          fs.writeFile(item.target, item.source, {
            mode: Number(item.stat.mode & 0o777n),
          }),
        ),
      );
      throw error;
    }
  } finally {
    await Promise.all(
      [...temporaries.values()].map(async (temporary) =>
        // Best-effort cleanup: renamed temporaries no longer exist.
        fs.unlink(temporary).catch(() => undefined),
      ),
    );
  }
  if (changed.length > 0)
    await commitPriorityTargets(changed.map(({ target }) => target));
  return changed.length;
}

async function servePrioritySave(params: {
  roots: { mainIssuesRoot: string; mainPrivateRoot: string };
  worktreesRoot: string;
  req: http.IncomingMessage | undefined;
  res: http.ServerResponse;
}): Promise<void> {
  const { roots, worktreesRoot, req, res } = params;
  if (!req) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("missing priority save body\n");
    return;
  }
  try {
    const body = await readJsonBody(req);
    const rawChanges =
      body && typeof body === "object"
        ? (body as Record<string, unknown>).changes
        : undefined;
    if (!Array.isArray(rawChanges)) throw new Error("invalid priority save body");
    const changes = rawChanges.map(validatePriorityChange);
    const saved = await savePriorityChanges({ changes, roots, worktreesRoot });
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ saved }));
  } catch (error) {
    res.writeHead(409, { "content-type": "text/plain; charset=utf-8" });
    res.end(error instanceof Error ? error.message : String(error));
  }
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
  const originalPriority = query.get("originalPriority");
  if (
    !ISSUE_REL_RE.test(relPath) ||
    (visibility !== "public" && visibility !== "private") ||
    (priority !== "important" &&
      priority !== "normal" &&
      priority !== "backlog" &&
      priority !== "uncategorized") ||
    !isPriority(originalPriority)
  ) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("invalid issue priority action\n");
    return;
  }
  try {
    await savePriorityChanges({
      changes: [{ issue: relPath, visibility, priority, originalPriority }],
      roots,
      worktreesRoot,
    });
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

type IssueDetailResult =
  | {
      status: 200;
      contentType: string;
      body: string;
      title: string;
      relPath: string;
      visibility: Visibility;
    }
  | {
      status: 403 | 404;
      contentType: string;
      body: string;
    };

async function buildIssueDetail(
  base: string,
  roots: { mainIssuesRoot: string; mainPrivateRoot: string },
  urlRel: string,
  overlay: OverlayResult,
): Promise<IssueDetailResult> {
  const { visibility, relPath } = stripVisibilityPrefix(urlRel);
  const contentRoot =
    visibility === "private" ? roots.mainPrivateRoot : roots.mainIssuesRoot;
  const resolved = path.resolve(contentRoot, relPath);
  if (
    !resolved.startsWith(contentRoot + path.sep) ||
    !resolved.endsWith(".md")
  ) {
    return { status: 403, contentType: "text/plain", body: "forbidden\n" };
  }

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
      return {
        status: 404,
        contentType: "text/plain",
        body: `not found: ${relPath}\n`,
      };
    }
    const dir =
      visibility === "private"
        ? path.join(root, "private-issues")
        : path.join(root, "issues");
    try {
      src = await fs.readFile(path.join(dir, relPath), "utf8");
      worktreeOnlyLabel = `<p style="color:#a2380a;font:13px ui-monospace,monospace">worktree-only — exists on <strong>${escapeHtml(addedFrom!.worktree)}</strong>, not on main</p>`;
    } catch {
      return {
        status: 404,
        contentType: "text/plain",
        body: `not found: ${relPath}\n`,
      };
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
  return {
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: html,
    title: issue.frontmatter.title,
    relPath,
    visibility,
  };
}

async function renderIssueDetail(
  base: string,
  roots: { mainIssuesRoot: string; mainPrivateRoot: string },
  worktreesRoot: string,
  urlRel: string,
  res: http.ServerResponse,
  fragment = false,
): Promise<void> {
  const result = await buildIssueDetail(
    base,
    roots,
    urlRel,
    await collectOverlay(worktreesRoot),
  );
  res.writeHead(result.status, { "content-type": result.contentType });
  if (fragment || result.status !== 200) {
    res.end(result.body);
    return;
  }
  res.end(
    renderDevShell(
      result.title,
      devBreadcrumbs(
        base,
        `issues/${addVisibilityPrefix(result.relPath, result.visibility)}`,
      ),
      result.body,
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
  req?: http.IncomingMessage;
  res: http.ServerResponse;
}): Promise<void> {
  const { base, method, mainRoot, worktreesRoot, rel, query, req, res } = params;
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

  if (method === "POST" && rel === "/action/save-priorities") {
    await servePrioritySave({ roots, worktreesRoot, req, res });
    return;
  }

  if (method === "GET" && rel === "/detail") {
    await renderIssueDetail(
      base,
      roots,
      worktreesRoot,
      query.get("issue") ?? "",
      res,
      true,
    );
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
