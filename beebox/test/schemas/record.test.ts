// # Record card schema: where a claim came from
//
// A record's `sources:` says where its content came from. Each entry names either
// an in-box card (`ref:`) or a page on the web (`href:`) — the same exclusive pair
// the `{% source %}` body tag takes, so a box agent writing a source has one
// vocabulary, not two. Before `href` existed a web source was written as a URL in
// `ref:`, and the linter's ref walk then reported it as a missing file.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { parseCardText } from "../../src/core/card-io.js";
import { createCardSchemaMap } from "../../src/schemas.js";
import { errorMessage } from "../../src/shared/error-guards.js";

const schemas = await createCardSchemaMap();
const parse = (fm: string) =>
  parseCardText(`---\n${fm}---\nA thing the box recorded.\n`, {
    source: "_content/records/Thing.record.card",
    schemas,
  });

const messageFor = (fm: string): string => {
  try {
    parse(fm);
    return "no error";
  } catch (e) {
    return errorMessage(e);
  }
};

// ## An in-box source and a web source each validate
void test("An in-box source and a web source each validate", async (t) => {
  const inBox = parse("status: draft\nname: Thing\nsources:\n  - ref: /_content/inbox/talk.capture-session.card\n    pos: at 1:23\n    note: named here\n");
  const web = parse("status: draft\nname: Thing\nsources:\n  - href: https://example.com/notice\n    retrieved: 2026-02-19\n");
  t.check([inBox.fields, web.fields], [
    {
      type: "record",
      name: "Thing",
      sources: [{ ref: "/_content/inbox/talk.capture-session.card", pos: "at 1:23", note: "named here" }],
      body: "A thing the box recorded.\n",
    },
    {
      type: "record",
      name: "Thing",
      sources: [{ href: "https://example.com/notice", retrieved: "2026-02-19" }],
      body: "A thing the box recorded.\n",
    },
  ]);

  // `pos` (where in the source) and `retrieved` (when a web page was read) are the
  // `{% source %}` tag's names. As on the tag, `retrieved` goes with an `href`:

  t.check(messageFor("status: draft\nname: Thing\nsources:\n  - ref: /_content/inbox/scan.pdf.card\n    retrieved: 2026-02-19\n"), "_content/records/Thing.record.card: invalid record frontmatter:\n  - sources[0]: a `sources` entry's `retrieved` is only valid with an external `href`");

  // ## An entry with neither, or both, is a schema error
  //
  // Both halves matter: "neither" is the empty entry an agent leaves behind when it
  // means to cite something, and "both" is the ambiguity that would make a reader
  // guess which target the note is really about.

  await t.checkThrows(async () => (parse("status: draft\nname: Thing\nsources:\n  - note: somewhere\n")), "CardIOError");

  await t.checkThrows(
    async () => (parse("status: draft\nname: Thing\nsources:\n  - ref: /_content/inbox/scan.pdf.card\n    href: https://example.com/notice\n"))
    ,
    "CardIOError",
  );

  // The message names the rule, so the agent that wrote the card can fix it without
  // reading the schema:

  t.check(messageFor("status: draft\nname: Thing\nsources:\n  - ref: /_content/inbox/scan.pdf.card\n    href: https://example.com/notice\n"), "_content/records/Thing.record.card: invalid record frontmatter:\n  - sources[0]: a `sources` entry takes exactly one of `ref` or `href`, not both");
});
