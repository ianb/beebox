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
import "@ianbicking/tap-check/tap";
import { any, containing } from "@ianbicking/tap-check/check";
import { createHash } from "node:crypto";
import { planBodyTagRewrites } from "../../../src/scripts/migrate/body-tags/plan.js";
import { runBodyTags } from "../../../src/scripts/migrate/body-tags/run.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

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
  t.check(plan("_content/briefing.briefing.card", briefing("{% correction test='x' %}\nFix.\n{% /correction %}\n")), {
    after: undefined,
    failures: [
      {
        path: "_content/briefing.briefing.card",
        line: 4,
        reason: "Markdoc cannot parse this body (a malformed or single-quoted tag attribute); fix it by hand",
      },
    ],
    skipped: 0,
  });
});

// ## A capture session: image and silence become link and text
void test("A capture session: image and silence become link and text", async (t) => {
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
  t.check(plan("_content/Books/Dune.book.card", "---\ntype: book\n---\nThe cover {% image ref=\"attach/dune-cover.image.card\" /%} is worn.\nSecond line.\n"), {
    after: "---\ntype: book\n---\nThe cover [dune-cover](attach/dune-cover.image.card) is worn.\nSecond line.\n",
    failures: [],
    skipped: 0,
  });
});

// ## Fail-closed shapes
//
// A stray `purpose` outside a briefing:
void test("A stray purpose outside a briefing:", async (t) => {
  t.check(plan("_content/Notes/a.doc.card", "---\ntitle: Note\n---\nHi\n\n{% purpose %}\nx\n{% /purpose %}\n"), {
    after: undefined,
    failures: [{ path: "_content/Notes/a.doc.card", line: 6, reason: "{% purpose %} is only valid in a briefing card" }],
    skipped: 0,
  });
});

// A correction inside a list item:
void test("A correction inside a list item:", async (t) => {
  t.check(plan(ROOT, briefing("- item {% correction %}\nx\n{% /correction %}\n")), {
    after: undefined,
    failures: [
      {
        path: "_content/briefing.briefing.card",
        line: 4,
        reason: "{% correction %} must be a block directly in the body (not inline, in a list, a fence, or another tag); move it by hand",
      },
    ],
    skipped: 0,
  });
});

// An image tag inside a code fence:
void test("An image tag inside a code fence:", async (t) => {
  t.check(plan("_content/Notes/b.doc.card", "---\ntitle: Note\n---\n```\n{% image ref=\"attach/z.image.card\" /%}\n```\n"), {
    after: undefined,
    failures: [{ path: "_content/Notes/b.doc.card", line: 5, reason: "{% image %} inside a code fence or another tag; rewrite it by hand" }],
    skipped: 0,
  });
});

// Two purpose blocks, and a purpose that disagrees with the existing key:
void test("Two purpose blocks, and a purpose that disagrees with the existing key:", async (t) => {
  const FM = "type: briefing\npurpose: B\n";
  t.check(plan(ROOT, briefing("{% purpose %}\nA\n{% /purpose %}\n\n{% purpose %}\nB\n{% /purpose %}\n")), {
    after: undefined,
    failures: [{ path: "_content/briefing.briefing.card", line: 8, reason: "two {% purpose %} blocks; keep one by hand" }],
    skipped: 0,
  });
  t.check(plan(ROOT, briefing("{% purpose %}\nA\n{% /purpose %}\n", FM)), {
    after: undefined,
    failures: [{ path: "_content/briefing.briefing.card", line: 5, reason: "a purpose: key already exists with different text; reconcile by hand" }],
    skipped: 0,
  });
  t.check(plan(ROOT, briefing("{% purpose %}\nA\n{% /purpose %}\n", "type: briefing\npurpose: A\n")), {
    after: "---\ntype: briefing\npurpose: A\n---\n",
    failures: [],
    skipped: 0,
  });
});

// An existing `## Corrections` heading:
void test("An existing ## Corrections heading:", async (t) => {
  t.check(plan(ROOT, briefing("## Corrections\n\n- old\n\n{% correction %}\nnew\n{% /correction %}\n")), {
    after: undefined,
    failures: [
      {
        path: "_content/briefing.briefing.card",
        line: 8,
        reason: "the body already has a Corrections heading; merge by hand",
      },
    ],
    skipped: 0,
  });
});

// ## An already-migrated briefing is skipped
void test("An already-migrated briefing is skipped", async (t) => {
  t.check(plan(ROOT, briefing("Body.\n\n## Corrections\n\n- Fix.\n", "type: briefing\npurpose: Done.\n")), { after: undefined, failures: [], skipped: 1 });
});

// ## A stock root briefing becomes the seed verbatim
//
// The seed is a function argument here; `run.ts` supplies `createBriefingTemplate()`
// and the `briefing-seed` hashes.
void test("The seed is a function argument here; run.ts supplies createBriefingTemplate(...", async (t) => {
  const old = briefing("{% purpose %}\nWhat this box is for.\n{% /purpose %}\n");
  t.check(plan(ROOT, old, [sha(old)]), { after: SEED, failures: [], skipped: 0 });
  t.check(plan(ROOT, old + "extra\n", [sha(old)]), {
    after: "---\ntype: briefing\npurpose: What this box is for.\n---\nextra\n",
    failures: [],
    skipped: 0,
  });
  t.check(plan("_content/x/briefing.briefing.card", old, [sha(old)]), {
    after: "---\ntype: briefing\npurpose: What this box is for.\n---\n",
    failures: [],
    skipped: 0,
  });
});

// ## End to end against a temp box
//
// Plan only writes nothing. `--apply` converts, `--verify` is clean, and a rerun
// finds nothing to do.
void test("Plan only writes nothing.", async (t) => {
  const box = await makeTmpBox();
  const CAP = "_content/capture/a.capture-session.card";
  const BR = "_content/lending/briefing.briefing.card";
  const capture = "---\ntype: capture-session\n---\nHi.\n\n{% silence duration=\"3s\" /%}\n";
  const lending = briefing("{% purpose %}\nLend things.\n{% /purpose %}\n");
  await box.write(CAP, capture);
  await box.write(BR, lending);
  const dry = await runBodyTags({ boxRoot: box.root, mode: "plan" });
  t.check(dry.lines.slice(0, 2), [
    "write _content/capture/a.capture-session.card (dry run; pass --apply)",
    "write _content/lending/briefing.briefing.card (dry run; pass --apply)",
  ]);
  t.check([await box.read(CAP), await box.read(BR)], [capture, lending]);
  const run = await runBodyTags({ boxRoot: box.root, mode: "apply" });
  t.check(run.code, 0);
  t.check(await box.read(CAP), "---\ntype: capture-session\n---\nHi.\n\n— 3s silence —\n");
  t.check(await box.read(BR), "---\ntype: briefing\npurpose: Lend things.\n---\n");
  t.check(await runBodyTags({ boxRoot: box.root, mode: "verify" }), { code: 0, lines: ["body-tags: verify clean."] });
  // The skipped count includes the seeded template cards, so it changes with the template set.
  t.check((await runBodyTags({ boxRoot: box.root, mode: "apply" })).lines, [
    any(String).matches(/^body-tags: already migrated; \d+ card\(s\) skipped\.$/),
  ]);
});

// A half-converted box: one card converted by hand, the other not. Apply
// converts the rest and verify is clean.
void test("A half-converted box:", async (t) => {
  const box = await makeTmpBox();
  await box.write("_content/capture/a.capture-session.card", "---\ntype: capture-session\n---\nHi.\n\n— 3s silence —\n");
  await box.write("_content/capture/b.capture-session.card", "---\ntype: capture-session\n---\n{% image ref=\"attach/p.image.card\" /%}\n");
  const run = await runBodyTags({ boxRoot: box.root, mode: "apply" });
  t.check(run.code, 0);
  // The skipped count includes the seeded template cards.
  t.check(run.lines, [
    "write _content/capture/b.capture-session.card",
    any(String).matches(/^body-tags: rewrite 1, skipped \d+\.$/),
  ]);
  t.check(await box.read("_content/capture/b.capture-session.card"), "---\ntype: capture-session\n---\n[p](attach/p.image.card)\n");
  t.check((await runBodyTags({ boxRoot: box.root, mode: "verify" })).code, 0);
});

// One unplaceable card fails the whole box: exit 1, nothing written, and
// `--verify` names the leftover tag.
void test("One unplaceable card fails the whole box:", async (t) => {
  const box = await makeTmpBox();
  const OK = "_content/capture/a.capture-session.card";
  await box.write(OK, "---\ntype: capture-session\n---\n{% silence duration=\"3s\" /%}\n");
  await box.write("_content/Notes/a.doc.card", "---\ntitle: Note\n---\n{% purpose %}\nx\n{% /purpose %}\n");
  const run = await runBodyTags({ boxRoot: box.root, mode: "apply" });
  t.check(run, {
    code: 1,
    lines: [
      "failed: _content/Notes/a.doc.card:4: {% purpose %} is only valid in a briefing card",
      "body-tags: 1 failure(s); nothing written.",
    ],
  });
  t.check(await box.read(OK), "---\ntype: capture-session\n---\n{% silence duration=\"3s\" /%}\n");
  t.check(await runBodyTags({ boxRoot: box.root, mode: "verify" }), {
    code: 1,
    lines: [
      "still carries a retired tag: _content/Notes/a.doc.card",
      "still carries a retired tag: _content/capture/a.capture-session.card",
      "body-tags: verify failed; 2 card(s) still carry a retired tag.",
    ],
  });
});

// `bbx validate` output was not checked here: it needs a full box command run, and
// `--verify` is the gate (body Markdoc findings are warnings there).
//
// ## Review fixes
//
// Block-form `image` (and `silence`) is not converted to a dangling close tag; it
// fails, and the closing tag is what `--verify` would also look for.
void test("bbx validate output was not checked here:", async (t) => {
  t.check(plan("_content/Notes/c.doc.card", "---\ntitle: Note\n---\n{% image ref=\"attach/a.image.card\" %}\ncaption\n{% /image %}\n"), {
    after: undefined,
    failures: [
      {
        path: "_content/Notes/c.doc.card",
        line: 4,
        reason: "block-form {% image %}...{% /image %} is not supported; rewrite it by hand",
      },
    ],
    skipped: 0,
  });
});

// A `%` inside a quoted attribute is matched and converted.
void test("A % inside a quoted attribute is matched and converted.", async (t) => {
  t.check(plan("_content/Notes/d.doc.card", "---\ntitle: Note\n---\nSee {% image ref=\"attach/a%20b.image.card\" /%} ok.\n"), {
    after: "---\ntitle: Note\n---\nSee [a%20b](attach/a%20b.image.card) ok.\n",
    failures: [],
    skipped: 0,
  });
});

// A retired tag quoted in a code span cannot be told from the real tag by its
// source text, so a card holding one is left to a person, even when the real
// tag differs.
void test("A retired tag quoted in a code span cannot be told from the real tag by its s...", async (t) => {
  t.check(plan("_content/Notes/d2.doc.card", "---\ntitle: Note\n---\nWrite `{% image ref=\"x\" /%}` then {% image ref=\"attach/a.image.card\" /%} ok.\n"), {
    after: undefined,
    failures: [
      {
        path: "_content/Notes/d2.doc.card",
        line: 4,
        reason: "a retired tag is quoted in a code span in this card; rewrite the card by hand",
      },
    ],
    skipped: 0,
  });
});

// A ref that cannot be written as a markdown link fails (space in the stem):
void test("A ref that cannot be written as a markdown link fails (space in the stem):", async (t) => {
  t.check(plan("_content/Notes/e.doc.card", "---\ntitle: Note\n---\n{% image ref=\"attach/cover 2.image.card\" /%}\n"), {
    after: undefined,
    failures: [
      {
        path: "_content/Notes/e.doc.card",
        line: 4,
        reason: "the image ref \"attach/cover 2.image.card\" cannot be written as a markdown link (whitespace or one of ] ( ) < >); rename the card or link it by hand",
      },
    ],
    skipped: 0,
  });
});

// A non-string `test` fails instead of being dropped:
void test("A non-string test fails instead of being dropped:", async (t) => {
  t.check(plan(ROOT, briefing("{% correction test=42 %}\nFix.\n{% /correction %}\n")), {
    after: undefined,
    failures: [
      {
        path: "_content/briefing.briefing.card",
        line: 4,
        reason: "{% correction %} test must be a quoted string; fix it by hand",
      },
    ],
    skipped: 0,
  });
});

// An existing `purpose: null` is set in place; key order is kept.
void test("An existing purpose:", async (t) => {
  t.check(plan(ROOT, briefing("{% purpose %}\nA\n{% /purpose %}\n", "type: briefing\nother: 1\npurpose:\nlast: 2\n")), {
    after: "---\ntype: briefing\nother: 1\npurpose: A\nlast: 2\n---\n",
    failures: [],
    skipped: 0,
  });
});

// A comment on that null described the absence, so it does not follow the value.
void test("A comment on that null described the absence, so it does not follow the value.", async (t) => {
  t.check(plan(ROOT, briefing("{% purpose %}\nA\n{% /purpose %}\n", "type: briefing\npurpose: # deliberately unset\nlast: 2\n")), {
    after: "---\ntype: briefing\npurpose: A\nlast: 2\n---\n",
    failures: [],
    skipped: 0,
  });
});

// An interrupted stock-seed apply (seed written, ledger still on the old hash)
// is reconciled by the next `--apply`.
void test("An interrupted stock-seed apply (seed written, ledger still on the old hash)...", async (t) => {
  const { createBriefingTemplate } = await import("../../../src/schemas/briefing.js");
  const { TEMPLATE_STOCK_HASHES } = await import("../../../src/core/template-stock-hashes.js");
  const { readVersions, writeVersions } = await import("../../../src/core/install-template-file.js");
  const OLD = "---\ntype: briefing\nopeners:\n  - Let me tell you what this box is for.\n  - What can you do?\n---\n{% purpose %}\nWhat this box is for.\n{% /purpose %}\n";
  const box = await makeTmpBox();
  const seed = createBriefingTemplate();
  await box.write(ROOT, seed);
  await writeVersions(box.root, { [ROOT]: { sha256: sha(OLD), "installed-at": "2026-09-01T00:00:00.000Z", stock: OLD } });
  const run = await runBodyTags({ boxRoot: box.root, mode: "apply" });
  t.check(run.code, 0);
  t.check(TEMPLATE_STOCK_HASHES["briefing-seed"].superseded, containing([sha(OLD)]));
  t.check((await readVersions(box.root))[ROOT]?.sha256, sha(seed));
  t.check(await box.read(ROOT), seed);
});
