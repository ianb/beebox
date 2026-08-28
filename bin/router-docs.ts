// The /<worktree>/dev/ space: agent-built views, the artifact manifest, and the
// dev shell every page is rendered into. Extracted from router.ts (Track 8,
// architectural-review-followups — conservative extraction, pure code
// motion) so router.ts can stay focused on process supervision and
// proxying. None of the concurrency machinery documented in bin/CLAUDE.md's
// "Router protocol" section lives here — this module only renders HTML for
// an already-resolved worktree root; it never touches the live `worktrees`
// map, spawns a child, or races another request.
//
// Markdown→HTML rendering lives in the sibling router-markdown.ts; the retired
// /dev/docs browser in router-doc-browser.ts (which imports this file, never the
// other way round).

import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import { escapeHtml, renderMarkdownToHtml } from "./router-markdown.js";

/**
 * The subset of `http.ServerResponse` the dev surfaces write to. Declared
 * structurally so a test can hand in a recording fake without an unsound cast;
 * a real `http.ServerResponse` satisfies it.
 */
export interface DevResponse {
  setHeader(name: string, value: string): void;
  getHeader(name: string): number | string | string[] | undefined;
  writeHead(status: number, headers?: Record<string, string>): void;
  end(chunk?: string | Buffer): void;
}

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
  } catch (_e) {
    // No dev/tools.json in this worktree — the common case.
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

export function renderDevShell({
  title,
  breadcrumbs,
  body,
  extraCss,
}: {
  title: string;
  breadcrumbs: string;
  body: string;
  extraCss?: string;
}): string {
  const css = extraCss ?? "";
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
${css}</style>
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
  const crumbs = ["<a href=\"/\">router</a>", `<a href="${base}/">${escapeHtml(base.replace(/^\//, ""))}</a>`];
  let acc = base;
  for (const [i, part] of parts.entries()) {
    acc += `/${part}`;
    crumbs.push(i === parts.length - 1 ? escapeHtml(part) : `<a href="${acc}/">${escapeHtml(part)}</a>`);
  }
  return crumbs.join(" / ");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The /dev/ manifest landing: the curated list of what you can view here —
 * built-in tools (the markdown doc browser) plus whatever artifacts the agent
 * has dropped in the tracked dev/ directory.
 */
async function renderDevManifest(name: string, { base, devRoot }: { base: string; devRoot: string }): Promise<string> {
  let builtinHtml = `<li><a class="title" href="${base}/docs/">📄 Markdown doc browser</a>`
    + `<div class="desc">Browse and read every <code>.md</code> file in <code>${escapeHtml(name)}</code>, grouped by area, rendered to HTML. A reader that focuses only on docs.</div></li>`
    + `<li><a class="title" href="/${encodeURIComponent(name)}/site/">🌐 Public site preview</a>`
    + "<div class=\"desc\">This worktree's build of the front-door site (<code>site/dist/</code> — run <code>pnpm --dir site build</code> first). What GitHub Pages will serve.</div></li>";

  // Per-worktree extras declared in dev/tools.json (read live from disk).
  builtinHtml += await renderWorktreeToolCards(name, devRoot);

  let artifactsHtml: string;
  try {
    const dirents = (await fs.readdir(devRoot, { withFileTypes: true }))
      .filter((d) => !d.name.startsWith(".") && d.name !== "README.md" && d.name !== "tools.json")
      .toSorted((a, b) =>
        a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1,
      );
    if (dirents.length > 0) {
      const rows = await Promise.all(dirents.map(async (d) => {
        const isDir = d.isDirectory();
        const href = `${base}/${encodeURIComponent(d.name)}${isDir ? "/" : ""}`;
        let size = "";
        if (!isDir) {
          try { size = formatSize((await fs.stat(path.join(devRoot, d.name))).size); } catch (_e) { /* skip */ }
        }
        return `<li><a href="${href}">${escapeHtml(d.name)}${isDir ? "/" : ""}</a><span class="size">${size}</span></li>`;
      }));
      artifactsHtml = `<ul class="dir">${rows.join("")}</ul>`;
    } else {
      artifactsHtml = `<p class="empty">No artifacts yet — the agent drops <code>.html</code> / <code>.md</code> / data files in <code>${escapeHtml(name)}/dev/</code> and they appear here.</p>`;
    }
  } catch (_e) {
    // No dev/ directory in this worktree yet.
    artifactsHtml = `<p class="empty">No <code>dev/</code> directory in <code>${escapeHtml(name)}</code> yet.</p>`;
  }

  const body = `<h1>${escapeHtml(name)} — /dev</h1>
<p class="sub" style="color:#666;margin-top:0">Visualizations &amp; views the agent built for you, from <code>${escapeHtml(name)}</code>'s tracked <code>dev/</code> directory.</p>
<h2>Built-in tools</h2>
<ul class="cards">${builtinHtml}</ul>
<h2>Artifacts in <code>dev/</code></h2>
${artifactsHtml}`;
  return renderDevShell({ title: `${name} · dev`, breadcrumbs: devBreadcrumbs(base, ""), body });
}

// --- static artifacts from the worktree's tracked dev/ directory -------------

async function serveDevArtifact(
  base: string,
  { devRoot, rel, pathOnly, res }: { devRoot: string; rel: string; pathOnly: string; res: DevResponse },
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
  } catch (_e) {
    // Nothing at that path under dev/ — a 404, not an error.
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
  } catch (_e) {
    // A broken symlink, or dev/ itself is gone — indistinguishable from absent.
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
      .toSorted((a, b) =>
        a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1,
      );
    const dirBase = `${base}${rel}`.replace(/\/$/, "");
    const rows = await Promise.all(dirents.map(async (d) => {
      const isDir = d.isDirectory();
      const href = `${dirBase}/${encodeURIComponent(d.name)}${isDir ? "/" : ""}`;
      let size = "";
      if (!isDir) {
        try { size = formatSize((await fs.stat(path.join(resolved, d.name))).size); } catch (_e) { /* skip */ }
      }
      return `<li><a href="${href}">${escapeHtml(d.name)}${isDir ? "/" : ""}</a><span class="size">${size}</span></li>`;
    }));
    const heading = escapeHtml(rel || "/");
    const inner = dirents.length > 0
      ? `<h1>${heading}</h1><ul class="dir">${rows.join("")}</ul>`
      : `<h1>${heading}</h1><p class="empty">empty</p>`;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(renderDevShell({ title: rel || "dev", breadcrumbs: devBreadcrumbs(base, rel.replace(/\/$/, "")), body: inner }));
    return;
  }
  const ext = path.extname(resolved).toLowerCase();
  if (ext === ".md") {
    const src = await fs.readFile(resolved, "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      renderDevShell({ title: path.basename(resolved), breadcrumbs: devBreadcrumbs(base, rel), body: renderMarkdownToHtml(src) }),
    );
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
  res: DevResponse;
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
    res.end(await renderDevManifest(name, { base, devRoot }));
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
  await serveDevArtifact(base, { devRoot, rel, pathOnly, res });
}
