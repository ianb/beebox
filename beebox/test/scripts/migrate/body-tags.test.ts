// # Migration: retire the type-specific core tags
//
// `body-tags-2026-10` rewrites the retired `image`, `silence`, `purpose`, and
// `correction` Markdoc tags: an image becomes a link, a silence becomes text, a
// briefing's purpose moves to frontmatter, and its corrections become a
// `## Corrections` section (docs/implemented-plans/retire-type-specific-core-tags.md,
// Track 4). It locates tags with the Markdoc parse and fails closed: when it
// cannot place a tag it names the path and line, writes nothing, and exits 1, so
// `bbx engine migrate` records no manifest entry.

import { test } from "tap";
import "agent-doctest/tap";
import { createHash } from "node:crypto";
import { planBodyTagRewrites } from "../../../src/scripts/migrate/body-tags/plan.js";
import { runBodyTags } from "../../../src/scripts/migrate/body-tags/run.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const SEED = "---\ntype: briefing\npurpose: Seed.\n---\nSeed body.\n";
const ROOT = "_content/briefing.briefing.card";

/** Plan one card; show the write as text, or the failures. */
function plan(...[path, text, stock]: [path: string, text: string, stock?: string[]]) {
  const r = planBodyTagRewrites([{ path, text }], { seed: SEED, stockSeedHashes: new Set(stock) });
  return { after: r.writes[0]?.after, failures: r.failures, skipped: r.skipped };
}
const briefing = (body: string, front?: string) => `---\n${front ?? "type: briefing\n"}---\n${body}`;

// ## A briefing: purpose to frontmatter, corrections to a section
//
// The purpose goes first after `type`. The blocks leave the body without a
// doubled blank line. One correction has a `test`, one spans two paragraphs and
// has an apostrophe in its text.
void test("The purpose goes first after type.", async (t) => {
  // doctest:L36
  t.check(
    plan("_content/lending/briefing.briefing.card", briefing(`{% purpose %}
Help the family keep track of what is lent out.
{% /purpose %}

Intro paragraph.

{% correction test="Ask about the red ladder" %}
Do not call it a loan.
{% /correction %}

Middle paragraph.

{% correction %}
First paragraph of the second fix.

It's the second paragraph that matters.
{% /correction %}
`, "type: briefing # kind\nopeners: x\n")),
    {
    after: `---
type: briefing # kind
purpose: Help the family keep track of what is lent out.
openers: x
---
Intro paragraph.

Middle paragraph.

## Corrections

- Do not call it a loan. Test: Ask about the red ladder
- First paragraph of the second fix. It's the second paragraph that matters.
`,
    failures: [],
    skipped: 0,
  },
  );
});

// Markdoc does not accept single-quoted attribute values (it parses them as an
// error), so a correction written that way fails closed instead of losing its
// `test`.
void test("Markdoc does not accept single-quoted attribute values (it parses them as an...", async (t) => {
  // doctest:L62
  t.check(plan("_content/briefing.briefing.card", briefing("{% correction test='x' %}\nFix.\n{% /correction %}\n")).failures, [
    {
      path: "_content/briefing.briefing.card",
      line: 4,
      reason: "Markdoc cannot parse this body (a malformed or single-quoted tag attribute); fix it by hand",
    },
  ]);
});

// ## A capture session: image and silence become link and text
void test("A capture session: image and silence become link and text", async (t) => {
  // doctest:L69
  t.check(
    plan("_content/capture/2026-10-01.capture-session.card", `---
type: capture-session
---
Hello there.

{% image ref="attach/photo-001.image.card" /%}

{% silence duration="26s" /%}

And then we left.
`),
    {
    after: `---
type: capture-session
---
Hello there.

[photo-001](attach/photo-001.image.card)

— 26s silence —

And then we left.
`,
    failures: [],
    skipped: 0,
  },
  );
});

// ## A book card: an inline image tag inside a sentence
void test("A book card: an inline image tag inside a sentence", async (t) => {
  // doctest:L86
  t.check(plan("_content/Books/Dune.book.card", "---\ntype: book\n---\nThe cover {% image ref=\"attach/dune-cover.image.card\" /%} is worn.\nSecond line.\n").after?.split("\n"), [
    "---",
    "type: book",
    "---",
    "The cover [dune-cover](attach/dune-cover.image.card) is worn.",
    "Second line.",
    "",
  ]);
});

// ## Fail-closed shapes
//
// A stray `purpose` outside a briefing:
void test("A stray purpose outside a briefing:", async (t) => {
  // doctest:L95
  await t.checkText(plan("_content/Notes/a.doc.card", "---\ntitle: Note\n---\nHi\n\n{% purpose %}\nx\n{% /purpose %}\n"), "{ failures: [{ path: \"_content/Notes/a.doc.card\", line: 6, reason: \"{% purpose %} is only valid in a briefing card\" }], skipped: 0 }");
});

// A correction inside a list item:
void test("A correction inside a list item:", async (t) => {
  // doctest:L102
  t.check(plan(ROOT, briefing("- item {% correction %}\nx\n{% /correction %}\n")).failures.map((f) => f.path), [
    "_content/briefing.briefing.card",
  ]);
});

// An image tag inside a code fence:
void test("An image tag inside a code fence:", async (t) => {
  // doctest:L109
  await t.checkText(plan("_content/Notes/b.doc.card", "---\ntitle: Note\n---\n```\n{% image ref=\"attach/z.image.card\" /%}\n```\n"), "{ failures: [{ path: \"_content/Notes/b.doc.card\", line: 5, reason: \"{% image %} inside a code fence or another tag; rewrite it by hand\" }], skipped: 0 }");
});

// Two purpose blocks, and a purpose that disagrees with the existing key:
void test("Two purpose blocks, and a purpose that disagrees with the existing key:", async (t) => {
  // doctest:L116
  t.check(
    ({ two: plan(ROOT, briefing("{% purpose %}\nA\n{% /purpose %}\n\n{% purpose %}\nB\n{% /purpose %}\n")).failures.map((f) => f.reason),
       clash: plan(ROOT, briefing("{% purpose %}\nA\n{% /purpose %}\n", "type: briefing\npurpose: B\n")).failures.map((f) => f.reason),
       same: plan(ROOT, briefing("{% purpose %}\nA\n{% /purpose %}\n", "type: briefing\npurpose: A\n")).after }),
    {
    two: [
      "two {% purpose %} blocks; keep one by hand",
    ],
    clash: [
      "a purpose: key already exists with different text; reconcile by hand",
    ],
    same: `---
type: briefing
purpose: A
---
`,
  },
  );
});

// An existing `## Corrections` heading:
void test("An existing ## Corrections heading:", async (t) => {
  // doctest:L125
  t.check(plan(ROOT, briefing("## Corrections\n\n- old\n\n{% correction %}\nnew\n{% /correction %}\n")).failures.map((f) => f.reason), [
    "the body already has a Corrections heading; merge by hand",
  ]);
});

// ## An already-migrated briefing is skipped
void test("An already-migrated briefing is skipped", async (t) => {
  // doctest:L132
  await t.checkText(plan(ROOT, briefing("Body.\n\n## Corrections\n\n- Fix.\n", "type: briefing\npurpose: Done.\n")), "{ failures: [], skipped: 1 }");
});

// ## A stock root briefing becomes the seed verbatim
//
// The seed is a function argument here; `run.ts` supplies `createBriefingTemplate()`
// and the `briefing-seed` hashes.
void test("The seed is a function argument here; run.ts supplies createBriefingTemplate(...", async (t) => {
  // doctest:L142
  const old = briefing("{% purpose %}\nWhat this box is for.\n{% /purpose %}\n");
  t.check(
    ({ stock: plan(ROOT, old, [sha(old)]).after === SEED, edited: plan(ROOT, old + "extra\n", [sha(old)]).after,
       notRoot: plan("_content/x/briefing.briefing.card", old, [sha(old)]).after === SEED }),
    {
    stock: true,
    edited: `---
type: briefing
purpose: What this box is for.
---
extra
`,
    notRoot: false,
  },
  );
});

// ## End to end against a temp box
//
// Plan only writes nothing. `--apply` converts, `--verify` is clean, and a rerun
// finds nothing to do.
void test("Plan only writes nothing.", async (t) => {
  // doctest:L154
  const box = await makeTmpBox();
  const CAP = "_content/capture/a.capture-session.card";
  const BR = "_content/lending/briefing.briefing.card";
  const capture = "---\ntype: capture-session\n---\nHi.\n\n{% silence duration=\"3s\" /%}\n";
  const lending = briefing("{% purpose %}\nLend things.\n{% /purpose %}\n");
  await box.write(CAP, capture);
  await box.write(BR, lending);
  const dry = await runBodyTags({ boxRoot: box.root, mode: "plan" });
  const dryUntouched = (await box.read(CAP)) === capture && (await box.read(BR)) === lending;
  const run = await runBodyTags({ boxRoot: box.root, mode: "apply" });
  t.check(
    ({ dry: dry.lines.slice(0, 2), dryUntouched, code: run.code, capture: await box.read(CAP), briefing: await box.read(BR),
      verify: await runBodyTags({ boxRoot: box.root, mode: "verify" }),
      rerun: (await runBodyTags({ boxRoot: box.root, mode: "apply" })).lines.map((l) => l.replace(/\d+ card/, "N card")) }),
    {
    dry: [
      "write _content/capture/a.capture-session.card (dry run; pass --apply)",
      "write _content/lending/briefing.briefing.card (dry run; pass --apply)",
    ],
    dryUntouched: true,
    code: 0,
    capture: `---
type: capture-session
---
Hi.

— 3s silence —
`,
    briefing: `---
type: briefing
purpose: Lend things.
---
`,
    verify: {
      code: 0,
      lines: [
        "body-tags: verify clean.",
      ],
    },
    rerun: [
      "body-tags: already migrated; N card(s) skipped.",
    ],
  },
  );
});

// A half-converted box: one card converted by hand, the other not. Apply
// converts the rest and verify is clean.
void test("A half-converted box:", async (t) => {
  // doctest:L176
  const box = await makeTmpBox();
  await box.write("_content/capture/a.capture-session.card", "---\ntype: capture-session\n---\nHi.\n\n— 3s silence —\n");
  await box.write("_content/capture/b.capture-session.card", "---\ntype: capture-session\n---\n{% image ref=\"attach/p.image.card\" /%}\n");
  const run = await runBodyTags({ boxRoot: box.root, mode: "apply" });
  t.check(
    ({ code: run.code, written: run.lines.filter((l) => l.startsWith("write")), b: await box.read("_content/capture/b.capture-session.card"),
       verify: (await runBodyTags({ boxRoot: box.root, mode: "verify" })).code }),
    {
    code: 0,
    written: [
      "write _content/capture/b.capture-session.card",
    ],
    b: `---
type: capture-session
---
[p](attach/p.image.card)
`,
    verify: 0,
  },
  );
});

// One unplaceable card fails the whole box: exit 1, nothing written, and
// `--verify` names the leftover tag.
void test("One unplaceable card fails the whole box:", async (t) => {
  // doctest:L189
  const box = await makeTmpBox();
  const OK = "_content/capture/a.capture-session.card";
  await box.write(OK, "---\ntype: capture-session\n---\n{% silence duration=\"3s\" /%}\n");
  await box.write("_content/Notes/a.doc.card", "---\ntitle: Note\n---\n{% purpose %}\nx\n{% /purpose %}\n");
  const run = await runBodyTags({ boxRoot: box.root, mode: "apply" });
  t.check(
    ({ code: run.code, lines: run.lines, untouched: (await box.read(OK)).includes("{% silence"),
       verify: (await runBodyTags({ boxRoot: box.root, mode: "verify" })).lines }),
    {
    code: 1,
    lines: [
      "failed: _content/Notes/a.doc.card:4: {% purpose %} is only valid in a briefing card",
      "body-tags: 1 failure(s); nothing written.",
    ],
    untouched: true,
    verify: [
      "still carries a retired tag: _content/Notes/a.doc.card",
      "still carries a retired tag: _content/capture/a.capture-session.card",
      "body-tags: verify failed; 2 card(s) still carry a retired tag.",
    ],
  },
  );
});

// `bbx validate` output was not checked here: it needs a full box command run, and
// `--verify` is the gate (body Markdoc findings are warnings there).
//
// ## Review fixes
//
// Block-form `image` (and `silence`) is not converted to a dangling close tag; it
// fails, and the closing tag is what `--verify` would also look for.
void test("bbx validate output was not checked here:", async (t) => {
  // doctest:L209
  t.check(plan("_content/Notes/c.doc.card", "---\ntitle: Note\n---\n{% image ref=\"attach/a.image.card\" %}\ncaption\n{% /image %}\n").failures.map((f) => f.reason), [
    "block-form {% image %}...{% /image %} is not supported; rewrite it by hand",
  ]);
});

// A `%` inside a quoted attribute is matched and converted.
void test("A % inside a quoted attribute is matched and converted.", async (t) => {
  // doctest:L216
  t.check(plan("_content/Notes/d.doc.card", "---\ntitle: Note\n---\nSee {% image ref=\"attach/a%20b.image.card\" /%} ok.\n").after?.split("\n")[3], "See [a%20b](attach/a%20b.image.card) ok.");
});

// A retired tag quoted in a code span cannot be told from the real tag by its
// source text, so a card holding one is left to a person, even when the real
// tag differs.
void test("A retired tag quoted in a code span cannot be told from the real tag by its s...", async (t) => {
  // doctest:L225
  t.check(plan("_content/Notes/d2.doc.card", "---\ntitle: Note\n---\nWrite `{% image ref=\"x\" /%}` then {% image ref=\"attach/a.image.card\" /%} ok.\n").failures.map((f) => f.reason), [
    "a retired tag is quoted in a code span in this card; rewrite the card by hand",
  ]);
});

// A ref that cannot be written as a markdown link fails (space in the stem):
void test("A ref that cannot be written as a markdown link fails (space in the stem):", async (t) => {
  // doctest:L232
  t.check(plan("_content/Notes/e.doc.card", "---\ntitle: Note\n---\n{% image ref=\"attach/cover 2.image.card\" /%}\n").failures.map((f) => f.reason), [
    "the image ref \"attach/cover 2.image.card\" cannot be written as a markdown link (whitespace or one of ] ( ) < >); rename the card or link it by hand",
  ]);
});

// A non-string `test` fails instead of being dropped:
void test("A non-string test fails instead of being dropped:", async (t) => {
  // doctest:L239
  t.check(plan(ROOT, briefing("{% correction test=42 %}\nFix.\n{% /correction %}\n")).failures.map((f) => f.reason), [
    "{% correction %} test must be a quoted string; fix it by hand",
  ]);
});

// An existing `purpose: null` is set in place; key order is kept.
void test("An existing purpose:", async (t) => {
  // doctest:L246
  t.check(plan(ROOT, briefing("{% purpose %}\nA\n{% /purpose %}\n", "type: briefing\nother: 1\npurpose:\nlast: 2\n")).after?.split("\n"), [
    "---",
    "type: briefing",
    "other: 1",
    "purpose: A",
    "last: 2",
    "---",
    "",
  ]);
});

// A comment on that null described the absence, so it does not follow the value.
void test("A comment on that null described the absence, so it does not follow the value.", async (t) => {
  // doctest:L253
  t.check(plan(ROOT, briefing("{% purpose %}\nA\n{% /purpose %}\n", "type: briefing\npurpose: # deliberately unset\nlast: 2\n")).after?.split("\n"), [
    "---",
    "type: briefing",
    "purpose: A",
    "last: 2",
    "---",
    "",
  ]);
});

// An interrupted stock-seed apply (seed written, ledger still on the old hash)
// is reconciled by the next `--apply`.
void test("An interrupted stock-seed apply (seed written, ledger still on the old hash)...", async (t) => {
  // doctest:L261
  const { createBriefingTemplate } = await import("../../../src/schemas/briefing.js");
  const { TEMPLATE_STOCK_HASHES } = await import("../../../src/core/template-stock-hashes.js");
  const { readVersions, writeVersions } = await import("../../../src/core/install-template-file.js");
  const OLD = "---\ntype: briefing\nopeners:\n  - Let me tell you what this box is for.\n  - What can you do?\n---\n{% purpose %}\nWhat this box is for.\n{% /purpose %}\n";
  const box = await makeTmpBox();
  const seed = createBriefingTemplate();
  await box.write(ROOT, seed);
  await writeVersions(box.root, { [ROOT]: { sha256: sha(OLD), "installed-at": "2026-09-01T00:00:00.000Z", stock: OLD } });
  const run = await runBodyTags({ boxRoot: box.root, mode: "apply" });
  t.check(
    ({ code: run.code, oldIsStock: TEMPLATE_STOCK_HASHES["briefing-seed"].superseded.includes(sha(OLD)),
       ledger: (await readVersions(box.root))[ROOT]?.sha256 === sha(seed), text: (await box.read(ROOT)) === seed }),
    {
    code: 0,
    oldIsStock: true,
    ledger: true,
    text: true,
  },
  );
});
