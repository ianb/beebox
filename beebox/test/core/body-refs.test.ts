// # Body refs
//
// `extractBodyRefs(body)` walks a card's markdown body for refs carried by
// Markdoc tag attributes literally named `ref`. Cardworks' frontmatter ref
// walker doesn't see into body strings, so this complements it for refs that
// live in body tags like `{% source ref="…" %}` — any body tag whose
// attribute is literally named `ref`.

import { test } from "tap";
import "agent-doctest/tap";
import { extractBodyLinks, extractBodyRefs, extractReferenceDefinitions } from "../../src/core/body-refs.js";
import { rewriteReferrerRefs } from "../../src/core/rewrite-card-refs/core.js";

// ## A single `{% source %}` tag
//
// The ref value and a `body:<line>:<tag>.<attr>` path are returned.
void test("The ref value and a body:<line>:<tag>.<attr> path are returned.", async (t) => {
  t.check(
    extractBodyRefs('Dana said: {% source ref="/box/people/dana.person.card" usage="verbatim" %}ship Friday{% /source %}'),
    [{ path: "body:1:source.ref", ref: "/box/people/dana.person.card" }],
  );
});

// ## Multiple tags across lines
//
// Line numbers are 1-indexed and track each tag's start line.
void test("Line numbers are 1-indexed and track each tag's start line.", async (t) => {
  const body = [
    "Intro paragraph.",
    "",
    '{% source ref="/box/a.doc.card" %}first{% /source %}',
    "",
    '{% subrecipe ref="/box/sauce.recipe.card" %}Sauce{% /subrecipe %}',
  ].join("\n");
  t.check(extractBodyRefs(body), [
    {
      path: "body:3:source.ref",
      ref: "/box/a.doc.card",
    },
    {
      path: "body:5:subrecipe.ref",
      ref: "/box/sauce.recipe.card",
    },
  ]);
});

// ## Nested tags
//
// A `ref` on the outer tag is found; the inner tag without a ref contributes
// nothing.
void test("A ref on the outer tag is found; the inner tag without a ref contributes noth...", async (t) => {
  t.check(
    extractBodyRefs('{% source ref="/box/m.doc.card" usage="verbatim" %}{% quote %}exact words{% /quote %}{% /source %}'),
    [{ path: "body:1:source.ref", ref: "/box/m.doc.card" }],
  );
});

// ## Bodies with no body-tag refs
//
// Plain markdown (including inline markdown links, which are not Markdoc tags)
// yields nothing — link rewriting is handled elsewhere, not here.
void test("Plain markdown (including inline markdown links, which are not Markdoc tags)...", async (t) => {
  t.check(extractBodyRefs("Just prose with a [link](people/Priya.person.card) and **bold**."), []);

  t.check(extractBodyRefs(""), []);
});

// A tag with no `ref` attribute is ignored.
void test("A tag with no ref attribute is ignored.", async (t) => {
  t.check(extractBodyRefs("{% callout type=\"note\" %}heads up{% /callout %}"), []);
});

// ## Reference-style link definitions: continuation-line and angle-bracket destinations
//
// CommonMark allows a link reference definition's destination to be on the
// line AFTER the `[id]:` label, and to be delimited with `<...>` instead of
// written bare. The Markdoc parser this codebase renders/lints with already
// resolves both forms as real links, so the extractor needs to see them too.
void test("CommonMark allows a link reference definition's destination to be on the line...", async (t) => {
  const body = [
    "[s]:",
    "  /store/recipes/Soup.recipe.card",
    "",
    "See [soup][s].",
  ].join("\n");
  t.check(extractReferenceDefinitions(body), [
    {
      path: "body:2:ref-def",
      ref: "/store/recipes/Soup.recipe.card",
    },
  ]);
});

void test("Reference-style link definitions: continuation-line and angle-bracket destinations", async (t) => {
  t.check(extractReferenceDefinitions("[t]: </store/x.card>\n\nSee [thing][t]."), [
    {
      path: "body:1:ref-def",
      ref: "/store/x.card",
    },
  ]);
});

// A blank line between the label and a would-be continuation destination ends
// the definition — no destination is found (matching CommonMark and this
// codebase's Markdoc parser).
void test("A blank line between the label and a would-be continuation destination ends t...", async (t) => {
  t.check(extractReferenceDefinitions("[s]:\n\n  /store/x.card"), []);
});

// ## CRLF line endings don't hide a reference definition (finding 7, round 3 hardening)
//
// JS regex `.` excludes every line-terminator character, `\r` included — a
// Windows-line-ending body's raw `\r`-suffixed line (left attached after
// `body.split("\n")`) previously made the label-line pattern's `(.*)$` fail to
// match at all, so a CRLF body's reference definitions were invisible to both
// extraction and the migration's rewriter (they share this one matcher).
void test("JS regex . excludes every line-terminator character, \\r included — a Windows-...", async (t) => {
  const crlfBody = "[s]: /store/recipes/Soup.recipe.card\r\n\r\nSee [soup][s].\r\n";
  t.check(extractReferenceDefinitions(crlfBody), [
    {
      path: "body:1:ref-def",
      ref: "/store/recipes/Soup.recipe.card",
    },
  ]);
});

// The continuation-line form works under CRLF too:
void test("The continuation-line form works under CRLF too:", async (t) => {
  const crlfContinuation = "[s]:\r\n  /store/recipes/Soup.recipe.card\r\n\r\nSee [soup][s].\r\n";
  t.check(extractReferenceDefinitions(crlfContinuation), [
    {
      path: "body:2:ref-def",
      ref: "/store/recipes/Soup.recipe.card",
    },
  ]);
});

// ## A reference definition inside a blockquote is recognized (finding 7)
//
// CommonMark allows a link reference definition inside a blockquote
// container — `> [id]: /path` — and this codebase's Markdoc parser already
// resolves it into a real link.
void test("CommonMark allows a link reference definition inside a blockquote container —...", async (t) => {
  const quoted = "> [s]: /store/recipes/Soup.recipe.card\n\nSee [soup][s].\n";
  t.check(extractReferenceDefinitions(quoted), [
    {
      path: "body:1:ref-def",
      ref: "/store/recipes/Soup.recipe.card",
    },
  ]);
});

// A nested blockquote (`> > [id]: /path`) is recognized too:
void test("A nested blockquote (> > [id]:", async (t) => {
  const nestedQuoted = "> > [s]: /store/recipes/Soup.recipe.card\n\nSee [soup][s].\n";
  t.check(extractReferenceDefinitions(nestedQuoted), [
    {
      path: "body:1:ref-def",
      ref: "/store/recipes/Soup.recipe.card",
    },
  ]);
});

// ## A reference definition inside a list item is recognized (finding 6, round 4 hardening)
//
// CommonMark allows a link reference definition to be the first block inside a
// list item — `- [id]: /path` — and this codebase's Markdoc parser already
// resolves it into a real link. Before this fix, only the blockquote prefix was
// stripped, so a list-contained definition was invisible to extraction (and to
// the migration's rewriter and the hard link gate, which share this matcher).
void test("CommonMark allows a link reference definition to be the first block inside a...", async (t) => {
  const bulleted = "- [id]: /people/X.person.card\n\nSee [x][id].\n";
  t.check(extractReferenceDefinitions(bulleted), [
    {
      path: "body:1:ref-def",
      ref: "/people/X.person.card",
    },
  ]);
});

// `*` and `+` bullets, and an ordered marker (`1.` / `2)`), all work:
void test(" and + bullets, and an ordered marker (1. / 2)), all work:", async (t) => {
  t.check(extractReferenceDefinitions("* [id]: /a.card"), [{ path: "body:1:ref-def", ref: "/a.card" }]);
  t.check(extractReferenceDefinitions("+ [id]: /a.card"), [{ path: "body:1:ref-def", ref: "/a.card" }]);
  t.check(extractReferenceDefinitions("1. [id]: /a.card"), [{ path: "body:1:ref-def", ref: "/a.card" }]);
  t.check(extractReferenceDefinitions("2) [id]: /a.card"), [{ path: "body:1:ref-def", ref: "/a.card" }]);
});

// A quoted list item (blockquote containing a list) strips both prefixes:
void test("A quoted list item (blockquote containing a list) strips both prefixes:", async (t) => {
  t.check(extractReferenceDefinitions("> - [id]: /people/X.person.card"), [
    { path: "body:1:ref-def", ref: "/people/X.person.card" },
  ]);
});

// ## HTML links and images are links too
//
// A body may link with raw HTML: the allow-list renders `<a href>` and
// `<img src>` as ordinary links and images. Validate checks their in-box targets
// and `bbx mv` rewrites them, exactly like `[text](path)`. External URLs are
// skipped.
void test("A body may link with raw HTML:", async (t) => {
  const html = 'See <a href="/_content/people/Ana.person.card">Ana</a>,\n<img src="attach/plan.png" width="200"> and <a href="https://example.com">x</a>.';
  t.check(extractBodyLinks(html), [
    {
      path: "body:1:link",
      ref: "/_content/people/Ana.person.card",
    },
    {
      path: "body:2:link",
      ref: "attach/plan.png",
    },
  ]);

  t.check(
    rewriteReferrerRefs({
      boxRoot: "/box",
      cardAbsPath: "/box/_content/notes/Plan.doc.card",
      text: html,
      remap: (abs) => (abs === "/box/_content/people/Ana.person.card" ? "/box/_content/people/Ana_Lee.person.card" : null),
    }),
    {
    text: `See <a href="/_content/people/Ana_Lee.person.card">Ana</a>,
<img src="attach/plan.png" width="200"> and <a href="https://example.com">x</a>.`,
    count: 1,
  },
  );
});

// Unquoted attribute values count too:
void test("Unquoted attribute values count too:", async (t) => {
  t.check(extractBodyLinks("<a href=/_content/x.doc.card>x</a> <img src=attach/p.png>"), [
    {
      path: "body:1:link",
      ref: "/_content/x.doc.card",
    },
    {
      path: "body:1:link",
      ref: "attach/p.png",
    },
  ]);
});

// ## Malformed bodies are swallowed
//
// A body that throws on parse is treated as "no refs" rather than crashing the
// caller (validation/move would rather miss a warning than fail the card).
void test("A body that throws on parse is treated as \"no refs\" rather than crashing the...", async (t) => {
  t.check(extractBodyRefs("{% source ref=unclosed"), []);
});

// ## A footnote definition is not a reference definition
//
// `[^label]: text` defines a footnote. Its text is not a link destination, so it
// is not checked as a ref:
void test("[^label]:", async (t) => {
  t.check(extractReferenceDefinitions("A claim.[^1]\n\n[^1]: The footnote text.\n[r]: /_content/x.card"), [
    {
      path: "body:4:ref-def",
      ref: "/_content/x.card",
    },
  ]);
});
