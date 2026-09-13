import assert from "node:assert/strict";
import { test } from "node:test";
import {
  corpusNavHtml,
  escapeMarkdocBraces,
  htmlDocumentShell,
  renderCorpusPageHtml,
  renderDirectoryIndexHtml,
  renderRootPageHtml,
  rewriteCorpusLinksToHtml,
} from "./docs-html.js";
import { renderAgentLlmsTxt } from "./docs-index.js";
import type { PublishedDoc } from "./docs-types.js";

function doc(params: { publishPath: string; description: string; body?: string }): PublishedDoc {
  const { publishPath, description } = params;
  return { publishPath, kind: "authored", description, body: params.body ?? "body", sourceLabel: publishPath };
}

// --- escapeMarkdocBraces -------------------------------------------------

test("escapeMarkdocBraces: a literal {% in prose is escaped", () => {
  assert.equal(escapeMarkdocBraces("Use {% aside ref=\"x\" /%} like this."), "Use &#123;% aside ref=\"x\" /%} like this.");
});

test("escapeMarkdocBraces: a fenced code block is left untouched", () => {
  const src = "before\n```\n{% nugget slug=\"x\" /%}\n```\nafter {% x %}";
  const out = escapeMarkdocBraces(src);
  assert.match(out, /```\n{% nugget slug="x" \/%}\n```/);
  assert.match(out, /after &#123;% x %}/);
});

test("escapeMarkdocBraces: an inline code span is left untouched", () => {
  const out = escapeMarkdocBraces("Write `{% aside %}` in prose, but {% real %} outside.");
  assert.match(out, /`{% aside %}`/);
  assert.match(out, /but &#123;% real %} outside/);
});

// --- rewriteCorpusLinksToHtml ---------------------------------------------

test("rewriteCorpusLinksToHtml: an absolute .md corpus link rewrites to .html, anchor kept", () => {
  const md = "See [glossary](http://localhost:3210/beebox/docs/concepts/glossary.md#terms) for more.";
  const out = rewriteCorpusLinksToHtml(md, { base: "/beebox/" });
  assert.equal(out, "See [glossary](http://localhost:3210/beebox/docs/concepts/glossary.html#terms) for more.");
});

test("rewriteCorpusLinksToHtml: a link with no anchor rewrites cleanly", () => {
  const md = "[x](http://localhost:3210/beebox/docs/uses/foo.md)";
  assert.equal(rewriteCorpusLinksToHtml(md, { base: "/beebox/" }), "[x](http://localhost:3210/beebox/docs/uses/foo.html)");
});

test("rewriteCorpusLinksToHtml: an external link is untouched", () => {
  const md = "[gh](https://github.com/ianb/beebox/blob/main/README.md)";
  assert.equal(rewriteCorpusLinksToHtml(md, { base: "/beebox/" }), md);
});

test("rewriteCorpusLinksToHtml: a llms.txt link is untouched (not under docs/)", () => {
  const md = "[root](http://localhost:3210/beebox/llms.txt)";
  assert.equal(rewriteCorpusLinksToHtml(md, { base: "/beebox/" }), md);
});

// --- document shell / nav --------------------------------------------------

test("htmlDocumentShell: doctype, lang, charset, viewport, title, one style block", () => {
  const out = htmlDocumentShell({ title: "A & B", bodyHtml: "<p>hi</p>" });
  assert.match(out, /^<!doctype html>\n<html lang="en">/);
  assert.match(out, /<meta charset="utf-8">/);
  assert.match(out, /<meta name="viewport"/);
  assert.match(out, /<title>A &amp; B<\/title>/);
  assert.equal((out.match(/<style>/g) ?? []).length, 1);
  assert.match(out, /<body>\n<p>hi<\/p>\n<\/body>/);
});

test("corpusNavHtml: directory/index/root, .html forms except root", () => {
  const nav = corpusNavHtml({ publishPath: "uses/email.md", base: "/beebox/" });
  assert.match(nav, /<a href="http:\/\/localhost:3210\/beebox\/docs\/uses\/">directory<\/a>/);
  assert.match(nav, /<a href="http:\/\/localhost:3210\/beebox\/docs\/uses\/index\.html">index<\/a>/);
  assert.match(nav, /<a href="http:\/\/localhost:3210\/beebox\/llms\.txt">/);
});

test("renderCorpusPageHtml: title from the first H1, footer links the .md twin", () => {
  const html = renderCorpusPageHtml({
    doc: doc({ publishPath: "uses/email.md", description: "d", body: "# Email under control\n\nBody." }),
    base: "/beebox/",
  });
  assert.match(html, /<title>Email under control<\/title>/);
  assert.match(html, /<nav>/);
  assert.match(html, /<footer>Plain text: <a href="http:\/\/localhost:3210\/beebox\/docs\/uses\/email\.md">email\.md<\/a><\/footer>/);
  assert.match(html, /<h1>Email under control<\/h1>/);
});

test("renderCorpusPageHtml: title falls back to the published path when there is no H1", () => {
  const html = renderCorpusPageHtml({ doc: doc({ publishPath: "uses/x.md", description: "d", body: "no heading here" }), base: "/" });
  assert.match(html, /<title>uses\/x\.md<\/title>/);
});

test("renderCorpusPageHtml: a literal {% %} example in prose renders as text, not a dropped tag", () => {
  const html = renderCorpusPageHtml({
    doc: doc({ publishPath: "reference/x.md", description: "d", body: "# X\n\nWrite `{% nugget slug=\"y\" /%}` like so." }),
    base: "/",
  });
  assert.match(html, /Write <code>{% nugget slug=&quot;y&quot; \/%}<\/code> like so\./);
});

test("renderDirectoryIndexHtml: wraps the same markdown the .md twin gets, links rewritten to .html", () => {
  const markdown = "# Concepts\n\nCore vocabulary.\n\n- [glossary.md](http://localhost:3210/beebox/docs/concepts/glossary.md): terms\n";
  const html = renderDirectoryIndexHtml({ dir: "concepts", markdown, base: "/beebox/" });
  assert.match(html, /<title>Concepts<\/title>/);
  assert.match(html, /href="http:\/\/localhost:3210\/beebox\/docs\/concepts\/glossary\.html"/);
  assert.match(html, /<footer>Plain text: <a href="http:\/\/localhost:3210\/beebox\/docs\/concepts\/index\.md">index\.md<\/a><\/footer>/);
});

// --- root pages / complete-index renderer ---------------------------------

test("renderRootPageHtml: no nav, no footer, title from the markdown's H1", () => {
  const html = renderRootPageHtml({ markdown: "# Bee Box\n\nSummary.", fallbackTitle: "fallback", sourceLabel: "dist/llms.txt", base: "/" });
  assert.match(html, /<title>Bee Box<\/title>/);
  assert.doesNotMatch(html, /<nav>/);
  assert.doesNotMatch(html, /<footer>/);
});

test("complete-index renderer: every published path appears once, spine first, grouped by directory in order", () => {
  const spine = [doc({ publishPath: "01-what.md", description: "What.", body: "# What Bee Box is" })];
  const directories = [
    { dir: "uses", purpose: "Real workflows.", docs: [doc({ publishPath: "uses/a.md", description: "A" }), doc({ publishPath: "uses/b.md", description: "B" })] },
    { dir: "concepts", purpose: "Vocabulary.", docs: [doc({ publishPath: "concepts/c.md", description: "C" })] },
  ];
  const markdown = renderAgentLlmsTxt({
    base: "/beebox/",
    readme: { summary: "s", preamble: "p" },
    spine,
    directories,
    installDir: { dir: "install", purpose: "Install." },
    devDir: { dir: "dev", purpose: "Dev." },
    sitePages: [],
  });
  const html = renderRootPageHtml({ markdown, fallbackTitle: "Bee Box", sourceLabel: "dist/llms.txt", base: "/beebox/" });

  const liCount = (html.match(/<li>/g) ?? []).length;
  const publishedPaths = [...spine, ...directories.flatMap((d) => d.docs)].map((d) => d.publishPath);
  assert.equal(liCount, publishedPaths.length + 4); // + install/ and llms-install.txt, dev/ and llms-dev.txt pointer rows
  for (const p of publishedPaths) {
    // The front page is itself HTML, so its embedded links point at each
    // page's rendered .html form, not the .md source (docs-html.ts's own
    // rewrite pass, exercised here end to end).
    const htmlPath = p.replace(/\.md$/, ".html");
    const occurrences = html.split(`docs/${htmlPath}`).length - 1;
    assert.equal(occurrences, 1, `${p} should appear exactly once`);
  }
  // dev/ and install/ children are not expanded on the front page — only
  // their own index.html pointer appears.
  assert.doesNotMatch(html, /docs\/dev\/(?!index\.html)/);
  assert.doesNotMatch(html, /docs\/install\/(?!index\.html)/);
  // Directory order follows the caller's array (uses before concepts).
  assert.ok(html.indexOf(">uses/<") < html.indexOf(">concepts/<"));
});
