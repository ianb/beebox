/**
 * One Markdown/Markdoc source → one complete static HTML page, for static-mode
 * publications (`prepare/markdown.ts`).
 *
 * **Reused Markdoc pipeline.** Parsing/transform/HTML emission reuse the box's
 * existing Markdoc config so a published page renders the same as it does
 * in-app: `markdocConfig` + `makeHeadingNode` from
 * `src/shared/markdoc-config/tags/core.ts` (the same config the frontend React renderer
 * wires up in `src/frontend/src/components/Markdown.tsx`'s `buildRenderConfig`).
 * Parsing goes through the shared `parseMarkdown` (raw-HTML allow-list,
 * comments, footnotes) without bare-URL autolinking: an autolink would turn
 * prose into outbound links the author never wrote.
 *
 * Pure and deterministic given the source: no wall-clock reads, no file access.
 */

import Markdoc from "@markdoc/markdoc";
import { parse as parseYaml } from "yaml";
import type { Config, Node, RenderableTreeNode, RenderableTreeNodes } from "@markdoc/markdoc";

import { markdocConfig, makeHeadingNode } from "../../../shared/markdoc-config/tags/core.js";
import { parseMarkdown } from "../../../shared/markdoc-config/parse/core.js";

// Named value imports (`{ parse, transform, renderers }`) don't resolve from
// this CommonJS module under Node's ESM loader (the doctest/CLI backend path);
// destructure off the default import instead — same pattern and lint exception
// as `markdoc/emit.ts` / `markdoc-config.ts`.
// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { transform, renderers, validate, Tag } = Markdoc;

function escapeHtml(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return s.replace(/["&'<>]/g, (c) => map[c] ?? c);
}

/** The first level-1 heading's text becomes the document title. */
function extractTitle(ast: Node): string | null {
  for (const node of ast.walk()) {
    if (node.type !== "heading" || node.attributes["level"] !== 1) continue;
    const parts: string[] = [];
    for (const child of node.walk()) {
      if ((child.type === "text" || child.type === "code") && typeof child.attributes["content"] === "string") parts.push(child.attributes["content"]);
    }
    const text = parts.join("").trim();
    if (text !== "") return text;
  }
  return null;
}

/** A string `title:` in YAML frontmatter wins over the first heading. */
function frontmatterTitle(frontmatter: unknown): string | null {
  if (typeof frontmatter !== "string" || frontmatter.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatter);
  } catch (_error) {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !("title" in parsed)) return null;
  const { title } = parsed;
  return typeof title === "string" && title.trim() !== "" ? title.trim() : null;
}

// Self-contained inline stylesheet: no `url(...)`, no font imports, nothing that
// would introduce an external reference into the page. Kept intentionally
// plain and theme-aware (respects the viewer's colour scheme).
const DOC_CSS = `
:root { color-scheme: light dark; }
body { font: 16px/1.65 system-ui, sans-serif; max-width: 44rem; margin: 0 auto; padding: 2.5rem 1.25rem 6rem; color: #1a1a1a; background: #fff; }
main :first-child { margin-top: 0; }
h1 { font-size: 1.9rem; line-height: 1.2; } h2 { font-size: 1.4rem; margin-top: 2rem; } h3 { font-size: 1.15rem; margin-top: 1.6rem; }
a { color: #1a56db; }
img { max-width: 100%; height: auto; }
code { background: rgba(130,130,130,0.16); padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.9em; }
pre { background: rgba(130,130,130,0.12); padding: 0.9em 1em; border-radius: 6px; overflow-x: auto; line-height: 1.45; }
pre code { background: none; padding: 0; }
blockquote { margin: 1em 0; padding: 0.2em 1em; border-left: 4px solid rgba(130,130,130,0.4); color: #555; }
table { border-collapse: collapse; margin: 1em 0; }
th, td { border: 1px solid rgba(130,130,130,0.4); padding: 0.4em 0.7em; text-align: left; }
kbd { border: 1px solid rgba(130,130,130,0.5); border-bottom-width: 2px; border-radius: 3px; padding: 0 0.3em; font-size: 0.85em; }
summary { cursor: pointer; }
.footnotes { font-size: 0.875em; }
.footnote-ref a, .footnote-backref { text-decoration: none; }
.footnote-backref { margin-left: 0.25em; }
@media (prefers-color-scheme: dark) {
  body { color: #e6e6e6; background: #16171a; }
  a { color: #7aa7ff; }
  blockquote { color: #aaa; }
}
`.trim();

/** The reused Markdoc render config: shared box config plus heading anchors (as in-app). */
function docRenderConfig(): Config {
  return {
    ...markdocConfig,
    nodes: {
      ...markdocConfig.nodes,
      // Fresh per render so the duplicate-slug set is scoped to this pass
      // (same reason `Markdown.tsx` builds it per call).
      heading: makeHeadingNode(),
    },
  };
}

/** Error- and critical-level Markdoc problems (unknown tags, bad attributes) in a source; 1-based lines. */
export function markdownValidationErrors(source: string): { line: number | null; message: string }[] {
  return validate(parseMarkdown(source), docRenderConfig())
    .filter(({ error }) => error.level === "error" || error.level === "critical")
    .map(({ error, lines }) => ({ line: lines[0] === undefined ? null : lines[0] + 1, message: error.message }));
}

const REDACTED_TAGS = new Set(["RedactedInline", "RedactedBlock"]);

/** A published page omits `redacted` content entirely; it has no reveal control and its text must not ship. */
function omitRedacted(node: RenderableTreeNode): RenderableTreeNode {
  if (!Tag.isTag(node)) return node;
  if (REDACTED_TAGS.has(node.name)) return null;
  return new Tag(node.name, node.attributes, node.children.map(omitRedacted));
}

/**
 * Render a Markdown/Markdoc source to one complete HTML page: the box's Markdoc
 * config, inline CSS, no JavaScript, and `redacted` content omitted.
 * `rewriteTree` adjusts the transformed Markdoc tree before HTML output;
 * `rewriteHtml` post-processes the rendered body (link rewriting).
 */
export function renderMarkdownPage(
  source: string,
  options: {
    fallbackTitle: string;
    rewriteTree?: (tree: RenderableTreeNodes) => RenderableTreeNodes;
    rewriteHtml?: (body: string) => string;
  },
): string {
  const ast = parseMarkdown(source);
  const transformed = transform(ast, docRenderConfig());
  const tree = Array.isArray(transformed) ? transformed.map(omitRedacted) : omitRedacted(transformed);
  const body = renderers.html(options.rewriteTree === undefined ? tree : options.rewriteTree(tree));
  const rewritten = options.rewriteHtml === undefined ? body : options.rewriteHtml(body);
  const title = escapeHtml(frontmatterTitle(ast.attributes["frontmatter"]) ?? extractTitle(ast) ?? options.fallbackTitle);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="beebox">
<title>${title}</title>
<style>
${DOC_CSS}
</style>
</head>
<body>
<main>${rewritten}</main>
</body>
</html>
`;
}
