// Unit tests for the generator's pure pieces: base-path derivation, internal-
// link resolution, strict frontmatter parsing (errors name file+line), and the
// Markdoc link rewrite/collect pass. Run with:
//   node --import tsx --test site/build.test.ts   (or `pnpm --dir site test`)

import assert from "node:assert/strict";
import { test } from "node:test";
import { baseFromBranch, normalizeBase, classifyHref, resolveInternalHref, BasePathError } from "./links.js";
import { parseSource, renderBody, FrontmatterError } from "./render.js";

const AUTHORSHIP = `authorship:
  people:
    - name: Ian Bicking
      role: author
      contribution: Directed the card.
  ai:
    transcription: none
    drafting: none
    editing: none
`;

// --- base derivation ----------------------------------------------------------

test("baseFromBranch: worktree branch strips prefix; main stays main", () => {
  assert.equal(baseFromBranch("worktree-github-pages-site"), "/github-pages-site/site/");
  assert.equal(baseFromBranch("main"), "/main/site/");
});

test("normalizeBase: adds a trailing slash, requires a leading slash", () => {
  assert.equal(normalizeBase("/beebox"), "/beebox/");
  assert.equal(normalizeBase("/beebox/"), "/beebox/");
  assert.throws(() => normalizeBase("beebox/"), BasePathError);
});

// --- href classification ------------------------------------------------------

test("classifyHref: external, anchor, internal", () => {
  assert.equal(classifyHref("https://example.com"), "external");
  assert.equal(classifyHref("mailto:x@y.z"), "external");
  assert.equal(classifyHref("//cdn.example.com/x"), "external");
  assert.equal(classifyHref("#section"), "anchor");
  assert.equal(classifyHref("about.md"), "internal");
  assert.equal(classifyHref("/docs/x.md"), "internal");
});

// --- internal link resolution -------------------------------------------------

test("resolveInternalHref: root-absolute .md rewrites to base + .html", () => {
  const r = resolveInternalHref({ href: "/docs/x.md", pageSitePath: "index.html", base: "/beebox/" });
  assert.equal(r.target, "docs/x.html");
  assert.equal(r.href, "/beebox/docs/x.html");
});

test("resolveInternalHref: page-relative link resolves against the page directory", () => {
  const r = resolveInternalHref({ href: "sibling.md", pageSitePath: "sub/page.html", base: "/main/site/" });
  assert.equal(r.target, "sub/sibling.html");
  assert.equal(r.href, "/main/site/sub/sibling.html");
});

test("resolveInternalHref: anchors are preserved", () => {
  const r = resolveInternalHref({ href: "/x.md#part", pageSitePath: "index.html", base: "/b/" });
  assert.equal(r.target, "x.html");
  assert.equal(r.href, "/b/x.html#part");
});

// --- strict frontmatter (errors name file+line) -------------------------------

test("parseSource: valid frontmatter parses; body follows the fence", () => {
  const { frontmatter, body } = parseSource(`---\ntitle: "T"\nsummary: "S"\n${AUTHORSHIP}---\nhello`, "content/index.md");
  assert.equal(frontmatter.title, "T");
  assert.equal(frontmatter.summary, "S");
  assert.equal(body, "hello");
});

test("parseSource: missing frontmatter fails naming file:1", () => {
  assert.throws(() => parseSource("no fence here", "content/x.md"), (e: unknown) => {
    assert.ok(e instanceof FrontmatterError);
    assert.match(e.message, /^content\/x\.md:1 /);
    return true;
  });
});

test("parseSource: malformed YAML fails with a line number", () => {
  const src = "---\ntitle: \"T\"\n  bad: : :\n---\nbody";
  assert.throws(() => parseSource(src, "content/x.md"), (e: unknown) => {
    assert.ok(e instanceof FrontmatterError);
    assert.match(e.message, /content\/x\.md:\d+ invalid frontmatter YAML/);
    return true;
  });
});

test("parseSource: unknown field is rejected (strict) and named", () => {
  const src = `---\ntitle: "T"\nsummary: "S"\n${AUTHORSHIP}extra: nope\n---\nbody`;
  assert.throws(() => parseSource(src, "content/x.md"), (e: unknown) => {
    assert.ok(e instanceof FrontmatterError);
    assert.match(e.message, /frontmatter field/);
    return true;
  });
});

test("parseSource: missing required field is named", () => {
  assert.throws(() => parseSource(`---\nsummary: "S"\n${AUTHORSHIP}---\nbody`, "content/x.md"), (e: unknown) => {
    assert.ok(e instanceof FrontmatterError);
    assert.match(e.message, /"title"/);
    return true;
  });
});

test("parseSource: authorship requires people and core AI categories but accepts new AI work", () => {
  const src = `---\ntitle: "T"\nsummary: "S"\n${AUTHORSHIP}    source-preparation: Prepared source excerpts.\n---\nbody`;
  const { frontmatter } = parseSource(src, "content/x.md");
  assert.equal(frontmatter.authorship.ai["source-preparation"], "Prepared source excerpts.");
  const missingEditing = src.replace("    editing: none\n", "");
  assert.throws(() => parseSource(missingEditing, "content/x.md"), /authorship\.ai\.editing/);
});

// --- render: link rewrite + collect (base-path link integrity) ----------------

test("renderBody: internal links rewrite against base and are collected; externals open in a new tab", () => {
  const body = "See [about](/about.md) and [gh](https://github.com/x).";
  const underPages = renderBody(body, { file: "cards/index.site-page.card", pageSitePath: "index.html", base: "/beebox/" });
  assert.match(underPages.html, /href="\/beebox\/about\.html"/);
  assert.match(underPages.html, /href="https:\/\/github\.com\/x" target="_blank" rel="noopener noreferrer"/);
  assert.match(underPages.html, /href="\/beebox\/about\.html"(?![^>]*target=)/);
  assert.deepEqual(underPages.linkTargets, ["about.html"]);

  // Same source under the router base: identical target, base-shifted href.
  const underRouter = renderBody(body, { file: "cards/index.site-page.card", pageSitePath: "index.html", base: "/wt/site/" });
  assert.match(underRouter.html, /href="\/wt\/site\/about\.html"/);
  assert.deepEqual(underRouter.linkTargets, ["about.html"]);
});

// --- twin flattening order (cross-model review, 2026-08-20) --------------------

test("twin: a nugget tag inside a referenced aside's body survives flattening", async () => {
  const { twinMarkdown } = await import("./build.js");
  const asides = new Map([
    ["a1", {
      slug: "a1",
      file: "cards/a1.site-aside.card",
      fields: { kind: "generated" as const, label: "with a nugget", status: "ready" as const },
      body: "Intro.\n\n{% nugget slug=\"n1\" /%}",
    }],
  ]);
  const nuggets = [{
    slug: "n1",
    file: "nuggets/n1.md",
    source: "callback-box/docs/a.md",
    span: "the span text",
    status: "excerpt" as const,
    body: "",
    spanState: "current" as const,
  }];
  const twin = twinMarkdown("Page.\n\n{% aside ref=\"a1\" /%}\n", { nuggets, asides });
  assert.match(twin, /with a nugget/);
  assert.match(twin, /> the span text/);
  assert.match(twin, /— from callback-box\/docs\/a.md/);
});
