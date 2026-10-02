/** Static-mode Markdown rendering: each site `.md` source becomes a sibling `.html` page. */

import path from "node:path";

import Markdoc from "@markdoc/markdoc";
import type { RenderableTreeNode, RenderableTreeNodes } from "@markdoc/markdoc";

import { markdownValidationErrors, renderMarkdownPage } from "../draft/render-docs.js";
import { bundlePolicyError } from "./errors.js";

const MARKDOWN_EXTENSION = ".md";
const ANCHOR_TAG_RE = /<a\b[^>]*>/g;
const HREF_RE = /\bhref="([^"]*)"/;

function isMarkdownPath(relative: string): boolean {
  return path.posix.extname(relative).toLowerCase() === MARKDOWN_EXTENSION;
}

function htmlPathFor(relative: string): string {
  return `${relative.slice(0, -MARKDOWN_EXTENSION.length)}.html`;
}

/** Rewrite a site-relative link to a `.md` page so it targets the rendered `.html`; leave everything else alone. */
function rewriteMarkdownHref(href: string): string {
  if (href === "" || href.startsWith("#") || href.startsWith("/") || /^[a-z][\d+.a-z-]*:/i.test(href)) return href;
  const suffixAt = href.search(/[#?]/);
  const target = suffixAt === -1 ? href : href.slice(0, suffixAt);
  const suffix = suffixAt === -1 ? "" : href.slice(suffixAt);
  return isMarkdownPath(target) ? `${htmlPathFor(target)}${suffix}` : href;
}

function rewriteMarkdownLinks(body: string): string {
  return body.replace(ANCHOR_TAG_RE, (tag) => tag.replace(HREF_RE, (_whole, href: string) => `href="${rewriteMarkdownHref(href)}"`));
}

// Same default-member access as `render-docs.ts`: the named import fails under Node ESM.
// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { Tag } = Markdoc;

/**
 * The shared Markdoc config emits app components (capitalized tag names) for
 * box tags. A static page has no component renderer, so a GFM task becomes a
 * disabled checkbox and any other component fails prepare rather than ship
 * as an unknown element (a `redacted` tag would show its text).
 */
function lowerComponents(relative: string, tree: RenderableTreeNodes): RenderableTreeNodes {
  return Array.isArray(tree) ? tree.map((node) => lowerComponent(relative, node)) : lowerComponent(relative, tree);
}

function lowerComponent(relative: string, node: RenderableTreeNode): RenderableTreeNode {
  if (!Tag.isTag(node)) return node;
  if (node.name === "Task") {
    return new Tag("input", { type: "checkbox", disabled: "", ...(node.attributes["done"] === true ? { checked: "" } : {}) }, []);
  }
  if (/^[A-Z]/.test(node.name)) {
    throw bundlePolicyError(`Markdown file '${relative}' uses a box Markdoc tag (${node.name}) that published pages do not support; remove it or write plain Markdown`);
  }
  return new Tag(node.name, node.attributes, node.children.map((child) => lowerComponent(relative, child)));
}

function decodeUtf8(relative: string, bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_error) {
    throw bundlePolicyError(`Markdown file '${relative}' is not valid UTF-8`);
  }
}

/**
 * Replace every `.md` source with its rendered `.html` page. The source does not
 * ship. A `.md` and an authored `.html` for the same output path is an error,
 * so the author decides which one is the page.
 */
export function renderMarkdownSources(files: ReadonlyMap<string, Buffer>): Map<string, Buffer> {
  const output = new Map<string, Buffer>();
  const renderedFrom = new Map<string, string>();
  for (const [relative, bytes] of files) {
    if (!isMarkdownPath(relative)) {
      output.set(relative, bytes);
      continue;
    }
    const target = htmlPathFor(relative);
    const earlier = renderedFrom.get(target);
    if (earlier !== undefined) {
      throw bundlePolicyError(`'${earlier}' and '${relative}' both render to '${target}'; keep only one of them`);
    }
    const source = decodeUtf8(relative, bytes);
    const [problem] = markdownValidationErrors(source);
    if (problem !== undefined) {
      const where = problem.line === null ? relative : `${relative}:${problem.line}`;
      throw bundlePolicyError(`Markdown file '${where}' has invalid Markdoc: ${problem.message}`);
    }
    const html = renderMarkdownPage(source, {
      fallbackTitle: path.posix.basename(target, ".html"),
      rewriteTree: (tree) => lowerComponents(relative, tree),
      rewriteHtml: rewriteMarkdownLinks,
    });
    renderedFrom.set(target, relative);
    output.set(target, Buffer.from(html, "utf-8"));
  }
  for (const [target, relative] of renderedFrom) {
    if (files.has(target)) {
      throw bundlePolicyError(`'${relative}' renders to '${target}', which also exists; keep only one of them`);
    }
  }
  return output;
}
