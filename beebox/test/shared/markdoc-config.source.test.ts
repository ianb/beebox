// # Markdoc `{% source %}` — ref/href validation
//
// The `source` tag carries provenance. It takes **at most one** of `ref` (an
// in-box, `bbx mv`-tracked target) or `href` (an external full URL), plus optional
// anchoring metadata (`pos`, `version`, `placement`). A bare anchor with neither
// targets the **containing document** — the ref-free default for commentary
// attached to the page it annotates. The tag's `validate` rule rejects only
// *both* at once.
//
// Markdoc does not run `validate` during normal `parse`/`transform` rendering —
// `card-lint` invokes `Markdoc.validate` on commentary card bodies so the rule
// actually fires (see the commentary card schema). This doctest exercises the
// rule directly.

import { test } from "tap";
import "agent-doctest/tap";
import Markdoc from "@markdoc/markdoc";
import { markdocConfig } from "../../src/shared/markdoc-config/tags/core.js";

// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { parse, validate, transform, Tag } = Markdoc;

// "valid" when the body has no validation errors, else the error ids joined.
function check(src: string): string {
  const errors = validate(parse(src), markdocConfig);
  if (errors.length === 0) return "valid";
  return errors.map((e) => e.error.id).join(", ");
}

function tagOf(node: unknown): Markdoc.Tag {
  if (!Tag.isTag(node)) throw new TypeError(`not a Markdoc tag: ${JSON.stringify(node)}`);
  return node;
}

function sourceTag(src: string): Markdoc.Tag {
  const tree = tagOf(transform(parse(src), markdocConfig));
  return tagOf(tagOf(tree.children[0]).children[0]);
}

// ## An external anchor (href + retrieved + pos + version + placement) validates
void test("An external anchor (href + retrieved + pos + version + placement) validates", async (t) => {
  // doctest:L38
  t.check(
    check('{% source href="https://example.com/doc" retrieved="2026-08-29" pos="body; ~line 4" version="git:7ffeae4 sha256:9f3a1c2b" placement="estimated, ~50% through the message" %}\nthe selected span\n{% /source %}')
    ,
    "valid",
  );
});

// The external schemes named by the guide remain valid without a retrieval date:
void test("The external schemes named by the guide remain valid without a retrieval date:", async (t) => {
  // doctest:L46
  t.check(check('{% source href="file:/Users/x/doc.md" %}local external file{% /source %}'), "valid");
});

// The transform preserves the retrieval date for the React source renderer:
void test("The transform preserves the retrieval date for the React source renderer:", async (t) => {
  // doctest:L54
  const transformed = sourceTag('{% source href="https://example.com" retrieved="2026-08-29" %}fact{% /source %}');
  t.check(`${transformed.name}:${transformed.attributes["retrieved"]}`, "SourceInline:2026-08-29");
});

// ## Retrieved must be a real ISO date
void test("Retrieved must be a real ISO date", async (t) => {
  // doctest:L63
  t.check(
    check('{% source href="https://example.com" retrieved="2026-02-29" %}fact{% /source %}')
    ,
    "source-retrieved-date",
  );
});

// ## Retrieved requires an external href
void test("Retrieved requires an external href", async (t) => {
  // doctest:L71
  t.check(check('{% source ref="/notes/research.doc.card" retrieved="2026-08-29" %}fact{% /source %}'), "source-retrieved-requires-href");
});

void test("Retrieved requires an external href (line 76)", async (t) => {
  // doctest:L77
  t.check(
    check('{% source href="https://example.com" retrieved="August 29, 2026" %}fact{% /source %}')
    ,
    "source-retrieved-date",
  );
});

// ## An in-box anchor (ref only) still validates — backward compatible
void test("An in-box anchor (ref only) still validates — backward compatible", async (t) => {
  // doctest:L85
  t.check(check('{% source ref="/store/notes/Bread.doc.card" usage="summary" %}\nshe went back and forth on the kitchen\n{% /source %}'), "valid");
});

// ## Neither ref nor href is valid — targets the containing document
void test("Neither ref nor href is valid — targets the containing document", async (t) => {
  // doctest:L93
  t.check(check('{% source pos="body" %}\nthe span, anchored to this page\n{% /source %}'), "valid");
});

// ## Both ref and href fails
void test("Both ref and href fails", async (t) => {
  // doctest:L101
  t.check(check('{% source ref="/a.card" href="file:/Users/x/doc.md" %}\nambiguous\n{% /source %}'), "source-ref-xor-href");
});
