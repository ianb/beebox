// The site's own small Markdoc pipeline. Deliberately NOT imported from
// workstreams-app/src/router/router-docs.ts: that module drags in router/runtime dependencies that do
// not belong in the static-site build. This package declares @markdoc/markdoc
// explicitly and renders through it here.
//
// Frontmatter is parsed strictly (zod) and fails the build with file+line on
// malformed input — a publish boundary, unlike the tolerant browse-tool parser.

import Markdoc from "@markdoc/markdoc";
import type { RenderableTreeNode } from "@markdoc/markdoc";
import YAML from "yaml";
import { z } from "zod";
import { fisheyeTags } from "./fisheye.js";
import { classifyHref, resolveInternalHref } from "./links.js";
import { agentPromptTags } from "./agent-prompt.js";

// @markdoc/markdoc is CommonJS: at runtime the ESM named exports don't exist,
// only the default namespace, so its parts are destructured off the default here.
// eslint-disable-next-line import-x/no-named-as-default-member -- CJS interop: only the default namespace carries these at runtime
const { parse: markdocParse, transform: markdocTransform, validate: markdocValidate, renderers, Tag } = Markdoc;

const FRONTMATTER_RE = /^---\r?\n([\S\s]*?)\r?\n---\r?\n?/;

const contributionSchema = z.string().trim().min(1);

export const authorshipSchema = z.object({
  people: z.array(z.object({
    name: z.string().trim().min(1),
    role: z.string().trim().min(1),
    contribution: z.string().trim().min(1),
  }).strict()).min(1),
  ai: z.object({
    transcription: contributionSchema,
    drafting: contributionSchema,
    editing: contributionSchema,
  }).catchall(contributionSchema),
}).strict();

export const pageFrontmatterSchema = z
  .object({
    title: z.string().min(1),
    summary: z.string().min(1),
    authorship: authorshipSchema,
    /** Unlisted pages build and serve but stay out of llms.txt (prototypes). */
    unlisted: z.boolean().optional(),
    theme: z.enum(["plain", "paper", "post-it"]).optional(),
    stock: z.enum(["cream", "manila", "blue", "yellow", "rose", "mint"]).optional(),
    navigation: z.boolean().optional(),
    kind: z.enum(["bee", "author", "generated"]).optional(),
    status: z.enum(["pending", "ready"]).optional(),
    chrome: z.object({
      theme: z.enum(["plain", "paper", "spectrum"]),
      stock: z.enum(["cream", "manila", "blue"]).optional(),
    }).strict().optional(),
    next: z.array(z.object({
      card: z.string().min(1),
      label: z.string().min(1),
      at: z.string().regex(/^[\da-z][\da-z-]*$/).optional(),
    }).strict()).optional(),
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
  const tags = { ...fisheyeTags, ...agentPromptTags };
  const first = markdocValidate(ast, { tags }).find(
    (entry) => entry.error.level === "error" || entry.error.level === "critical",
  );
  if (first) {
    // `lines` is 0-based and may be empty on a parse error at the very top.
    const line = (first.lines[0] ?? 0) + 1;
    throw new MarkupError(`${params.file}:${line} malformed markup: ${first.error.message}`);
  }
  const content = markdocTransform(ast, { tags });
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

/**
 * Render a corpus (agent-docs) page's markdown to HTML. Unlike `renderBody`,
 * this never runs Markdoc's `validate()` pass: corpus pages carry no custom
 * tags (a literal `{% … %}` in prose is escaped to text before this ever
 * runs — see `docs-html.ts`), so there is nothing to validate against a tag
 * schema. `parse()` itself still reports malformed markup (e.g. a broken
 * fence) as `errors` on the affected nodes; any error/critical one still
 * fails the build, just without a schema to check tags against.
 */
export function renderCorpusMarkdown(body: string, file: string): string {
  const ast = markdocParse(body);
  for (const node of ast.walk()) {
    const err = node.errors.find((e) => e.level === "error" || e.level === "critical");
    if (err) {
      const line = (node.lines[0] ?? 0) + 1;
      throw new MarkupError(`${file}:${line} malformed markup: ${err.message}`);
    }
  }
  const content = markdocTransform(ast, {});
  return renderers.html(content);
}

/** The block children of a transformed body, with its `<article>` wrapper dropped. */
export function bodyChildren(content: RenderableTreeNode): RenderableTreeNode[] {
  return Tag.isTag(content) ? content.children : [content];
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
