// The /<worktree>/dev/ space: agent-built views, the artifact manifest, and
// the markdown doc browser. Extracted from router.ts (Track 8,
// architectural-review-followups — conservative extraction, pure code
// motion) so router.ts can stay focused on process supervision and
// proxying. None of the concurrency machinery documented in bin/CLAUDE.md's
// "Router protocol" section lives here — this module only renders HTML for
// an already-resolved worktree root; it never touches the live `worktrees`
// map, spawns a child, or races another request.

import path from "node:path";
import fs from "node:fs/promises";
import type http from "node:http";
import { execa } from "execa";
import Markdoc from "@markdoc/markdoc";
import hljs from "highlight.js";
import { z } from "zod";

// Per-worktree extra cards for the /dev/ manifest, declared in the worktree's
// tracked `dev/tools.json` and served straight from disk — so a worktree can add
// its own tools without a router-code change + main-merge. Universal tools (doc
// browser and site preview) stay in code; this is for the rest.
const devToolSchema = z
  .object({
    title: z.string().min(1),
    href: z.string().min(1),
    desc: z.string().default(""),
    emoji: z.string().default("🔧"),
  })
  .strict();
// The retired `scripted` allowlist key is still rejected (strict schema): it
// once granted scripting under the since-removed /dev/ sandbox CSP, and a stale
// copy should degrade loudly rather than be silently half-honored
// (issues/closed/features/2026-07-24-dev-scripted-apps-separate-origin.md).
// Interactive apps with an ask still belong on the exhibits origin — that
// separation is about lifecycle (surviving culls) and the ask workflow, not CSP.
const devToolsFileSchema = z.object({ tools: z.array(devToolSchema) }).strict();
type DevTools = z.infer<typeof devToolsFileSchema>;

// href is worktree-root-relative (`dev/foo/index.html`) → `/<name>/…`;
// an absolute URL (http/https) passes through for linking external dashboards.
function resolveToolHref(name: string, href: string): string {
  if (/^https?:\/\//.test(href)) return href;
  return `/${encodeURIComponent(name)}/${href.replace(/^\/+/, "")}`;
}

// Read + strictly validate a worktree's dev/tools.json. Absent → empty; malformed
// hand-edited config → empty + a loud warn (never 500 the dev index over a
// hand-edited card list).
export async function readDevTools(name: string, devRoot: string): Promise<DevTools> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(devRoot, "tools.json"), "utf8");
  } catch {
    return { tools: [] };
  }
  try {
    return devToolsFileSchema.parse(JSON.parse(raw));
  } catch (e) {
    console.warn(`[dev] ${name}/dev/tools.json is invalid, ignoring it:`, e instanceof Error ? e.message : e);
    return { tools: [] };
  }
}

export async function renderWorktreeToolCards(name: string, devRoot: string): Promise<string> {
  const { tools } = await readDevTools(name, devRoot);
  return tools
    .map(
      (t) =>
        `<li><a class="title" href="${escapeHtml(resolveToolHref(name, t.href))}">${escapeHtml(`${t.emoji} ${t.title}`)}</a>`
        + `<div class="desc">${escapeHtml(t.desc)}</div></li>`,
    )
    .join("");
}

const DEV_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
};

export function escapeHtml(s: string): string {
  const replacements: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return String(s).replace(/[&<>"']/g, (c) => replacements[c] ?? c);
}

export function findClosedIssueLinkHrefs(md: string, docDirRel: string): Set<string> {
  const closedHrefs = new Set<string>();
  for (const match of md.matchAll(/\]\(([^()\s]+)\)/g)) {
    const link = match[1];
    if (
      !link ||
      /^([a-z][a-z0-9+.-]*:)?\/\//iu.test(link) ||
      link.startsWith("/") ||
      link.startsWith("#")
    )
      continue;
    const [target] = link.split("#");
    if (!target?.endsWith(".md")) continue;
    const resolved = path.posix.normalize(path.posix.join(docDirRel, target));
    if (resolved === "issues/closed" || resolved.startsWith("issues/closed/"))
      closedHrefs.add(link);
  }
  return closedHrefs;
}

export function appendClosedIssuePills(
  html: string,
  closedHrefs: ReadonlySet<string>,
): string {
  if (closedHrefs.size === 0) return html;
  const escaped = new Set([...closedHrefs].map(escapeHtml));
  return html.replace(
    /<a\b[^>]*\bhref="([^"]*)"[^>]*>[\s\S]*?<\/a>/gu,
    (tag: string, href: string) =>
      escaped.has(href)
        ? `${tag}<span class="chip chip-closed-link">closed</span>`
        : tag,
  );
}

export function renderDevShell(title: string, breadcrumbs: string, body: string, extraCss = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · /dev</title>
<link rel="icon" type="image/png" href="data:image/png;base64,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">
<style>
  body { font: 15px/1.6 system-ui, sans-serif; max-width: 860px; margin: 0 auto; padding: 1.4em 1.2em 5em; color: #222; }
  nav.crumbs { font: 13px ui-monospace, Menlo, monospace; color: #888; margin-bottom: 1.6em; padding-bottom: 0.7em; border-bottom: 1px solid #eee; }
  nav.crumbs a { color: #2255aa; text-decoration: none; }
  nav.crumbs a:hover { text-decoration: underline; }
  h1 { font-size: 1.5em; } h2 { font-size: 1.2em; margin-top: 1.6em; } h3 { font-size: 1.05em; }
  a { color: #2255aa; }
  code { background: #f3f3f3; padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.9em; }
  pre { background: #f7f7f7; padding: 0.9em 1em; border-radius: 6px; overflow-x: auto; line-height: 1.4; }
  pre code { background: none; padding: 0; }
  .hljs-comment, .hljs-quote { color: #6a737d; font-style: italic; }
  .hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-literal { color: #d73a49; }
  .hljs-type, .hljs-title.class_, .hljs-class .hljs-title { color: #6f42c1; }
  .hljs-string, .hljs-regexp, .hljs-attribute, .hljs-attr, .hljs-template-tag, .hljs-addition { color: #032f62; }
  .hljs-number, .hljs-meta { color: #005cc5; }
  .hljs-title, .hljs-title.function_, .hljs-section, .hljs-name { color: #6f42c1; }
  .hljs-variable, .hljs-property, .hljs-params { color: #24292e; }
  .hljs-symbol, .hljs-bullet, .hljs-deletion { color: #e36209; }
  .hljs-emphasis { font-style: italic; } .hljs-strong { font-weight: 700; }
  table { border-collapse: collapse; margin: 1em 0; font-size: 0.93em; }
  th, td { border: 1px solid #ddd; padding: 0.4em 0.7em; text-align: left; vertical-align: top; }
  th { background: #f4f4f4; }
  blockquote { margin: 1em 0; padding: 0.3em 1em; border-left: 4px solid #d0deef; background: #f7faff; color: #444; }
  ul.dir { list-style: none; padding: 0; font: 14px ui-monospace, Menlo, monospace; }
  ul.dir li { padding: 0.35em 0; border-bottom: 1px solid #f0f0f0; display: flex; gap: 0.8em; }
  ul.dir a { text-decoration: none; min-width: 22em; }
  ul.dir a:hover { text-decoration: underline; }
  ul.dir .size { color: #999; }
  .cards { list-style: none; padding: 0; margin: 0.6em 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 0.7em; }
  .cards li { display: flex; flex-direction: column; padding: 0.9em 1em; margin: 0; border: 1px solid #e3e3e3; border-radius: 8px; background: #fbfbfb; }
  .cards li:hover { border-color: #c7d4ea; background: #fcfdff; }
  .cards a.title { font-weight: 600; font-size: 1.05em; text-decoration: none; }
  .cards .desc { color: #666; font-size: 0.9em; margin-top: 0.35em; }
  .empty { color: #888; font-style: italic; }
${extraCss}</style>
</head>
<body>
${breadcrumbs ? `<nav class="crumbs">${breadcrumbs}</nav>` : ""}
${body}
</body>
</html>`;
}

// Build "<base> / sub / file.md" breadcrumbs (base like "/main/dev"); every
// segment but the last links.
export function devBreadcrumbs(base: string, rel: string): string {
  const parts = rel.split("/").filter(Boolean);
  const crumbs = [`<a href="/">router</a>`, `<a href="${base}/">${escapeHtml(base.replace(/^\//, ""))}</a>`];
  let acc = base;
  parts.forEach((part, i) => {
    acc += `/${part}`;
    crumbs.push(i === parts.length - 1 ? escapeHtml(part) : `<a href="${acc}/">${escapeHtml(part)}</a>`);
  });
  return crumbs.join(" / ");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

// Markdoc emits code fences as `<pre data-language="ts">escaped code</pre>`, or a
// plain `<pre>` when the fence has no language token. Re-run each block through
// highlight.js (already a dep) so code gets syntax colors. Un-tagged blocks
// default to `defaultLang` (ts — the language we write nearly everywhere, and
// what the doctests are even when their continue/cleanup fences omit it).
function highlightCodeBlocks(html: string, defaultLang: string): string {
  return html.replace(/<pre(?: data-language="([^"]*)")?>([\s\S]*?)<\/pre>/g, (_m, lang: string | undefined, body: string) => {
    const code = unescapeHtml(body);
    let language = lang && hljs.getLanguage(lang) ? lang : "";
    if (!language && defaultLang && hljs.getLanguage(defaultLang)) language = defaultLang;
    let inner: string;
    try {
      inner = language ? hljs.highlight(code, { language }).value : escapeHtml(code);
    } catch {
      inner = escapeHtml(code);
    }
    const cls = language ? ` class="language-${escapeHtml(language)}"` : "";
    return `<pre class="hljs"><code${cls}>${inner}</code></pre>`;
  });
}

// Markdoc has no GFM-style autolinking, so a bare `https://…` in a doc renders
// as dead text. Our issues cite sources as bare URLs constantly, so linkify them
// after render.
//
// Operating on the HTML (not the markdown source) is deliberate: at this stage
// the protected regions are unambiguous tags rather than markdown syntax we'd
// have to re-parse. The split alternation captures, in order, whole <a> and
// <pre>/<code> elements and then ANY remaining tag — so the only pieces left
// untouched by the capture are true text nodes. That means we can't linkify
// inside an existing link (nested <a> is invalid), inside code, or inside a tag
// attribute (the classic way naive linkifiers corrupt an href).
//
// Text here is already HTML-escaped by Markdoc, so a URL's `&` arrives as
// `&amp;` — which is also what it should be inside the emitted href, so it
// round-trips correctly without special handling.
const PROTECTED_HTML = /(<a\b[^>]*>[\s\S]*?<\/a>|<pre\b[\s\S]*?<\/pre>|<code\b[\s\S]*?<\/code>|<[^>]+>)/gi;
const BARE_URL = /\bhttps?:\/\/[^\s<>"'`]+/g;

/** Trailing characters that are almost always sentence punctuation, not URL. */
function trimUrlTail(url: string): { href: string; tail: string } {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1] ?? "";
    if (".,;:!?".includes(ch)) { end -= 1; continue; }
    // A closing paren/bracket only belongs to the URL if it's balanced within
    // it — `(see https://x.com/a)` ends the sentence, but a Wikipedia URL like
    // `…/Foo_(bar)` legitimately ends in one.
    if (ch === ")" || ch === "]") {
      const open = ch === ")" ? "(" : "[";
      const slice = url.slice(0, end);
      const opens = slice.split(open).length - 1;
      const closes = slice.split(ch).length - 1;
      if (closes > opens) { end -= 1; continue; }
    }
    break;
  }
  return { href: url.slice(0, end), tail: url.slice(end) };
}

function autolinkUrls(html: string): string {
  return html
    .split(PROTECTED_HTML)
    .map((part, i) => {
      // Odd indices are the captured protected regions — pass through verbatim.
      if (i % 2 === 1) return part;
      return part.replace(BARE_URL, (match) => {
        const { href, tail } = trimUrlTail(match);
        if (!href) return match;
        return `<a href="${href}">${href}</a>${tail}`;
      });
    })
    .join("");
}

export function renderMarkdownToHtml(src: string, defaultLang = "ts"): string {
  const html = autolinkUrls(
    highlightCodeBlocks(Markdoc.renderers.html(Markdoc.transform(Markdoc.parse(src))), defaultLang),
  );
  return html.replace(/<h2>Manual testing<\/h2>/g, '<h2 id="manual-testing">Manual testing</h2>');
}

/**
 * The /dev/ manifest landing: the curated list of what you can view here —
 * built-in tools (the markdown doc browser) plus whatever artifacts the agent
 * has dropped in the tracked dev/ directory.
 */
async function renderDevManifest(name: string, base: string, devRoot: string): Promise<string> {
  let builtinHtml = `<li><a class="title" href="${base}/docs/">📄 Markdown doc browser</a>`
    + `<div class="desc">Browse and read every <code>.md</code> file in <code>${escapeHtml(name)}</code>, grouped by area, rendered to HTML. A reader that focuses only on docs.</div></li>`
    + `<li><a class="title" href="/${encodeURIComponent(name)}/site/">🌐 Public site preview</a>`
    + `<div class="desc">This worktree's build of the front-door site (<code>site/dist/</code> — run <code>pnpm --dir site build</code> first). What GitHub Pages will serve.</div></li>`;

  // Per-worktree extras declared in dev/tools.json (read live from disk).
  builtinHtml += await renderWorktreeToolCards(name, devRoot);

  let artifactsHtml: string;
  try {
    const dirents = (await fs.readdir(devRoot, { withFileTypes: true }))
      .filter((d) => !d.name.startsWith(".") && d.name !== "README.md" && d.name !== "tools.json")
      .sort((a, b) =>
        a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1,
      );
    if (dirents.length) {
      const rows = await Promise.all(dirents.map(async (d) => {
        const isDir = d.isDirectory();
        const href = `${base}/${encodeURIComponent(d.name)}${isDir ? "/" : ""}`;
        let size = "";
        if (!isDir) {
          try { size = formatSize((await fs.stat(path.join(devRoot, d.name))).size); } catch { /* skip */ }
        }
        return `<li><a href="${href}">${escapeHtml(d.name)}${isDir ? "/" : ""}</a><span class="size">${size}</span></li>`;
      }));
      artifactsHtml = `<ul class="dir">${rows.join("")}</ul>`;
    } else {
      artifactsHtml = `<p class="empty">No artifacts yet — the agent drops <code>.html</code> / <code>.md</code> / data files in <code>${escapeHtml(name)}/dev/</code> and they appear here.</p>`;
    }
  } catch {
    artifactsHtml = `<p class="empty">No <code>dev/</code> directory in <code>${escapeHtml(name)}</code> yet.</p>`;
  }

  const body = `<h1>${escapeHtml(name)} — /dev</h1>
<p class="sub" style="color:#666;margin-top:0">Visualizations &amp; views the agent built for you, from <code>${escapeHtml(name)}</code>'s tracked <code>dev/</code> directory.</p>
<h2>Built-in tools</h2>
<ul class="cards">${builtinHtml}</ul>
<h2>Artifacts in <code>dev/</code></h2>
${artifactsHtml}`;
  return renderDevShell(`${name} · dev`, devBreadcrumbs(base, ""), body);
}

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
    } catch { /* no scratch/ or git quirk — just skip it */ }

    return Array.from(new Set(files)).sort();
  } catch {
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
  } catch { /* leave empty */ }
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
        } catch { /* unreadable — skip */ }
      }),
  );
  return times;
}

// A top-level area with more than this many .md files is split into a second
// level (e.g. callback-box/ → callback-box/docs, callback-box/test, …). Smaller
// areas stay flat — the flatness is nice when it fits.
const DOC_TWO_LEVEL_THRESHOLD = 60;

function docHref(base: string, f: string, sort: string): string {
  const q = sort === "recent" ? "?sort=recent" : "";
  return `${base}/docs/${f.split("/").map(encodeURIComponent).join("/")}${q}`;
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
function renderDocSidebar(base: string, files: string[], currentRel: string, sort: string, times: Map<string, number>): string {
  const indexHref = (s: string) => `${base}/docs/${s === "recent" ? "?sort=recent" : ""}`;
  const curHref = (s: string) => (currentRel ? docHref(base, currentRel, s) : indexHref(s));
  const toggle = `<div class="docsort">`
    + `<a class="${sort !== "recent" ? "on" : ""}" href="${curHref("path")}">by path</a> · `
    + `<a class="${sort === "recent" ? "on" : ""}" href="${curHref("recent")}">recently edited</a></div>`;

  let listHtml: string;
  if (sort === "recent") {
    const sorted = [...files].sort((a, b) => (times.get(b) ?? 0) - (times.get(a) ?? 0));
    listHtml = `<ul class="flat">${sorted.map((f) => {
      const active = f === currentRel ? ' class="active"' : "";
      const t = times.get(f);
      const date = t ? new Date(t * 1000).toISOString().slice(0, 10) : "";
      return `<li${active}><a href="${docHref(base, f, "recent")}" title="${escapeHtml(f)}">${escapeHtml(f)}</a><span class="date">${date}</span></li>`;
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
        return `<li${active}><a href="${docHref(base, f, "path")}">${escapeHtml(label)}</a></li>`;
      }).join("");
      return `<details${hasCurrent ? " open" : ""}><summary>${escapeHtml(group)} <span class="n">${gfiles.length}</span></summary><ul>${items}</ul></details>`;
    }).join("");
  }
  return `<aside class="docnav"><div class="docnav-head">${files.length} markdown files</div>${toggle}${listHtml}</aside>`;
}

const DOC_BROWSER_CSS = `
  body { max-width: none; padding: 0; }
  .chip-closed-link { display: inline-block; margin: 0 0 0 0.4em; padding: 0.15em 0.55em; border-radius: 10px; background: #eef1f5; color: #555; font-size: 0.78em; text-decoration: none; }
  nav.crumbs { padding: 0.7em 1.2em; margin: 0; }
  .docwrap { display: flex; align-items: flex-start; gap: 0; }
  aside.docnav { flex: 0 0 20em; position: sticky; top: 0; max-height: 100vh; overflow-y: auto; border-right: 1px solid #eee; padding: 0.5em 0.8em 3em; font: 13px ui-monospace, Menlo, monospace; }
  .docnav-head { color: #888; font-size: 0.85em; margin: 0.4em 0 0.4em; }
  .docsort { font-size: 0.85em; margin: 0 0 0.9em; }
  .docsort a { text-decoration: none; color: #999; }
  .docsort a.on { color: #222; font-weight: 700; }
  aside.docnav details { margin-bottom: 0.3em; }
  aside.docnav summary { cursor: pointer; color: #444; padding: 0.2em 0; }
  aside.docnav summary .n { color: #aaa; font-size: 0.85em; }
  aside.docnav ul { list-style: none; padding: 0 0 0.4em 0.9em; margin: 0.2em 0; }
  aside.docnav li { padding: 0.12em 0; }
  aside.docnav li a { text-decoration: none; color: #2255aa; }
  aside.docnav li.active a { font-weight: 700; color: #a2380a; }
  aside.docnav ul.flat { padding-left: 0; }
  aside.docnav ul.flat li { display: flex; justify-content: space-between; gap: 0.6em; align-items: baseline; }
  aside.docnav ul.flat li a { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  aside.docnav ul.flat .date { color: #aaa; font-size: 0.8em; white-space: nowrap; }
  main.doccontent { flex: 1 1 auto; min-width: 0; max-width: 820px; padding: 0.5em 2em 5em; }
  main.doccontent .placeholder { color: #888; margin-top: 3em; }
  .qo-hint { position: fixed; bottom: 0.7em; right: 1em; font: 11px ui-monospace, monospace; color: #bbb; user-select: none; }
  .qo-hint kbd { background: #f0f0f0; border: 1px solid #ddd; border-bottom-width: 2px; border-radius: 4px; padding: 0.05em 0.35em; color: #666; }
  .qo-backdrop { position: fixed; inset: 0; background: rgba(20,20,25,0.28); display: flex; align-items: flex-start; justify-content: center; z-index: 1000; }
  .qo-backdrop[hidden] { display: none; }
  .qo-panel { margin-top: 12vh; width: min(620px, 92vw); background: #fff; border: 1px solid #ccc; border-radius: 10px; box-shadow: 0 12px 48px rgba(0,0,0,0.25); overflow: hidden; }
  .qo-panel input { width: 100%; box-sizing: border-box; border: 0; border-bottom: 1px solid #eee; padding: 0.8em 1em; font: 15px system-ui, sans-serif; outline: none; }
  .qo-results { list-style: none; margin: 0; padding: 0.3em 0; max-height: 52vh; overflow-y: auto; font: 13px ui-monospace, Menlo, monospace; }
  .qo-results li { padding: 0.35em 1em; cursor: pointer; display: flex; align-items: baseline; gap: 0.55em; white-space: nowrap; overflow: hidden; }
  .qo-results li.sel { background: #eef3fb; }
  .qo-results .qo-name { color: #222; text-overflow: ellipsis; overflow: hidden; }
  .qo-results li.sel .qo-name { color: #a2380a; }
  .qo-results .qo-dir { color: #aaa; font-size: 0.86em; text-overflow: ellipsis; overflow: hidden; }
  .qo-results mark { background: none; color: #2255aa; font-weight: 700; }
  .qo-results li.sel mark { color: #a2380a; }
  .qo-empty { padding: 0.7em 1em; color: #999; font: 13px ui-monospace, monospace; }
`;

// VS-Code-style Cmd-P / Ctrl-P quick-open over the full doc list. Self-contained
// vanilla overlay: the file list ships as JSON, a compact subsequence fuzzy
// scorer ranks matches (basename + contiguous runs favoured), keyboard-first.
// `files` are already collected server-side; `base` is like "/main/dev".
function renderDocQuickOpen(base: string, files: string[]): string {
  // Serialize for a <script> context: neutralize "</script>" and JS line
  // separators so the array survives inline embedding.
  const filesJson = JSON.stringify(files)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const baseJson = JSON.stringify(base).replace(/</g, "\\u003c");
  return `<div class="qo-hint"><kbd id="qo-hint-key">Ctrl-P</kbd> quick open</div>
<div class="qo-backdrop" id="qo" hidden role="dialog" aria-modal="true" aria-label="Quick open document">
  <div class="qo-panel">
    <input id="qo-input" type="text" placeholder="Go to doc…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="qo-results" aria-autocomplete="list">
    <ul class="qo-results" id="qo-results" role="listbox"></ul>
  </div>
</div>
<script>
(function () {
  var FILES = ${filesJson};
  var BASE = ${baseJson};
  var LIMIT = 50;
  var backdrop = document.getElementById("qo");
  var input = document.getElementById("qo-input");
  var list = document.getElementById("qo-results");
  var matches = [];
  var sel = 0;
  var lastFocus = null;
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var hintKey = document.getElementById("qo-hint-key");
  if (isMac && hintKey) hintKey.textContent = "⌘P";

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Greedy leftmost subsequence match with positional scoring. Returns
  // {score, pos:[indices]} or null when q is not a subsequence of target.
  function score(q, target) {
    if (!q) return { score: 0, pos: [] };
    var t = target.toLowerCase();
    var ql = q.toLowerCase();
    var slash = target.lastIndexOf("/");
    var pos = [];
    var total = 0;
    var ti = 0;
    var prev = -2;
    for (var qi = 0; qi < ql.length; qi++) {
      var found = -1;
      for (var j = ti; j < t.length; j++) { if (t[j] === ql[qi]) { found = j; break; } }
      if (found === -1) return null;
      var s = 1;
      if (found === prev + 1) s += 5;                                  // contiguous run
      var pc = found > 0 ? t[found - 1] : "/";
      if (pc === "/" || pc === "-" || pc === "_" || pc === "." || pc === " ") s += 3; // word start
      if (found > slash) s += 4;                                       // inside basename
      if (found === slash + 1) s += 3;                                 // at basename start
      total += s;
      pos.push(found);
      prev = found;
      ti = found + 1;
    }
    total -= target.length * 0.02;                                     // mild shortness bias
    return { score: total, pos: pos };
  }

  function compute(q) {
    var out = [];
    for (var i = 0; i < FILES.length; i++) {
      var r = score(q, FILES[i]);
      if (r) out.push({ file: FILES[i], score: r.score, pos: r.pos, i: i });
    }
    out.sort(function (a, b) { return b.score - a.score || a.file.localeCompare(b.file); });
    return out.slice(0, LIMIT);
  }

  // Render one path with matched chars marked, basename vs dir split visually.
  function markup(file, pos) {
    var set = {};
    for (var k = 0; k < pos.length; k++) set[pos[k]] = true;
    var slash = file.lastIndexOf("/");
    var dir = slash >= 0 ? file.slice(0, slash + 1) : "";
    var html = "";
    for (var c = 0; c < file.length; c++) {
      var ch = esc(file[c]);
      html += set[c] ? "<mark>" + ch + "</mark>" : ch;
      if (c === slash) html = '<span class="qo-dir">' + html + '</span><span class="qo-name">';
    }
    if (slash >= 0) html += "</span>";
    else html = '<span class="qo-name">' + html + "</span>";
    return html;
  }

  function render() {
    if (!matches.length) {
      list.innerHTML = '<li class="qo-empty" role="option">No matching docs</li>';
      return;
    }
    var h = "";
    for (var i = 0; i < matches.length; i++) {
      h += '<li role="option" data-i="' + i + '"' + (i === sel ? ' class="sel" aria-selected="true"' : "") + ">" + markup(matches[i].file, matches[i].pos) + "</li>";
    }
    list.innerHTML = h;
    var selEl = list.querySelector("li.sel");
    if (selEl) selEl.scrollIntoView({ block: "nearest" });
  }

  function refresh() {
    matches = compute(input.value.trim());
    sel = 0;
    render();
  }

  function open() {
    if (!backdrop.hidden) return;
    lastFocus = document.activeElement;
    backdrop.hidden = false;
    input.value = "";
    refresh();
    input.focus();
  }

  function close() {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function go() {
    var m = matches[sel];
    if (!m) return;
    var url = BASE + "/docs/" + m.file.split("/").map(encodeURIComponent).join("/");
    location.href = url;
  }

  document.addEventListener("keydown", function (e) {
    // Cmd-P (mac) / Ctrl-P — intercept the browser print shortcut.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === "p" || e.key === "P")) {
      e.preventDefault();
      if (backdrop.hidden) open(); else close();
      return;
    }
    if (backdrop.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); if (matches.length) { sel = (sel + 1) % matches.length; render(); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (matches.length) { sel = (sel - 1 + matches.length) % matches.length; render(); } }
    else if (e.key === "Enter") { e.preventDefault(); go(); }
    else if (e.key === "Tab") { e.preventDefault(); } // trap focus in the dialog
  });

  input.addEventListener("input", refresh);
  list.addEventListener("mousemove", function (e) {
    var li = e.target.closest("li[data-i]");
    if (li) { var i = Number(li.getAttribute("data-i")); if (i !== sel) { sel = i; render(); } }
  });
  list.addEventListener("click", function (e) {
    var li = e.target.closest("li[data-i]");
    if (li) { sel = Number(li.getAttribute("data-i")); go(); }
  });
  backdrop.addEventListener("mousedown", function (e) { if (e.target === backdrop) close(); });
})();
</script>`;
}

async function serveDocBrowser(base: string, repoRoot: string, rel: string, sort: string, res: http.ServerResponse): Promise<void> {
  // rel is the part after "/docs", e.g. "" | "/" | "/callback-box/CLAUDE.md"
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
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`not found: ${fileRel}\n`);
      return;
    }
  } else {
    contentHtml = `<div class="placeholder"><h1>Markdown doc browser</h1><p>${files.length} <code>.md</code> files. Pick one from the left.</p></div>`;
  }

  const body = `<div class="docwrap">${renderDocSidebar(base, files, fileRel, sort, times)}<main class="doccontent">${contentHtml}</main></div>${renderDocQuickOpen(base, files)}`;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(renderDevShell(title, devBreadcrumbs(base, fileRel ? `docs/${fileRel}` : "docs"), body, DOC_BROWSER_CSS));
}

// --- static artifacts from the worktree's tracked dev/ directory -------------

async function serveDevArtifact(
  base: string,
  devRoot: string,
  rel: string,
  pathOnly: string,
  res: http.ServerResponse,
): Promise<void> {
  const resolved = path.resolve(devRoot, `.${rel || "/"}`);
  if (resolved !== devRoot && !resolved.startsWith(devRoot + path.sep)) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden\n");
    return;
  }
  // No dotfile segment, at any depth. The directory listing already hides them
  // (see the readdir filter below), so serving them on a direct request was an
  // inconsistency — and `dev/` is a working directory agents write into, so a
  // stray `dev/.env` or a `dev/apps/<name>/.git/config` is a plausible accident
  // rather than a contrived one. Cheap to close, and it matters more now that
  // the browse key can read this surface (cross-model review, 2026-08-24).
  // Checked on the RESOLVED path, not the raw `rel`: a legitimate request may
  // contain `..` segments that normalize away inside dev/ (see the encoded-dot
  // cases in bin/router-docs.test.ts), and those must still resolve.
  if (path.relative(devRoot, resolved).split(path.sep).some((segment) => segment.startsWith("."))) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end(`not found in dev/: ${rel}\n`);
    return;
  }
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end(`not found in dev/: ${rel}\n`);
    return;
  }
  // Resolve symlinks and RE-check containment: the lexical guard above only sees
  // the path text, but fs.stat/readFile follow symlinks, so a link inside dev/
  // could otherwise serve bytes from anywhere readable. Compare realpath-to-
  // realpath (devRoot itself may sit behind a symlink, e.g. macOS /var →
  // /private/var).
  let realResolved: string;
  let realDevRoot: string;
  try {
    realResolved = await fs.realpath(resolved);
    realDevRoot = await fs.realpath(devRoot);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end(`not found in dev/: ${rel}\n`);
    return;
  }
  if (realResolved !== realDevRoot && !realResolved.startsWith(realDevRoot + path.sep)) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden\n");
    return;
  }
  if (stat.isDirectory()) {
    if (!pathOnly.endsWith("/")) {
      res.writeHead(301, { location: `${base}${rel}/` });
      res.end();
      return;
    }
    const dirents = (await fs.readdir(resolved, { withFileTypes: true }))
      .filter((d) => !d.name.startsWith("."))
      .sort((a, b) =>
        a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1,
      );
    const dirBase = `${base}${rel}`.replace(/\/$/, "");
    const rows = await Promise.all(dirents.map(async (d) => {
      const isDir = d.isDirectory();
      const href = `${dirBase}/${encodeURIComponent(d.name)}${isDir ? "/" : ""}`;
      let size = "";
      if (!isDir) {
        try { size = formatSize((await fs.stat(path.join(resolved, d.name))).size); } catch { /* skip */ }
      }
      return `<li><a href="${href}">${escapeHtml(d.name)}${isDir ? "/" : ""}</a><span class="size">${size}</span></li>`;
    }));
    const heading = escapeHtml(rel || "/");
    const inner = dirents.length
      ? `<h1>${heading}</h1><ul class="dir">${rows.join("")}</ul>`
      : `<h1>${heading}</h1><p class="empty">empty</p>`;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(renderDevShell(rel || "dev", devBreadcrumbs(base, rel.replace(/\/$/, "")), inner));
    return;
  }
  const ext = path.extname(resolved).toLowerCase();
  if (ext === ".md") {
    const src = await fs.readFile(resolved, "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(renderDevShell(path.basename(resolved), devBreadcrumbs(base, rel), renderMarkdownToHtml(src)));
    return;
  }
  const buf = await fs.readFile(resolved);
  res.writeHead(200, {
    "content-type": DEV_CONTENT_TYPES[ext] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  res.end(buf);
}

/**
 * Dispatch everything under /<name>/dev/. `rest` is the URL after /<name>.
 * `repoRoot` is the caller-resolved worktree root (router.ts's
 * `worktreeRoot(name)`) — passed in rather than resolved here so this module
 * never needs to import router.ts's MAIN_ROOT/WORKTREES_ROOT config (which
 * would create a value-import cycle, since router.ts imports `escapeHtml`
 * and `serveDev` from here). `mainRoot`/`worktreesRoot` are those same
 */
export async function serveDev(params: {
  name: string;
  rest: string;
  res: http.ServerResponse;
  repoRoot: string;
}): Promise<void> {
  const { name, rest, res, repoRoot } = params;
  // The /dev/ space is live working material — never let the browser cache it.
  // Set here so every response below (manifest, doc browser, .md, dir index,
  // static artifacts) inherits it; nothing overrides cache-control to anything
  // weaker. Edits show on reload with no server restart.
  res.setHeader("Cache-Control", "no-store, max-age=0");
  // SECURITY — the `sandbox` CSP that used to cover every /dev/ response
  // (expose-dev-router B.2c) was REMOVED by boxholder decision, 2026-08-19.
  // It made normal content broken in non-obvious ways: the opaque origin sent
  // image subrequests out cookieless (401'd by the auth gate, so every image
  // in rendered markdown showed broken), and inline scripts in plain HTML
  // pages silently died. The threat it defended against — agent-authored
  // pages scripting same-origin requests at router control routes — is
  // already an accepted residual for this router: every worktree frontend is
  // agent-authored JS running unsandboxed on this same origin (workstreams
  // plan, "same-origin worktree frontends", accepted 2026-08-09; the router
  // is only exposed on localhost or the owner's tailnet). The boxholder's
  // sharper framing (2026-08-19): the dev agent authors the router's own
  // code, so sandboxing its HTML output guards nothing — an agent that
  // wanted to misbehave "could do bad things everywhere". An independent
  // origin for agent-authored surfaces stays the ideal if that trust
  // assumption ever weakens (see
  // issues/exploration/2026-08-19-independent-origin-for-dev-surfaces.md). Sandboxing /dev/
  // alone therefore blocked normal pages without narrowing the actual attack
  // surface. The destructive control verbs (`/__router/{stop,retry}`,
  // `/workstreams/action/*`) remain POST-only + CSRF-classified (`control` in
  // router-auth.ts); GETs behind the router can still lazy-start processes
  // (`/__router/dashboard/<name>`, any worktree path) — that is the router's
  // core design, not a mutation this change exposes. Background:
  // issues/bugs/2026-08-19-dev-md-images-broken-opaque-origin.md.
  const base = `/${name}/dev`;
  const devRoot = path.join(repoRoot, "dev");
  const [pathOnly = ""] = rest.split("?");
  // A malformed `%`-escape (e.g. `/dev/%zz`) makes decodeURIComponent throw a
  // URIError. Unguarded it would reject this async handler and — absent the
  // router.ts request-boundary — could crash the SHARED router (taking down
  // every worktree). Guard it to a 400 for this one request (DoS boundary,
  // expose-dev-router B.2c / finding 3).
  let rel: string; // "" | "/" | "/docs/..." | "/foo.html"
  try {
    rel = decodeURIComponent(pathOnly.slice("/dev".length));
  } catch (e) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end(`bad request: malformed percent-encoding in path (${e instanceof Error ? e.message : String(e)})\n`);
    return;
  }
  if (rel === "" || rel === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(await renderDevManifest(name, base, devRoot));
    return;
  }
  // RETIRED into the general browser (docs/plans/general-browser.md, Track 5).
  //
  // The doc browser's job — read any markdown in this worktree — is now
  // `/workstreams/browse?file=…`, which does it for every file kind, with the
  // cross-workstream lens and commenting attached. Redirecting rather than
  // deleting keeps every bookmark and every pasted link working.
  //
  // Note the address change this encodes: `/<worktree>/dev/docs/<path>` put the
  // WORKTREE first and the file second. The replacement puts the file in the
  // address and the worktree in a lens — "enter a universal view, then filter by
  // workstream if I care to."
  if (rel === "/docs" || rel === "/docs/" || rel.startsWith("/docs/")) {
    const file = rel.startsWith("/docs/") ? rel.slice("/docs/".length) : "";
    const search = new URLSearchParams();
    if (file !== "") search.set("file", file);
    // `main` is the unlensed address; any other worktree becomes the lens.
    if (name !== "main") search.set("workstream", name);
    const query = search.toString();
    res.writeHead(301, { location: `/workstreams/browse${query === "" ? "" : `?${query}`}` });
    res.end();
    return;
  }
  await serveDevArtifact(base, devRoot, rel, pathOnly, res);
}
