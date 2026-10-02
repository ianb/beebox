/** Static-mode Markdown rendering: each site `.md` source becomes a sibling `.html` page. */

import path from "node:path";

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
