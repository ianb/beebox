// The retired /dev/docs markdown browser: the repo-wide .md listing, its
// sidebar, and the request handler that rendered them.
//
// RETIRED: `/<worktree>/dev/docs/…` 301s to `/workstreams/browse?file=…`
// (beebox/docs/plans/general-browser.md, Track 5), so nothing reaches this
// code at runtime. It is kept, not deleted, because the closed-issue pill
// feature it rendered has not been ported to the general browser yet — see
// issues/code-quality/2026-08-22-retire-doc-browser-dead-code.md, which asks for
// the port to land first so the retirement does not quietly lose a feature.

import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import { escapeHtml, findClosedIssueLinkHrefs, appendClosedIssuePills, renderMarkdownToHtml } from "./router-markdown.js";
import { renderDevShell, devBreadcrumbs, type DevResponse } from "./router-docs.js";
import { DOC_BROWSER_CSS, renderDocQuickOpen } from "./router-doc-browser-ui.js";

// --- markdown doc browser (/dev/docs) ---------------------------------------

async function listRepoMarkdown(repoRoot: string): Promise<string[]> {
  try {
    // --cached (tracked) + --others (untracked) so in-progress, never-committed
    // docs show up too; --exclude-standard keeps .gitignored trees out (e.g.
    // node_modules, docs/generated/).
    const { stdout } = await execa(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "*.md", "**/*.md"],
      { cwd: repoRoot },
    );
    const files = stdout.split("\n").filter(Boolean);

    // scratch/ is deliberately gitignored (scratch/*), so --exclude-standard
    // above drops it — but scratch/ is exactly where agents leave deliverable
    // orientation docs the boxholder wants to browse. Re-admit ONLY ignored
    // markdown under scratch/, scoped so node_modules/docs/generated stay out.
    try {
      const { stdout: scratch } = await execa(
        "git",
        ["ls-files", "--others", "--ignored", "--exclude-standard", "scratch/*.md", "scratch/**/*.md"],
        { cwd: repoRoot },
      );
      files.push(...scratch.split("\n").filter(Boolean));
    } catch (_e) { /* no scratch/ or git quirk — just skip it */ }

    return Array.from(new Set(files)).toSorted();
  } catch (_e) {
    // Not a git checkout, or git is unavailable — no listing to offer.
    return [];
  }
}

// Last-commit unix time per .md file (one history walk; first occurrence wins,
// since `git log` is newest-first). Filesystem mtime is useless in a worktree —
// every file shares the clone time — so we use git for "recently edited".
async function mdLastModified(repoRoot: string, files: string[]): Promise<Map<string, number>> {
  const times = new Map<string, number>();
  try {
    const { stdout } = await execa("git", ["log", "--format=%ct", "--name-only", "--", "*.md", "**/*.md"], { cwd: repoRoot });
    let cur = 0;
    for (const line of stdout.split("\n")) {
      if (line === "") continue;
      if (/^\d+$/.test(line)) { cur = Number(line); continue; }
      if (!times.has(line)) times.set(line, cur);
    }
  } catch (_e) { /* leave empty */ }
  // Untracked (never-committed) files have no git time. Their filesystem mtime
  // IS meaningful here — they were created after the worktree clone, not shared
  // at clone time like tracked files — so fall back to it, which floats
  // in-progress docs to the top of the "recent" sort.
  await Promise.all(
    files
      .filter((f) => !times.has(f))
      .map(async (f) => {
        try {
          const st = await fs.stat(path.resolve(repoRoot, f));
          times.set(f, Math.floor(st.mtimeMs / 1000));
        } catch (_e) { /* unreadable — skip */ }
      }),
  );
  return times;
}

// A top-level area with more than this many .md files is split into a second
// level (e.g. beebox/ → beebox/docs, beebox/test, …). Smaller
// areas stay flat — the flatness is nice when it fits.
const DOC_TWO_LEVEL_THRESHOLD = 60;

function docHref(base: string, { file, sort }: { file: string; sort: string }): string {
  const q = sort === "recent" ? "?sort=recent" : "";
  return `${base}/docs/${file.split("/").map(encodeURIComponent).join("/")}${q}`;
}

function docGroupKey(f: string, bigTops: Set<string>): string {
  const [top, ...rest] = f.split("/");
  if (top === undefined || rest.length === 0) return "(root)";
  const [second] = rest;
  if (second !== undefined && rest.length >= 2 && bigTops.has(top)) return `${top}/${second}`;
  return top;
}

/**
 * The doc-browser sidebar. Two views, toggled by `sort`:
 *  - "path" (default): <details> groups by area; big areas go two levels deep.
 *  - "recent": one flat list, most-recently-committed first, dated.
 * The group/list item for the current file is marked active and expanded.
 */
function renderDocSidebar(
  base: string,
  { files, currentRel, sort, times }: { files: string[]; currentRel: string; sort: string; times: Map<string, number> },
): string {
  const indexHref = (s: string) => `${base}/docs/${s === "recent" ? "?sort=recent" : ""}`;
  const curHref = (s: string) => (currentRel ? docHref(base, { file: currentRel, sort: s }) : indexHref(s));
  const toggle = "<div class=\"docsort\">"
    + `<a class="${sort !== "recent" ? "on" : ""}" href="${curHref("path")}">by path</a> · `
    + `<a class="${sort === "recent" ? "on" : ""}" href="${curHref("recent")}">recently edited</a></div>`;

  let listHtml: string;
  if (sort === "recent") {
    const sorted = files.toSorted((a, b) => (times.get(b) ?? 0) - (times.get(a) ?? 0));
    listHtml = `<ul class="flat">${sorted.map((f) => {
      const active = f === currentRel ? ' class="active"' : "";
      const t = times.get(f);
      const date = t ? new Date(t * 1000).toISOString().slice(0, 10) : "";
      return `<li${active}><a href="${docHref(base, { file: f, sort: "recent" })}" title="${escapeHtml(f)}">${escapeHtml(f)}</a><span class="date">${date}</span></li>`;
    }).join("")}</ul>`;
  } else {
    const counts = new Map<string, number>();
    for (const f of files) {
      const top = f.includes("/") ? f.slice(0, f.indexOf("/")) : "(root)";
      counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    const bigTops = new Set([...counts].filter(([, n]) => n > DOC_TWO_LEVEL_THRESHOLD).map(([k]) => k));
    const groups = new Map<string, string[]>();
    for (const f of files) {
      const key = docGroupKey(f, bigTops);
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(f);
    }
    listHtml = Array.from(groups.entries()).map(([group, gfiles]) => {
      const hasCurrent = gfiles.includes(currentRel);
      const items = gfiles.map((f) => {
        const label = f.startsWith(`${group}/`) ? f.slice(group.length + 1) : f;
        const active = f === currentRel ? ' class="active"' : "";
        return `<li${active}><a href="${docHref(base, { file: f, sort: "path" })}">${escapeHtml(label)}</a></li>`;
      }).join("");
      return `<details${hasCurrent ? " open" : ""}><summary>${escapeHtml(group)} <span class="n">${gfiles.length}</span></summary><ul>${items}</ul></details>`;
    }).join("");
  }
  return `<aside class="docnav"><div class="docnav-head">${files.length} markdown files</div>${toggle}${listHtml}</aside>`;
}

export async function serveDocBrowser(
  base: string,
  { repoRoot, rel, sort, res }: { repoRoot: string; rel: string; sort: string; res: DevResponse },
): Promise<void> {
  // rel is the part after "/docs", e.g. "" | "/" | "/beebox/CLAUDE.md"
  const fileRel = rel.replace(/^\//, "");
  const files = await listRepoMarkdown(repoRoot);
  const times = sort === "recent" ? await mdLastModified(repoRoot, files) : new Map<string, number>();

  let contentHtml: string;
  let title = "doc browser";
  if (fileRel) {
    const resolved = path.resolve(repoRoot, fileRel);
    if (!resolved.startsWith(repoRoot + path.sep) || !resolved.endsWith(".md")) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("forbidden\n");
      return;
    }
    try {
      const src = await fs.readFile(resolved, "utf8");
      // Links to issues/ files aren't rewritten here (unlike the issues
      // browser) — a doc just links wherever it links — so closed-issue
      // detection resolves against the doc's own directory instead of an
      // issues-root-relative one.
      const closedHrefs = findClosedIssueLinkHrefs(src, path.posix.dirname(fileRel.split(path.sep).join("/")));
      contentHtml = `<p style="color:#888;font:12px ui-monospace,monospace;margin-top:0">${escapeHtml(fileRel)}</p>${appendClosedIssuePills(renderMarkdownToHtml(src), closedHrefs)}`;
      title = path.basename(resolved);
    } catch (_e) {
      // Listed but unreadable (raced deletion, permissions) — a 404 either way.
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`not found: ${fileRel}\n`);
      return;
    }
  } else {
    contentHtml = `<div class="placeholder"><h1>Markdown doc browser</h1><p>${files.length} <code>.md</code> files. Pick one from the left.</p></div>`;
  }

  const body = `<div class="docwrap">${renderDocSidebar(base, { files, currentRel: fileRel, sort, times })}<main class="doccontent">${contentHtml}</main></div>${renderDocQuickOpen(base, files)}`;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    renderDevShell({
      title,
      breadcrumbs: devBreadcrumbs(base, fileRel ? `docs/${fileRel}` : "docs"),
      body,
      extraCss: DOC_BROWSER_CSS,
    }),
  );
}
