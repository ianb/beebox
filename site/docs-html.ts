// Spartan HTML rendering for the agent-docs corpus (site/CLAUDE.md, "Agent
// docs"). Every corpus page (a doc, a directory index.md, the front page,
// the contributor/install entry pages) gets an HTML twin beside its
// markdown, rendered through the site's own Markdoc pipeline (render.ts) but
// through `renderCorpusMarkdown`, not `renderBody`: corpus pages carry no
// custom tags, so there is nothing to validate a tag schema against, and a
// literal `{% … %}` shown as prose (the generated engine docs quote the
// syntax) must read as text, not markup.

import fs from "node:fs/promises";
import path from "node:path";
import { renderComparedCaveat } from "./docs-compared.js";
import type { DocsBuildResult } from "./docs.js";
import { renderAgentLlmsTxt, renderEntryLlmsTxt, type SitePageSummary } from "./docs-index.js";
import { docsOrigin } from "./docs-origin.js";
import type { PublishedDoc } from "./docs-types.js";
import { escapeHtml, renderCorpusMarkdown } from "./render.js";

const CODE_SPLIT_RE = /(```[\S\s]*?```|`[^\n`]*`)/g;

/**
 * Escape every literal `{%` outside a fenced code block or inline code span
 * to `&#123;%`, so Markdoc's parser treats a prose example of tag syntax as
 * plain text instead of attempting (and failing) to parse it as a tag.
 */
export function escapeMarkdocBraces(markdown: string): string {
  return markdown
    .split(CODE_SPLIT_RE)
    .map((part, i) => (i % 2 === 1 ? part : part.replaceAll("{%", "&#123;%")))
    .join("");
}

/**
 * Rewrite every already-absolute corpus link (`<origin><base>docs/<path>.md`,
 * optionally `#anchor`) to its `.html` form. Corpus markdown only ever
 * carries such links already resolved to absolute URLs (docs-links.ts runs
 * before this), so a plain string rewrite over the markdown source is
 * enough — no need to walk a parsed tree. External links and images never
 * match this prefix and pass through untouched.
 */
const TARGET_BOUNDARY_RE = /[\s"#')]/;
const ANCHOR_BOUNDARY_RE = /[\s"')]/;

/**
 * The URL of a corpus page's rendered form, given its published path without
 * the `.md`. Cloudflare Pages serves clean URLs and answers a `.html` request
 * with a 308 to the extensionless form (`index.html` to the directory), so
 * the canonical build links the clean form directly and no fetcher has to
 * follow a redirect. The dev router serves the files as written, so it keeps
 * the `.html` form.
 */
export function renderedHref(stem: string, base: string): string {
  const prefix = `${docsOrigin(base)}${base}docs/`;
  if (base !== "/") return `${prefix}${stem}.html`;
  if (stem === "index") return prefix;
  if (stem.endsWith("/index")) return `${prefix}${stem.slice(0, -"index".length)}`;
  return `${prefix}${stem}`;
}

export function rewriteCorpusLinksToHtml(markdown: string, params: { base: string }): string {
  const prefix = `${docsOrigin(params.base)}${params.base}docs/`;
  let out = "";
  let idx = 0;
  for (;;) {
    const start = markdown.indexOf(prefix, idx);
    if (start === -1) {
      out += markdown.slice(idx);
      break;
    }
    out += markdown.slice(idx, start);
    let end = start + prefix.length;
    while (end < markdown.length && !TARGET_BOUNDARY_RE.test(markdown[end] ?? "")) end++;
    const target = markdown.slice(start + prefix.length, end);
    let rest = end;
    let anchor = "";
    if (markdown[rest] === "#") {
      const anchorStart = rest;
      rest++;
      while (rest < markdown.length && !ANCHOR_BOUNDARY_RE.test(markdown[rest] ?? "")) rest++;
      anchor = markdown.slice(anchorStart, rest);
    }
    out += target.endsWith(".md") ? `${renderedHref(target.slice(0, -3), params.base)}${anchor}` : markdown.slice(start, rest);
    idx = rest;
  }
  return out;
}

/** First `# Heading` text in a markdown body, or `undefined` if there is none. */
function firstH1(markdown: string): string | undefined {
  const match = /^#\s+(.+)$/m.exec(markdown);
  const title = match?.[1]?.trim();
  return title === undefined || title === "" ? undefined : title;
}

const STYLE = [
  "<style>",
  "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;",
  "max-width:72ch;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#1a1a1a;background:#fff}",
  "pre,code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
  "pre{background:#f4f4f4;padding:.75rem;overflow-x:auto;white-space:pre-wrap;word-wrap:break-word}",
  "code{background:#f4f4f4;padding:.15em .3em;border-radius:3px}",
  "pre code{background:none;padding:0}",
  "a{color:#0645ad}",
  "nav,footer{font-size:.85em;color:#555}",
  "footer{margin-top:2rem;border-top:1px solid #ddd;padding-top:1rem}",
  "</style>",
].join("");

/** The complete HTML document shell: doctype, head (title + one inline style), body. */
export function htmlDocumentShell(params: { title: string; bodyHtml: string }): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(params.title)}</title>`,
    STYLE,
    "</head>",
    "<body>",
    params.bodyHtml,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function directoryOf(publishPath: string): string {
  const dir = path.posix.dirname(publishPath);
  return dir === "." ? "" : dir;
}

/**
 * The one-line `<nav>` a corpus page carries: the same three links as the
 * `.md` twin's header line (directory, index, root front page), pointed at
 * their `.html` forms — except the root link, which is `llms.txt` on both
 * sides (that file is HTML now too, so there is no separate `.html` form of
 * it to point at instead).
 */
export function corpusNavHtml(params: { publishPath: string; base: string }): string {
  const { publishPath, base } = params;
  const origin = docsOrigin(base);
  const dir = directoryOf(publishPath);
  const directoryUrl = dir === "" ? `${origin}${base}docs/` : `${origin}${base}docs/${dir}/`;
  const indexUrl = dir === "" ? `${origin}${base}llms.txt` : renderedHref(`${dir}/index`, base);
  const rootUrl = `${origin}${base}llms.txt`;
  return `<nav><a href="${directoryUrl}">directory</a> · <a href="${indexUrl}">index</a> · <a href="${rootUrl}">Bee Box docs</a></nav>`;
}

function prepare(markdown: string, base: string): string {
  return escapeMarkdocBraces(rewriteCorpusLinksToHtml(markdown, { base }));
}

/** Render one published doc (`dist/docs/<path>.html`, beside its `.md`). */
export function renderCorpusPageHtml(params: { doc: PublishedDoc; base: string }): string {
  const { doc, base } = params;
  const origin = docsOrigin(base);
  const parts: string[] = [];
  if (doc.compared) parts.push(...renderComparedCaveat(doc.compared), "");
  parts.push(doc.body.trim());
  const bodyHtml = renderCorpusMarkdown(prepare(parts.join("\n"), base), doc.sourceLabel);
  const title = firstH1(doc.body) ?? doc.publishPath;
  const nav = corpusNavHtml({ publishPath: doc.publishPath, base });
  const mdUrl = `${origin}${base}docs/${doc.publishPath}`;
  const footer = `<footer>Plain text: <a href="${mdUrl}">${escapeHtml(path.posix.basename(doc.publishPath))}</a></footer>`;
  return htmlDocumentShell({ title, bodyHtml: [nav, bodyHtml, footer].join("\n") });
}

/** Render one directory's `index.html`, from the same markdown its `index.md` gets. */
export function renderDirectoryIndexHtml(params: { dir: string; markdown: string; base: string }): string {
  const { dir, markdown, base } = params;
  const origin = docsOrigin(base);
  const publishPath = `${dir}/index.md`;
  const bodyHtml = renderCorpusMarkdown(prepare(markdown, base), `dist/docs/${publishPath}`);
  const title = firstH1(markdown) ?? publishPath;
  const nav = corpusNavHtml({ publishPath, base });
  const mdUrl = `${origin}${base}docs/${publishPath}`;
  const footer = `<footer>Plain text: <a href="${mdUrl}">index.md</a></footer>`;
  return htmlDocumentShell({ title, bodyHtml: [nav, bodyHtml, footer].join("\n") });
}

/**
 * Render a root entry document (the front page or a `llms-*` entry page)
 * from its already-built markdown. No nav (it IS the root/entry) and no
 * footer (its plain-text twin is a sibling file, linked from nowhere but the
 * build's own file list — a corpus page never needs to name it).
 */
export function renderRootPageHtml(params: { markdown: string; fallbackTitle: string; sourceLabel: string; base: string }): string {
  const { markdown, fallbackTitle, sourceLabel, base } = params;
  const bodyHtml = renderCorpusMarkdown(prepare(markdown, base), sourceLabel);
  const title = firstH1(markdown) ?? fallbackTitle;
  return htmlDocumentShell({ title, bodyHtml });
}

/** Write one corpus entry point's plain-markdown twin (`<stem>.md`) and its spartan HTML rendering (`<stem>.txt`). */
async function writeEntryPage(params: { distDir: string; stem: string; markdown: string; base: string; fallbackTitle: string }): Promise<string> {
  const { distDir, stem, markdown, base, fallbackTitle } = params;
  await fs.writeFile(path.join(distDir, `${stem}.md`), markdown, "utf8");
  const html = renderRootPageHtml({ markdown, fallbackTitle, sourceLabel: `dist/${stem}.txt`, base });
  await fs.writeFile(path.join(distDir, `${stem}.txt`), html, "utf8");
  return html;
}

/**
 * Write the corpus's entry points from a `buildDocsCorpus()` result:
 * `llms.txt` (the deep front-page index, also copied byte-for-byte to
 * `dist/docs/index.html`), and `llms-install.txt`/`llms-dev.txt` when their
 * directory has any published doc / a `README.md` respectively. Returns the
 * stems actually written, for docs-static.ts's `_headers`.
 */
export async function writeEntryPages(params: {
  docsResult: DocsBuildResult;
  distDir: string;
  base: string;
  sitePages: readonly SitePageSummary[];
}): Promise<string[]> {
  const { docsResult, distDir, base, sitePages } = params;
  const stems: string[] = [];

  const frontMarkdown = renderAgentLlmsTxt({
    base,
    readme: docsResult.readme,
    spine: docsResult.spine,
    directories: docsResult.deepDirectories,
    installDir: docsResult.installDir,
    devDir: docsResult.devDir,
    sitePages,
  });
  const frontHtml = await writeEntryPage({ distDir, stem: "llms", markdown: frontMarkdown, base, fallbackTitle: "Bee Box" });
  await fs.writeFile(path.join(distDir, "docs", "index.html"), frontHtml, "utf8");
  stems.push("llms");

  if (docsResult.install !== undefined) {
    const installMarkdown = renderEntryLlmsTxt({
      base,
      title: "Bee Box install",
      dirName: "install",
      readme: docsResult.install.readme,
      startHere: docsResult.install.startHere,
      files: docsResult.install.files,
      also: docsResult.install.also,
    });
    await writeEntryPage({ distDir, stem: "llms-install", markdown: installMarkdown, base, fallbackTitle: "Bee Box install" });
    stems.push("llms-install");
  }
  if (docsResult.dev !== undefined) {
    const devMarkdown = renderEntryLlmsTxt({
      base,
      title: "Bee Box for contributors",
      dirName: "dev",
      readme: docsResult.dev.readme,
      startHere: docsResult.dev.startHere,
      files: docsResult.dev.files,
      also: docsResult.dev.also,
    });
    await writeEntryPage({ distDir, stem: "llms-dev", markdown: devMarkdown, base, fallbackTitle: "Bee Box for contributors" });
    stems.push("llms-dev");
  }

  return stems;
}
