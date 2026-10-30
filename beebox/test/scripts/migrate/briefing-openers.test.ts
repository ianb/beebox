// # Migration: briefing openers move to the landmark
//
// `briefing-openers-2026-10` moves `openers:` from briefing cards to the place's
// landmark (`navigation.openers`), where the chat now reads them
// (docs/implemented-plans/landmark-arrival.md, Track B). It fails closed: when it cannot
// move a list without a person's choice, it names the path, writes nothing, and
// exits 1, so `bbx engine migrate` records no manifest entry. A warning would let
// the run record itself as applied with openers stranded on a briefing that
// nothing reads any more.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { containing } from "@ianbicking/tap-check/check";
import { createHash } from "node:crypto";
import { planOpenerMoves } from "../../../src/scripts/migrate/briefing-openers/plan.js";
import { runBriefingOpeners } from "../../../src/scripts/migrate/briefing-openers/run.js";
import { createBriefingTemplate } from "../../../src/schemas/briefing.js";
import { createLandmarkTemplate } from "../../../src/schemas/landmark.js";
import { TEMPLATE_STOCK_HASHES } from "../../../src/core/template-stock-hashes.js";
import { installBriefing } from "../../../src/core/box/structure/defaults.js";
import { readVersions, writeVersions } from "../../../src/core/install-template-file.js";
import { parseLandmarkFields } from "../../../src/schemas/landmark.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** The "Reaching me" section as that seed carried it, before its agent commands were dropped. */
const OLD_REACHING_ME = `## Reaching me

Tell me, quietly, when something failed or you could not understand what I
gave you. Do not tell me that routine work succeeded. A question for me is a
dot unless it blocks something with a date. Things I asked to be told about
are loud. Health problems stay on the dashboard unless they stop something I
asked for. When I ask for a reminder, make a schedule card with \`notify:\`.
When I ask to be told when something happens, make a schedule card that runs
\`bbx changes\` and \`bbx judge\` before any agent.`;
/** The briefing seed new boxes got before this change, openers included. */
const OLD_SEED = `---\ntype: briefing\nopeners:\n  - Let me tell you what this box is for.\n  - What can you do?\n---\n{% purpose %}\nWhat this box is for.\n{% /purpose %}\n\n${OLD_REACHING_ME}\n`;
/** The root landmark as `installRootLandmark` wrote it before this change: no openers. */
const OLD_ROOT_LANDMARK = createLandmarkTemplate({ label: "kitchen", symbol: "📦" });
const ROOT = "_content/briefing.briefing.card";
const ROOT_LM = "_content/Box.landmark.card";
const briefing = (openers: string) => `---\ntype: briefing\n${openers}---\n{% purpose %}\nCook.\n{% /purpose %}\n`;
const landmark = (extra?: string) => `---\nnavigation:\n  label: Lending\n${extra ?? ""}---\n`;

/** Plan one briefing beside one (or no) landmark; show writes as path → text. */
function plan(input: { path?: string; text: string; landmark?: { path: string; text: string } | null }) {
  const result = planOpenerMoves({ rootLabel: "kitchen", briefings: [{ path: input.path ?? "_content/lending/briefing.briefing.card", text: input.text,
    landmark: input.landmark === undefined ? null : input.landmark }] });
  return { writes: Object.fromEntries(result.writes.map((w) => [w.path, w.after])), outcomes: result.outcomes.map((o) => o.outcome), failures: result.failures };
}
const openersOf = (text: string | undefined) => (text === undefined ? undefined : parseLandmarkFields(text)?.navigation?.openers);

// ## Stock seeds are recognized by hash
//
// The seed a box got before this change, and the seed it gets now, are both
// `briefing-seed` hashes. Template sync may have replaced the old seed with the new
// one before the migration runs, so both count as an untouched stock briefing.
void test("The seed a box got before this change, and the seed it gets now, are both bri...", async (t) => {
  t.check(TEMPLATE_STOCK_HASHES["briefing-seed"].superseded, containing([sha(OLD_SEED)]));
  t.check(TEMPLATE_STOCK_HASHES["briefing-seed"].current, sha(createBriefingTemplate()));
});

// ## Case 1: an untouched stock briefing gives the root landmark the stock openers
//
// The old seed becomes the current seed, and the root landmark gets the stock
// onboarding opener, which is what a new box gets.
void test("The old seed becomes the current seed, and the root landmark gets the stock onb...", async (t) => {
  const r = plan({ path: ROOT, text: OLD_SEED, landmark: { path: ROOT_LM, text: OLD_ROOT_LANDMARK } });
  t.check(r, {
    writes: {
      [ROOT]: createBriefingTemplate(),
      [ROOT_LM]: `---
navigation:
  label: kitchen
  openers:
    - Tell me about talking instead of typing.
symbol:
  glyph: 📦
---
`,
    },
    outcomes: [
      "stock",
    ],
    failures: [],
  });
});

// The new seed (template sync ran first) lands in the same place: the briefing is
// left alone and the landmark still gets the stock openers.
void test("The new seed (template sync ran first) lands in the same place:", async (t) => {
  const r = plan({ path: ROOT, text: createBriefingTemplate(), landmark: { path: ROOT_LM, text: OLD_ROOT_LANDMARK } });
  t.check(r, {
    writes: {
      "_content/Box.landmark.card": `---
navigation:
  label: kitchen
  openers:
    - Tell me about talking instead of typing.
symbol:
  glyph: 📦
---
`,
    },
    outcomes: [
      "stock",
    ],
    failures: [],
  });
});

// A root landmark that already has an `openers` key, even `[]`, keeps it: the
// agent may have turned the onboarding openers off.
void test("A root landmark that already has an openers key, even [], keeps it:", async (t) => {
  t.check(plan({ path: ROOT, text: OLD_SEED, landmark: { path: ROOT_LM, text: landmark("  openers: []\n") } }), {
    writes: {
      [ROOT]: createBriefingTemplate(),
    },
    outcomes: [
      "stock",
    ],
    failures: [],
  });
});

// ## Case 2: a briefing with no openers is left alone
void test("Case 2: a briefing with no openers is left alone", async (t) => {
  t.check(plan({ text: briefing(""), landmark: { path: "_content/lending/Lending.landmark.card", text: landmark() } }), {
    writes: {},
    outcomes: [
      "already",
    ],
    failures: [],
  });
});

// ## Case 3: the list moves to the landmark beside the briefing
//
// The edit is surgical: the landmark's other keys keep their place, and the
// briefing keeps its body.
void test("The edit is surgical:", async (t) => {
  const LM = "_content/lending/Lending.landmark.card";
  const r = plan({ text: briefing("openers:\n  - Who has what right now?\n"),
    landmark: { path: LM, text: "---\nsymbol:\n  glyph: 🤝\nnavigation:\n  label: Lending\n  expand:\n    - query: \"*.loan.card\"\n---\n" } });
  t.check(r.writes, {
    "_content/lending/Lending.landmark.card": `---
symbol:
  glyph: 🤝
navigation:
  label: Lending
  expand:
    - query: "*.loan.card"
  openers:
    - Who has what right now?
---
`,
    "_content/lending/briefing.briefing.card": `---
type: briefing
---
{% purpose %}
Cook.
{% /purpose %}
`,
  });
});

// A landmark with only `destinations` gains a `navigation` block.
void test("A landmark with only destinations gains a navigation block.", async (t) => {
  const r = plan({ text: briefing("openers:\n  - File it\n"),
    landmark: { path: "_content/lending/Lending.landmark.card", text: "---\ndestinations:\n  - for: [triage]\n---\n" } });
  t.check(r, {
    writes: {
      "_content/lending/Lending.landmark.card": `---
destinations:
  - for: [triage]
navigation:
  openers:
    - File it
---
`,
      "_content/lending/briefing.briefing.card": briefing(""),
    },
    outcomes: [
      "converted",
    ],
    failures: [],
  });
});

// A landmark's body, the place summary, survives the frontmatter rewrite.
void test("A landmark's body, the place summary, survives the frontmatter rewrite.", async (t) => {
  const r = plan({ text: briefing("openers:\n  - Log a loan\n"),
    landmark: { path: "_content/lending/Lending.landmark.card", text: landmark() + "The stove is with Idris.\n" } });
  t.check(r, {
    writes: {
      "_content/lending/Lending.landmark.card": `---
navigation:
  label: Lending
  openers:
    - Log a loan
---
The stove is with Idris.
`,
      "_content/lending/briefing.briefing.card": briefing(""),
    },
    outcomes: [
      "converted",
    ],
    failures: [],
  });
});

// ## Case 4: the landmark's list is authoritative
//
// An equal list (after trimming) only leaves the briefing.
void test("An equal list (after trimming) only leaves the briefing.", async (t) => {
  const r = plan({ text: briefing("openers:\n  - \" Who has what? \"\n"),
    landmark: { path: "_content/lending/Lending.landmark.card", text: landmark("  openers:\n    - Who has what?\n") } });
  t.check(r, {
    writes: {
      "_content/lending/briefing.briefing.card": briefing(""),
    },
    outcomes: [
      "converted",
    ],
    failures: [],
  });
});

// A different list is never appended or overridden. It is a conflict, whether
// the landmark lists other openers or `[]`.
void test("A different list is never appended or overridden.", async (t) => {
  const LM = "_content/lending/Lending.landmark.card";
  const differ = plan({ text: briefing("openers:\n  - Who has what?\n"), landmark: { path: LM, text: landmark("  openers:\n    - Log a loan\n") } });
  const empty = plan({ text: briefing("openers:\n  - Who has what?\n"), landmark: { path: LM, text: landmark("  openers: []\n") } });
  t.check(differ, {
    writes: {},
    outcomes: [],
    failures: [
      {
        kind: "conflict",
        path: "_content/lending/briefing.briefing.card",
        message: "_content/lending/briefing.briefing.card: openers differ from _content/lending/Lending.landmark.card navigation.openers; resolve by hand",
      },
    ],
  });
  t.check(empty, {
    writes: {},
    outcomes: [],
    failures: [
      {
        kind: "conflict",
        path: "_content/lending/briefing.briefing.card",
        message: "_content/lending/briefing.briefing.card: openers differ from _content/lending/Lending.landmark.card navigation.openers; resolve by hand",
      },
    ],
  });
});

// ## Case 5: a root briefing with no root landmark creates one
void test("Case 5: a root briefing with no root landmark creates one", async (t) => {
  const r = plan({ path: ROOT, text: briefing("openers:\n  - What's for dinner?\n") });
  t.check(r, {
    writes: {
      "_content/Box.landmark.card": `---
navigation:
  label: kitchen
  openers:
    - What's for dinner?
symbol:
  glyph: 📦
---
`,
      "_content/briefing.briefing.card": briefing(""),
    },
    outcomes: [
      "converted",
    ],
    failures: [],
  });
});

// ## Case 6: openers with no place to go fail
//
// A non-root briefing whose directory has no landmark: creating a place would add
// it to every menu, and moving the list to an ancestor would change which place
// shows it. A person decides.
void test("A non-root briefing whose directory has no landmark:", async (t) => {
  t.check(plan({ path: "_content/old/briefing.briefing.card", text: briefing("openers:\n  - Hello\n") }), {
    writes: {},
    outcomes: [],
    failures: [
      {
        kind: "no-place",
        path: "_content/old/briefing.briefing.card",
        message: "_content/old/briefing.briefing.card: openers have no landmark in this directory; add a landmark here or move them by hand",
      },
    ],
  });
});

// An empty list has nothing to move, so it is simply removed, even with no landmark.
void test("An empty list has nothing to move, so it is simply removed, even with no land...", async (t) => {
  t.check(plan({ path: "_content/old/briefing.briefing.card", text: briefing("openers: []\n") }), {
    writes: {
      "_content/old/briefing.briefing.card": briefing(""),
    },
    outcomes: [
      "converted",
    ],
    failures: [],
  });
});

// A value that is not a list of strings is `malformed`.
void test("A value that is not a list of strings is malformed.", async (t) => {
  t.check(plan({ text: briefing("openers: hello\n"), landmark: { path: "_content/lending/Lending.landmark.card", text: landmark() } }), {
    writes: {},
    outcomes: [],
    failures: [
      {
        kind: "malformed",
        path: "_content/lending/briefing.briefing.card",
        message: "_content/lending/briefing.briefing.card: openers is not a list of strings; resolve by hand",
      },
    ],
  });
});

// A list of strings that the landmark schema would reject is `malformed` too: a
// blank opener, or one over 120 characters, would make the landmark fail to load,
// and the place would lose its links along with its openers. The briefing keeps
// its list until a person fixes it.
void test("A list of strings that the landmark schema would reject is malformed too:", async (t) => {
  const LM = "_content/lending/Lending.landmark.card";
  const blank = plan({ text: briefing("openers:\n  - \"  \"\n"), landmark: { path: LM, text: landmark() } });
  const long = plan({ text: briefing(`openers:\n  - ${"x".repeat(121)}\n`), landmark: { path: LM, text: landmark() } });
  t.check(blank, {
    writes: {
      "_content/lending/Lending.landmark.card": `---
navigation:
  label: Lending
  openers:
    - "  "
---
`,
      "_content/lending/briefing.briefing.card": briefing(""),
    },
    outcomes: [
      "converted",
    ],
    failures: [
      {
        kind: "malformed",
        path: "_content/lending/Lending.landmark.card",
        message: "_content/lending/Lending.landmark.card: navigation.openers[0]: an opener must not be blank; resolve by hand",
      },
    ],
  });
  t.check(long, {
    writes: {
      "_content/lending/Lending.landmark.card": `---
navigation:
  label: Lending
  openers:
    - ${"x".repeat(121)}
---
`,
      "_content/lending/briefing.briefing.card": briefing(""),
    },
    outcomes: [
      "converted",
    ],
    failures: [
      {
        kind: "malformed",
        path: "_content/lending/Lending.landmark.card",
        message: "_content/lending/Lending.landmark.card: navigation.openers[0]: an opener must be at most 120 characters; resolve by hand",
      },
    ],
  });
});

// The same holds for a root landmark the plan would create.
void test("The same holds for a root landmark the plan would create.", async (t) => {
  t.check(plan({ path: ROOT, text: briefing("openers:\n  - \"  \"\n") }), {
    writes: {
      "_content/Box.landmark.card": `---
navigation:
  label: kitchen
  openers:
    - "  "
symbol:
  glyph: 📦
---
`,
      "_content/briefing.briefing.card": briefing(""),
    },
    outcomes: [
      "converted",
    ],
    failures: [
      {
        kind: "malformed",
        path: "_content/Box.landmark.card",
        message: "_content/Box.landmark.card: navigation.openers[0]: an opener must not be blank; resolve by hand",
      },
    ],
  });
});

// ## End to end, in both template-sync orders
//
// (i) The migrator on an old box: the old stock seed, tracked by the template
// ledger, beside a root landmark with no openers.
void test("(i) The migrator on an old box:", async (t) => {
  const box = await makeTmpBox();
  await box.write(ROOT, OLD_SEED);
  await box.write(ROOT_LM, OLD_ROOT_LANDMARK);
  await writeVersions(box.root, { [ROOT]: { sha256: sha(OLD_SEED), "installed-at": "2026-09-01T00:00:00.000Z", stock: OLD_SEED } });
  t.check(await runBriefingOpeners({ boxRoot: box.root, mode: "apply" }), {
    code: 0,
    lines: [
      "write _content/briefing.briefing.card",
      "write _content/Box.landmark.card",
      "briefing-openers: moved 0, stock 1, already 0, files 2.",
    ],
  });
  t.check(openersOf(await box.read(ROOT_LM)), ["Tell me about talking instead of typing."]);
  t.check(await box.read(ROOT), createBriefingTemplate());
  t.check((await readVersions(box.root))[ROOT]?.sha256, TEMPLATE_STOCK_HASHES["briefing-seed"].current);

  // A second run plans nothing and verifies clean.

  t.check((await runBriefingOpeners({ boxRoot: box.root, mode: "apply" })).lines, [
    "briefing-openers: moved 0, stock 1, already 0, files 0.",
  ]);
});

// (ii) Template sync first: `installBriefing` replaces the old seed (dropping its
// openers) before the migrator runs. The root landmark still gets them.
void test("(ii) Template sync first:", async (t) => {
  const box = await makeTmpBox();
  await box.write(ROOT, OLD_SEED);
  await box.write(ROOT_LM, OLD_ROOT_LANDMARK);
  await writeVersions(box.root, { [ROOT]: { sha256: sha(OLD_SEED), "installed-at": "2026-09-01T00:00:00.000Z", stock: OLD_SEED } });
  await installBriefing(box.root);
  t.check(await box.read(ROOT), createBriefingTemplate());
  t.check(await runBriefingOpeners({ boxRoot: box.root, mode: "apply" }), {
    code: 0,
    lines: [
      "write _content/Box.landmark.card",
      "briefing-openers: moved 0, stock 1, already 0, files 1.",
    ],
  });
  t.check(openersOf(await box.read(ROOT_LM)), ["Tell me about talking instead of typing."]);
  t.check((await readVersions(box.root))[ROOT]?.sha256, TEMPLATE_STOCK_HASHES["briefing-seed"].current);
});

// (iii) A conflict anywhere in the box exits 1 and writes nothing, not even the
// moves that had no conflict.
void test("(iii) A conflict anywhere in the box exits 1 and writes nothing, not even the...", async (t) => {
  const box = await makeTmpBox();
  await box.write(ROOT, OLD_SEED);
  await box.write(ROOT_LM, OLD_ROOT_LANDMARK);
  await box.write("_content/lending/briefing.briefing.card", briefing("openers:\n  - Who has what?\n"));
  await box.write("_content/lending/Lending.landmark.card", landmark("  openers:\n    - Log a loan\n"));
  const run = await runBriefingOpeners({ boxRoot: box.root, mode: "apply" });
  t.check(run, {
    code: 1,
    lines: [
      "failed (conflict): _content/lending/briefing.briefing.card: openers differ from _content/lending/Lending.landmark.card navigation.openers; resolve by hand",
      "briefing-openers: 1 failure(s); nothing written.",
    ],
  });
  t.check([await box.read(ROOT), await box.read(ROOT_LM)], [OLD_SEED, OLD_ROOT_LANDMARK]);
});

// A landmark that would not load fails the box the same way: exit 1, nothing
// written, so `bbx engine migrate` records no manifest entry.
void test("A landmark that would not load fails the box the same way:", async (t) => {
  const box = await makeTmpBox();
  const BR = "_content/lending/briefing.briefing.card";
  const LM = "_content/lending/Lending.landmark.card";
  await box.write(BR, briefing("openers:\n  - \"  \"\n"));
  await box.write(LM, landmark());
  t.check(await runBriefingOpeners({ boxRoot: box.root, mode: "apply" }), {
    code: 1,
    lines: [
      "failed (malformed): _content/lending/Lending.landmark.card: navigation.openers[0]: an opener must not be blank; resolve by hand",
      "briefing-openers: 1 failure(s); nothing written.",
    ],
  });
  t.check([await box.read(BR), await box.read(LM)], [briefing("openers:\n  - \"  \"\n"), landmark()]);
});

// (iv) `--verify` alone is the convergence check: a briefing that still carries
// `openers` exits 1 and is named.
void test("(iv) --verify alone is the convergence check:", async (t) => {
  const box = await makeTmpBox();
  await box.write("_content/lending/briefing.briefing.card", briefing("openers:\n  - Planted\n"));
  t.check(await runBriefingOpeners({ boxRoot: box.root, mode: "verify" }), {
    code: 1,
    lines: [
      "still carries openers: _content/lending/briefing.briefing.card",
      "briefing-openers: verify failed; 1 briefing(s) still carry openers.",
    ],
  });
});

// The dry run prints the plan and writes nothing.
void test("The dry run prints the plan and writes nothing.", async (t) => {
  const box = await makeTmpBox();
  await box.write(ROOT, OLD_SEED);
  await box.write(ROOT_LM, OLD_ROOT_LANDMARK);
  const run = await runBriefingOpeners({ boxRoot: box.root, mode: "plan" });
  t.check(run.lines, [
    "write _content/briefing.briefing.card (dry run; pass --apply)",
    "write _content/Box.landmark.card (dry run; pass --apply)",
    "briefing-openers: moved 0, stock 1, already 0, files 2.",
  ]);
  t.check(await box.read(ROOT), OLD_SEED);
});
