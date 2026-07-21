// The site's own small Markdoc pipeline. Deliberately NOT imported from
// bin/router-docs.ts: that module drags in execa, highlight.js, and a cycle
// with router-issues, and reaches Markdoc only by a hoisting accident. This
// package declares @markdoc/markdoc explicitly and renders through it here.
//
// Frontmatter is parsed strictly (zod) and fails the build with file+line on
// malformed input — a publish boundary, unlike the tolerant browse-tool parser.

import Markdoc from "@markdoc/markdoc";
import type { RenderableTreeNode } from "@markdoc/markdoc";
import YAML from "yaml";
import { z } from "zod";
import { classifyHref, resolveInternalHref } from "./links.js";

// @markdoc/markdoc is CommonJS: at runtime the ESM named exports don't exist,
// only the default namespace, so its parts are destructured off the default here.
// eslint-disable-next-line import-x/no-named-as-default-member -- CJS interop: only the default namespace carries these at runtime
const { parse: markdocParse, transform: markdocTransform, renderers, Tag } = Markdoc;

const FRONTMATTER_RE = /^---\r?\n([\S\s]*?)\r?\n---\r?\n?/;

export const pageFrontmatterSchema = z
  .object({
    title: z.string().min(1),
    summary: z.string().min(1),
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

/** Split and strictly validate frontmatter. `file` is used only for error messages. */
export function parseSource(src: string, file: string): ParsedSource {
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
  const parsed = pageFrontmatterSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".") || "(root)";
    throw new FrontmatterError(`${file}:1 frontmatter field "${field}": ${issue?.message ?? "invalid"}`);
  }
  return { frontmatter: parsed.data, body: src.slice(match[0].length) };
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

/** Render a markdown body to HTML, rewriting/collecting internal links. */
export function renderBody(body: string, params: { pageSitePath: string; base: string }): RenderedPage {
  const ast = markdocParse(body);
  const content = markdocTransform(ast);
  const targets: string[] = [];
  rewriteLinks(content, { pageSitePath: params.pageSitePath, base: params.base, targets });
  return { html: renderers.html(content), linkTargets: targets };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Spare register: readable ~65ch column, a humanist system font stack (no
// Courier/monospace body), near-black on near-white, no colors/hero/logo/JS,
// and no external requests (fonts included) so the page is CSP-clean and
// viewable offline. This is the settled v1 look — do not embellish.
const SHELL_CSS = `
:root { color-scheme: light; }
html { font-size: 18px; }
body {
  margin: 0;
  color: #17171a;
  background: #fbfbf9;
  font-family: Charter, "Sitka Text", Georgia, Cambria, "Times New Roman", serif;
  line-height: 1.55;
}
main { max-width: 65ch; margin: 4rem auto 6rem; padding: 0 1.25rem; }
h1, h2, h3 { line-height: 1.2; font-weight: 600; margin: 2.2rem 0 0.6rem; }
h1 { font-size: 1.9rem; margin-top: 0; }
h2 { font-size: 1.35rem; }
p, ul, ol { margin: 0.9rem 0; }
a { color: #17171a; text-underline-offset: 2px; }
code, pre { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 0.85em; }
pre { overflow-x: auto; padding: 0.9rem 1rem; background: #f2f2ee; border-radius: 4px; }
hr { border: none; border-top: 1px solid #d8d8d2; margin: 2.5rem 0; }
`.trim();

/** Wrap rendered body HTML in the spare site shell. */
export function pageShell(params: { title: string; bodyHtml: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(params.title)}</title>
<style>${SHELL_CSS}</style>
</head>
<body>
<main>
${params.bodyHtml}
</main>
</body>
</html>
`;
}
