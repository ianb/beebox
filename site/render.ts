// The site's own small Markdoc pipeline. Deliberately NOT imported from
// bin/router-docs.ts: that module drags in router/runtime dependencies that do
// not belong in the static-site build. This package declares @markdoc/markdoc
// explicitly and renders through it here.
//
// Frontmatter is parsed strictly (zod) and fails the build with file+line on
// malformed input — a publish boundary, unlike the tolerant browse-tool parser.

import Markdoc from "@markdoc/markdoc";
import type { RenderableTreeNode } from "@markdoc/markdoc";
import YAML from "yaml";
import { z } from "zod";
import { FISHEYE_CSS, FISHEYE_SCRIPT, fisheyeTags } from "./fisheye.js";
import { classifyHref, resolveInternalHref } from "./links.js";

// @markdoc/markdoc is CommonJS: at runtime the ESM named exports don't exist,
// only the default namespace, so its parts are destructured off the default here.
// eslint-disable-next-line import-x/no-named-as-default-member -- CJS interop: only the default namespace carries these at runtime
const { parse: markdocParse, transform: markdocTransform, validate: markdocValidate, renderers, Tag } = Markdoc;

const FRONTMATTER_RE = /^---\r?\n([\S\s]*?)\r?\n---\r?\n?/;

export const pageFrontmatterSchema = z
  .object({
    title: z.string().min(1),
    summary: z.string().min(1),
    /** Unlisted pages build and serve but stay out of llms.txt (prototypes). */
    unlisted: z.boolean().optional(),
    /**
     * Tolerated, never published: every card type in a box carries `contains`
     * as the agent-written retrieval summary, so a page card transferred out of
     * a box arrives with one. Accepting it keeps the strict schema honest.
     */
    contains: z.string().optional(),
  })
  .strict();

export type PageFrontmatter = z.infer<typeof pageFrontmatterSchema>;

export class FrontmatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontmatterError";
  }
}

interface ParsedSource {
  frontmatter: PageFrontmatter;
  body: string;
}

/**
 * Split and strictly validate a frontmatter block against `schema`. The single
 * frontmatter parse for the whole generator (pages and nuggets alike), so every
 * publish-boundary error reads the same: one line, naming file and line number,
 * no stack noise. `file` is used only for those messages.
 */
export function parseFrontmatter<T>(src: string, params: { file: string; schema: z.ZodType<T> }): {
  frontmatter: T;
  body: string;
} {
  const { file, schema } = params;
  const match = FRONTMATTER_RE.exec(src);
  if (!match) {
    throw new FrontmatterError(`${file}:1 missing frontmatter block (expected a leading "---" fence)`);
  }
  const yamlText = match[1] ?? "";
  let data: unknown;
  try {
    data = YAML.parse(yamlText);
  } catch (e) {
    const line = e instanceof YAML.YAMLParseError ? (e.linePos?.[0]?.line ?? 1) : 1;
    const detail = e instanceof Error ? e.message.split("\n")[0] : String(e);
    // +1: frontmatter body starts on the line after the opening fence.
    throw new FrontmatterError(`${file}:${line + 1} invalid frontmatter YAML: ${detail}`);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".") || "(root)";
    throw new FrontmatterError(`${file}:1 frontmatter field "${field}": ${issue?.message ?? "invalid"}`);
  }
  return { frontmatter: parsed.data, body: src.slice(match[0].length) };
}

/** Split and strictly validate a `site-page` card's frontmatter. */
export function parseSource(src: string, file: string): ParsedSource {
  return parseFrontmatter(src, { file, schema: pageFrontmatterSchema });
}

/** A body whose Markdoc markup is malformed — a publish-boundary hard failure. */
export class MarkupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkupError";
  }
}

interface RewriteContext {
  pageSitePath: string;
  base: string;
  targets: string[];
}

/** Walk the renderable tree, rewrite internal <a href> against base, collect targets. */
function rewriteLinks(node: RenderableTreeNode, ctx: RewriteContext): void {
  if (!Tag.isTag(node)) return;
  if (node.name === "a") {
    const href = node.attributes["href"];
    if (typeof href === "string" && classifyHref(href) === "internal") {
      const resolved = resolveInternalHref({ href, pageSitePath: ctx.pageSitePath, base: ctx.base });
      node.attributes["href"] = resolved.href;
      ctx.targets.push(resolved.target);
    } else if (typeof href === "string" && classifyHref(href) === "external") {
      node.attributes["target"] = "_blank";
      node.attributes["rel"] = "noopener noreferrer";
    }
  }
  for (const child of node.children) {
    rewriteLinks(child, ctx);
  }
}

export interface RenderedPage {
  html: string;
  /** Site-root-relative internal link targets found on the page (for link-checking). */
  linkTargets: string[];
}

export interface RenderParams {
  /** Path used in error messages (site/-relative for cards, repo-relative for nuggets). */
  file: string;
  pageSitePath: string;
  base: string;
}

export interface TransformedBody {
  content: RenderableTreeNode;
  linkTargets: string[];
}

/**
 * Parse + validate + transform a markdown body, rewriting/collecting internal
 * links. Returns the renderable tree so callers that need to re-wrap it (the
 * aside substitution) share this exact pipeline instead of a second one.
 *
 * The validation pass is load-bearing, not hygiene: Markdoc's transform never
 * throws on a malformed tag — it silently drops the whole block. A mistyped
 * `{% aside ref … %}` would then vanish from the page with nothing to see. Any
 * error- or critical-level diagnostic fails the build instead.
 */
export function transformBody(body: string, params: RenderParams): TransformedBody {
  const ast = markdocParse(body);
  const first = markdocValidate(ast, { tags: fisheyeTags }).find(
    (entry) => entry.error.level === "error" || entry.error.level === "critical",
  );
  if (first) {
    // `lines` is 0-based and may be empty on a parse error at the very top.
    const line = (first.lines[0] ?? 0) + 1;
    throw new MarkupError(`${params.file}:${line} malformed markup: ${first.error.message}`);
  }
  const content = markdocTransform(ast, { tags: fisheyeTags });
  const targets: string[] = [];
  rewriteLinks(content, { pageSitePath: params.pageSitePath, base: params.base, targets });
  return { content, linkTargets: targets };
}

/** Render a markdown body to HTML, rewriting/collecting internal links. */
export function renderBody(body: string, params: RenderParams): RenderedPage {
  const { content, linkTargets } = transformBody(body, params);
  return { html: renderers.html(content), linkTargets };
}

/** Render an already-transformed node to HTML (the one renderer, shared). */
export function renderNode(node: RenderableTreeNode): string {
  return renderers.html(node);
}

/** The block children of a transformed body, with its `<article>` wrapper dropped. */
export function bodyChildren(content: RenderableTreeNode): RenderableTreeNode[] {
  return Tag.isTag(content) ? content.children : [content];
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Spare register: readable ~65ch column, a humanist system font stack (no
// Courier/monospace body), near-black on near-white, no colors/hero/logo,
// and no external requests (fonts included) so the page is CSP-clean and
// viewable offline. JS is inline and minimal (the copy button on code
// blocks) — never external, never load-bearing for reading the page. This
// is the settled v1 look — do not embellish.
const SHELL_CSS = `
:root { color-scheme: light; }
html { font-size: 18px; }
body {
  margin: 0;
  color: #17171a;
  background: #fbfbf9;
  font-family: "Avenir Next", Avenir, "Segoe UI", "Helvetica Neue", Helvetica, Ubuntu, Arial, sans-serif;
  line-height: 1.55;
}
main { max-width: 65ch; margin: 4rem auto 6rem; padding: 0 1.25rem; }
h1, h2, h3 { line-height: 1.2; font-weight: 600; margin: 2.2rem 0 0.6rem; }
h1 { font-size: 1.9rem; margin-top: 0; }
h2 { font-size: 1.35rem; }
p, ul, ol { margin: 0.9rem 0; }
a { color: #17171a; text-underline-offset: 2px; }
code, pre { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 0.85em; }
pre { overflow-x: auto; padding: 0.9rem 1rem; background: #f2f2ee; border-radius: 4px; position: relative; }
pre .copy {
  position: absolute; top: 0.45rem; right: 0.5rem;
  font: 600 0.7rem/1.6 inherit; font-family: inherit;
  color: #55554f; background: #fbfbf9; border: 1px solid #d8d8d2; border-radius: 3px;
  padding: 0 0.5rem; cursor: pointer;
}
pre .copy:hover { color: #17171a; }
hr { border: none; border-top: 1px solid #d8d8d2; margin: 2.5rem 0; }
header { border-bottom: 1px solid #e6e6e0; }
header .inner {
  max-width: 65ch; margin: 0 auto; padding: 0.55rem 1.25rem;
  display: flex; justify-content: space-between; align-items: center;
}
header .home { font-weight: 600; font-size: 0.95rem; text-decoration: none; }
header .by { font-size: 0.85rem; color: #55554f; }
header .by a { color: inherit; }
header nav { display: flex; align-items: center; gap: 0.9rem; }
header nav a { display: inline-flex; color: #55554f; }
header nav a:hover { color: #17171a; }
header nav svg { width: 20px; height: 20px; fill: currentColor; }
`.trim();

// Inline SVGs (no external requests at view time): the standard GitHub mark,
// and a plain chat bubble for the Zulip community link.
const GITHUB_ICON = "<svg viewBox=\"0 0 16 16\" aria-hidden=\"true\"><path d=\"M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.66 7.66 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z\"/></svg>";
const CHAT_ICON = "<svg viewBox=\"0 0 16 16\" aria-hidden=\"true\"><path d=\"M2.5 1h11A1.5 1.5 0 0 1 15 2.5v8a1.5 1.5 0 0 1-1.5 1.5H6.7l-3.35 3.03A.75.75 0 0 1 2.1 14.5V12h.4v.01A1.5 1.5 0 0 1 1 10.5v-8A1.5 1.5 0 0 1 2.5 1Zm1.25 3.75a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5Zm0 3a.75.75 0 0 0 0 1.5h5.5a.75.75 0 0 0 0-1.5h-5.5Z\"/></svg>";

// Adds a "copy" button to each code block. Inline, tiny, and non-load-bearing:
// with JS off the block is still selectable text.
const COPY_SCRIPT = `
for (const pre of document.querySelectorAll("pre")) {
  const btn = document.createElement("button");
  btn.className = "copy";
  btn.type = "button";
  btn.textContent = "copy";
  btn.addEventListener("click", async () => {
    const code = pre.querySelector("code");
    await navigator.clipboard.writeText((code ?? pre).innerText.trim());
    btn.textContent = "copied";
    setTimeout(() => { btn.textContent = "copy"; }, 1500);
  });
  pre.append(btn);
}
`.trim();

function headerHtml(base: string): string {
  return `<header>
<div class="inner">
<span class="ident"><a class="home" href="${escapeHtml(base)}">Callback Box</a> <span class="by">by <a href="https://ianbicking.org" target="_blank" rel="noopener noreferrer">Ian Bicking</a></span></span>
<nav aria-label="Project links">
<a href="https://github.com/ianb/callback-box" target="_blank" rel="noopener noreferrer" aria-label="GitHub repository" title="GitHub">${GITHUB_ICON}</a>
<a href="https://callback-box.zulipchat.com" target="_blank" rel="noopener noreferrer" aria-label="Zulip community forum" title="Zulip community">${CHAT_ICON}</a>
</nav>
</div>
</header>`;
}

/** Wrap rendered body HTML in the spare site shell. */
export function pageShell(params: { title: string; bodyHtml: string; base: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(params.title)}</title>
<style>${SHELL_CSS}
${FISHEYE_CSS}</style>
</head>
<body>
${headerHtml(params.base)}
<main>
${params.bodyHtml}
</main>
<script>${COPY_SCRIPT}
${FISHEYE_SCRIPT}</script>
</body>
</html>
`;
}
