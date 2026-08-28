// Markdown → HTML for the router's read-only surfaces: HTML escaping, Markdoc
// rendering with highlight.js code blocks and GFM-style autolinking, and the
// closed-issue pill decoration. Split out of router-docs.ts so that file can
// stay about the /<worktree>/dev/ space itself.
//
// Pure string transformation only — nothing here touches the filesystem, the
// live `worktrees` map, or a response.

import path from "node:path";
import Markdoc from "@markdoc/markdoc";
import hljs from "highlight.js";

export function escapeHtml(s: string): string {
  const replacements: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return String(s).replace(/["&'<>]/g, (c) => replacements[c] ?? c);
}

export function findClosedIssueLinkHrefs(md: string, docDirRel: string): Set<string> {
  const closedHrefs = new Set<string>();
  for (const match of md.matchAll(/]\(([^\s()]+)\)/g)) {
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
  // One rest parameter rather than (match, lang, body): String.replace hands the
  // callback a variable arity, and the house limit is two positional parameters.
  return html.replace(/<pre(?: data-language="([^"]*)")?>([\S\s]*?)<\/pre>/g, (...match: (string | undefined)[]) => {
    const [, lang, body = ""] = match;
    const code = unescapeHtml(body);
    let language = lang && hljs.getLanguage(lang) ? lang : "";
    if (!language && defaultLang && hljs.getLanguage(defaultLang)) language = defaultLang;
    let inner: string;
    try {
      inner = language ? hljs.highlight(code, { language }).value : escapeHtml(code);
    } catch (_e) {
      // An unknown/incompatible grammar — fall back to plain escaped text
      // rather than failing the whole page over one code block.
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
const PROTECTED_HTML = /(<a\b[^>]*>[\S\s]*?<\/a>|<pre\b[\S\s]*?<\/pre>|<code\b[\S\s]*?<\/code>|<[^>]+>)/gi;
const BARE_URL = /\bhttps?:\/\/[^\s"'<>`]+/g;

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

export function renderMarkdownToHtml(src: string, lang?: string): string {
  const defaultLang = lang ?? "ts";
  const html = autolinkUrls(
    // eslint-disable-next-line import-x/no-named-as-default-member -- @markdoc/markdoc is CJS: only the default export exists at runtime, and importing { parse, transform, renderers } as named ESM bindings throws SyntaxError under Node's loader.
    highlightCodeBlocks(Markdoc.renderers.html(Markdoc.transform(Markdoc.parse(src))), defaultLang),
  );
  return html.replace(/<h2>Manual testing<\/h2>/g, '<h2 id="manual-testing">Manual testing</h2>');
}
