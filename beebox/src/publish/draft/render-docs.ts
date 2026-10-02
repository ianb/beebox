/**
 * Docs snapshot renderer (Track B of `docs/plans/publish-pages.md`).
 *
 * Renders a markdown/Markdoc doc into a **single self-contained `index.html`**
 * bundle: inline CSS, zero JavaScript, and every referenced image either
 * inlined as a `data:` URI (small images) or copied into `bundle/assets/` with
 * the reference rewritten to a relative path. The output map contains no
 * absolute paths and no external URLs — the self-containment guarantee the
 * publication CSP (`default-src 'none'`) depends on.
 *
 * **Reused Markdoc pipeline.** Parsing/transform/HTML emission reuse the box's
 * existing Markdoc config so a published doc renders the same as it does
 * in-app: `markdocConfig` + `makeHeadingNode` from
 * `src/shared/markdoc-config/core.ts` (the same config the frontend React renderer
 * wires up in `src/frontend/src/components/Markdown.tsx`'s `buildRenderConfig`).
 * The `parse → transform → renderers.html` shape mirrors the dev doc browser's
 * `renderMarkdownToHtml` in `workstreams-app/src/router/server/docs.ts:144` — which we can't import
 * (separate package), so the pipeline is reconstructed here on the shared
 * config. The autolinking tokenizer (`parseMarkdown`, frontend-only, excluded
 * from the backend tsconfig) is deliberately NOT reused: a bare-URL autolink
 * would emit an external `http(s)://` reference into an otherwise
 * self-contained bundle.
 *
 * Pure and deterministic given `(source, { boxRoot, now })`: no wall-clock
 * call (the caller injects `now`, e.g. `getBoxTime(boxRoot)`), no Cloudflare
 * coupling. The whole feature is doctestable off this signature.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseAnnexPointer } from "../../lib/annex-pointer.js";

import Markdoc from "@markdoc/markdoc";
import { parse as parseYaml } from "yaml";
import type { Config, Node, RenderableTreeNode, RenderableTreeNodes } from "@markdoc/markdoc";

import { markdocConfig, makeHeadingNode } from "../../shared/markdoc-config/core.js";
import { extensionToMimetype } from "../../lib/mimetype.js";

// Named value imports (`{ parse, transform, renderers }`) don't resolve from
// this CommonJS module under Node's ESM loader (the doctest/CLI backend path);
// destructure off the default import instead — same pattern and lint exception
// as `markdoc/emit.ts` / `markdoc-config.ts`.
// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { parse, transform, renderers, validate, Tag } = Markdoc;

/**
 * Images at or below this many bytes are inlined as `data:` URIs directly in
 * `index.html`; larger ones are written to `bundle/assets/` and referenced by
 * relative path. Base64 inlining inflates a payload ~33%, so the threshold is
 * kept low — icons and small thumbnails inline, photographs become assets. The
 * publication CSP permits both `img-src 'self'` (assets) and `data:` (inline).
 */
export const INLINE_IMAGE_MAX_BYTES = 8 * 1024;

/**
 * A doc references a local image whose resolved path escapes the box root. The
 * offending `src` is a field and the (non-literal) constructor argument; the
 * message is hardcoded inside the class — the `error/*` lint rules forbid a
 * string literal *anywhere* in a `new *Error(...)` call (see `src/lib/errors.ts`).
 */
class ImageEscapesBoxError extends Error {
  readonly src: string;
  constructor(src: string) {
    super(`image reference escapes the box: ${src}`);
    this.name = "ImageEscapesBoxError";
    this.src = src;
  }
}

/** A doc references a local image that doesn't exist under the box root. */
/**
 * An image resolved to a git-annex pointer rather than its bytes. Publishing it
 * would inline ~100 bytes of pointer text as a data: URI and ship a broken
 * image to a public page — a failure nobody would trace back to here.
 */
class ImageContentNotPresentError extends Error {
  readonly src: string;
  constructor(src: string) {
    super(`image content is not present locally: ${src} (fetch it with \`git annex get\`)`);
    this.name = "ImageContentNotPresentError";
    this.src = src;
  }
}

class ImageNotFoundError extends Error {
  readonly src: string;
  constructor(src: string, options?: { cause?: unknown }) {
    super(`image not found: ${src}`, options);
    this.name = "ImageNotFoundError";
    this.src = src;
  }
}

/** A rendered docs bundle: relative bundle path → content. `index.html` is the entry. */
export interface DocsPublication {
  files: Map<string, string | Uint8Array>;
}

export interface RenderDocsOptions {
  /** Box root; relative image references in the doc resolve against it. */
  boxRoot: string;
  /** Injected clock reading (the renderer never calls the wall clock itself). */
  now: Date;
}

/** True for a reference the renderer must leave untouched: `data:` or any scheme/protocol-relative URL. */
function isExternalRef(src: string): boolean {
  return src.startsWith("data:") || /^[a-z][\d+.a-z-]*:/i.test(src) || src.startsWith("//");
}

/** Read a box-relative image and return either an inline `data:` URI or an emitted asset path. */
function localizeImage(
  src: string,
  { boxRoot, files }: { boxRoot: string; files: Map<string, string | Uint8Array> },
): string {
  const relative = src.replace(/^\.\//, "");
  const resolved = path.resolve(boxRoot, relative);
  if (resolved !== boxRoot && !resolved.startsWith(boxRoot + path.sep)) {
    throw new ImageEscapesBoxError(src);
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(resolved);
  } catch (e) {
    throw new ImageNotFoundError(src, { cause: e });
  }
  if (bytes.length <= 1024 && parseAnnexPointer(new Uint8Array(bytes)) !== null) {
    throw new ImageContentNotPresentError(src);
  }
  const ext = path.extname(relative).toLowerCase();
  const mime = extensionToMimetype(ext, { fallback: "application/octet-stream" });
  if (bytes.length <= INLINE_IMAGE_MAX_BYTES) {
    return `data:${mime};base64,${bytes.toString("base64")}`;
  }
  // Content-addressed name: deterministic, and identical images de-duplicate.
  const name = `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}${ext}`;
  files.set(`assets/${name}`, bytes);
  return `assets/${name}`;
}

const IMG_TAG_RE = /<img\b[^>]*>/g;
const IMG_SRC_RE = /\bsrc="([^"]*)"/;

/** Rewrite every `<img src>` in `html`, populating `files` with any emitted assets. */
function localizeImages(
  html: string,
  { boxRoot, files }: { boxRoot: string; files: Map<string, string | Uint8Array> },
): string {
  return html.replace(IMG_TAG_RE, (tag) =>
    tag.replace(IMG_SRC_RE, (whole, src: string) =>
      isExternalRef(src) ? whole : `src="${localizeImage(src, { boxRoot, files })}"`,
    ),
  );
}

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
// would introduce an external reference into the bundle. Kept intentionally
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
.pub-meta { margin-top: 4rem; padding-top: 1rem; border-top: 1px solid rgba(130,130,130,0.3); color: #777; font-size: 0.8rem; }
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
      ...(markdocConfig.nodes ?? {}),
      // Fresh per render so the duplicate-slug set is scoped to this pass
      // (same reason `Markdown.tsx` builds it per call).
      heading: makeHeadingNode(),
    },
  };
}

/** Error- and critical-level Markdoc problems (unknown tags, bad attributes) in a source; 1-based lines. */
export function markdownValidationErrors(source: string): { line: number | null; message: string }[] {
  return validate(parse(source), docRenderConfig())
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
 * config, inline CSS, no JavaScript, and `redacted` content omitted. `rewriteTree` adjusts the transformed
 * Markdoc tree before HTML output; `rewriteHtml` post-processes the rendered
 * body (image localizing, link rewriting); `footerHtml` is appended verbatim.
 * Shared by the docs snapshot and static-site Markdown rendering.
 */
export function renderMarkdownPage(
  source: string,
  options: {
    fallbackTitle: string;
    rewriteTree?: (tree: RenderableTreeNodes) => RenderableTreeNodes;
    rewriteHtml?: (body: string) => string;
    footerHtml?: string;
  },
): string {
  const ast = parse(source);
  const transformed = transform(ast, docRenderConfig());
  const tree = Array.isArray(transformed) ? transformed.map(omitRedacted) : omitRedacted(transformed);
  const body = renderers.html(options.rewriteTree === undefined ? tree : options.rewriteTree(tree));
  const rewritten = options.rewriteHtml === undefined ? body : options.rewriteHtml(body);
  const title = escapeHtml(frontmatterTitle(ast.attributes["frontmatter"]) ?? extractTitle(ast) ?? options.fallbackTitle);
  const footer = options.footerHtml === undefined ? "" : `\n${options.footerHtml}`;
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
<main>${rewritten}</main>${footer}
</body>
</html>
`;
}

/**
 * Render a markdown doc source into a self-contained static bundle.
 *
 * @returns a `files` map of relative bundle paths (`index.html`, `assets/…`) to
 *   content — no absolute paths, no external URLs, no JavaScript.
 */
export function renderDocsPublication(source: string, { boxRoot, now }: RenderDocsOptions): DocsPublication {
  const files = new Map<string, string | Uint8Array>();
  const renderedAt = now.toISOString();
  const indexHtml = renderMarkdownPage(source, {
    fallbackTitle: "Document",
    rewriteHtml: (body) => localizeImages(body, { boxRoot, files }),
    footerHtml: `<footer class="pub-meta">Rendered <time datetime="${renderedAt}">${renderedAt}</time></footer>`,
  });
  files.set("index.html", indexHtml);
  return { files };
}
