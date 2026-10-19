// # Tag Parser
//
// `parseTags()` is a permissive XML-like tag parser for assistant responses. It handles nested tags, attributes, self-closing tags, and treats unmatched text as comment nodes.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { parseTags } from "../../../../src/lib/audio/speech-parsing/parseTags.js";

// Some assertions feed malformed/mismatched closing tags to exercise the
// permissive recovery path. Silence the warning so it doesn't pollute output.
console.warn = () => {};

// ## Simple tags
//
// A single tag with content:
void test("A single tag with content:", async (t) => {
  // doctest:L18
  const tags = parseTags("<greeting>Hello world</greeting>");
  t.check(tags, [
    {
      type: "greeting",
      attrs: {},
      content: "Hello world",
    },
  ]);
});

// ## Attributes
//
// Attributes are extracted as key-value pairs:
void test("Attributes are extracted as key-value pairs:", async (t) => {
  // doctest:L36
  const tags = parseTags('<task status="open" priority="high">Do thing</task>');
  t.check(tags, [
    {
      type: "task",
      attrs: {
        status: "open",
        priority: "high",
      },
      content: "Do thing",
    },
  ]);
});

// ## Self-closing tags
void test("Self-closing tags", async (t) => {
  // doctest:L47
  const tags = parseTags('<item ref="test.card" />');
  t.check(tags, [
    {
      type: "item",
      attrs: {
        ref: "test.card",
      },
      content: "",
    },
  ]);
});

// ## Nested tags
//
// Inner tags appear as subTags:
void test("Inner tags appear as subTags:", async (t) => {
  // doctest:L63
  const tags = parseTags("<outer><inner>nested</inner></outer>");
  t.check(tags, [
    {
      type: "outer",
      attrs: {},
      content: "<inner>nested</inner>",
      subTags: [
        {
          type: "inner",
          attrs: {},
          content: "nested",
        },
      ],
    },
  ]);


});

// ## Filtering with allowTags
//
// Only specified tags are parsed — others are ignored:
void test("Only specified tags are parsed — others are ignored:", async (t) => {
  // doctest:L81
  const tags = parseTags("<speech>Hello <b>world</b></speech>", ["speech"]);
  t.check(tags, [
    {
      type: "speech",
      attrs: {},
      content: "Hello <b>world</b>",
    },
  ]);
});

// ## Text between tags becomes comments
void test("Text between tags becomes comments", async (t) => {
  // doctest:L92
  const tags = parseTags("Some text <tag>inside</tag> more text");
  t.check(tags, [
    {
      type: "comment",
      attrs: {},
      content: "Some text",
    },
    {
      type: "tag",
      attrs: {},
      content: "inside",
    },
    {
      type: "comment",
      attrs: {},
      content: "more text",
    },
  ]);
});

// ## Strips surrounding backticks
//
// Backticks wrapping the input are removed (common in LLM output):
void test("Backticks wrapping the input are removed (common in LLM output):", async (t) => {
  // doctest:L102
  const tags = parseTags("`<tag>content</tag>`");
  t.check(tags, [
    {
      type: "tag",
      attrs: {},
      content: "content",
    },
  ]);
});

// ## Empty input
void test("Empty input", async (t) => {
  // doctest:L113
  t.check(parseTags(""), []);

  // doctest:L116
  t.check(parseTags("   "), []);
});

// ## Paired non-allowed tags don't warn (their closers are skipped like their openers)
//
// With an `allowTags` filter active, an opener outside the allowlist is
// skipped without being pushed on the stack — so its CLOSER must be skipped
// the same way, not reported as "Unexpected closing tag". The documented
// paired ack form (`<ack kind="…">note</ack>`) hits exactly this.
void test("With an allowTags filter active, an opener outside the allowlist is skipped w...", async (t) => {
  // doctest:L128
  let warned = 0;
  const origWarn = console.warn;
  console.warn = () => { warned += 1; };
  const tags = parseTags('<speech>hi</speech> <ack kind="appended" ref="x.card">a note</ack>', ["speech"]);
  console.warn = origWarn;

  // doctest:L134
  t.check(warned, 0);

  // doctest:L137
  t.check(tags, [
    {
      type: "speech",
      attrs: {},
      content: "hi",
    },
    {
      type: "comment",
      attrs: {},
      content: "a note",
    },
  ]);
});

// An unmatched closer of an ALLOWED tag still warns — that's real
// malformation worth surfacing:
void test("An unmatched closer of an ALLOWED tag still warns — that's real malformation...", async (t) => {
  // doctest:L145
  let warned2 = 0;
  const origWarn2 = console.warn;
  console.warn = () => { warned2 += 1; };
  parseTags("text </speech> more", ["speech"]);
  console.warn = origWarn2;

  // doctest:L151
  t.check(warned2, 1);
});
