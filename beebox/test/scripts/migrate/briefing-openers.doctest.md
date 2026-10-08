# Migration: briefing openers move to the landmark

`briefing-openers-2026-10` moves `openers:` from briefing cards to the place's
landmark (`navigation.openers`), where the chat now reads them
(docs/plans/landmark-arrival.md, Track B). It fails closed: when it cannot
move a list without a person's choice, it names the path, writes nothing, and
exits 1, so `bbx engine migrate` records no manifest entry. A warning would let
the run record itself as applied with openers stranded on a briefing that
nothing reads any more.

```ts setup
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { planOpenerMoves } from "../../../src/scripts/migrate/briefing-openers/plan.js";
import { runBriefingOpeners } from "../../../src/scripts/migrate/briefing-openers/run.js";
import { createBriefingTemplate, REACHING_ME_DEFAULT } from "../../../src/schemas/briefing.js";
import { createLandmarkTemplate } from "../../../src/schemas/landmark.js";
import { TEMPLATE_STOCK_HASHES } from "../../../src/core/template-stock-hashes.js";
import { installBriefing } from "../../../src/core/box/structure/defaults.js";
import { readVersions, writeVersions } from "../../../src/core/install-template-file.js";
import { parseLandmarkFields } from "../../../src/schemas/landmark.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** The briefing seed new boxes got before this change, openers included. */
const OLD_SEED = `---\ntype: briefing\nopeners:\n  - Let me tell you what this box is for.\n  - What can you do?\n---\n{% purpose %}\nWhat this box is for.\n{% /purpose %}\n\n${REACHING_ME_DEFAULT}\n`;
/** The root landmark as `installRootLandmark` wrote it before this change: no openers. */
const OLD_ROOT_LANDMARK = createLandmarkTemplate({ label: "kitchen", symbol: "📦" });
const ROOT = "_content/briefing.briefing.card";
const ROOT_LM = "_content/Box.landmark.card";
const briefing = (openers: string) => `---\ntype: briefing\n${openers}---\n{% purpose %}\nCook.\n{% /purpose %}\n`;
const landmark = (extra = "") => `---\nnavigation:\n  label: Lending\n${extra}---\n`;

/** Plan one briefing beside one (or no) landmark; show writes as path → text. */
function plan(input: { path?: string; text: string; landmark?: { path: string; text: string } | null }) {
  const result = planOpenerMoves({ rootLabel: "kitchen", briefings: [{ path: input.path ?? "_content/lending/briefing.briefing.card", text: input.text,
    landmark: input.landmark === undefined ? null : input.landmark }] });
  return { writes: Object.fromEntries(result.writes.map((w) => [w.path, w.after])), outcomes: result.outcomes.map((o) => o.outcome), failures: result.failures };
}
const openersOf = (text: string) => parseLandmarkFields(text)?.navigation?.openers;
```

## Stock seeds are recognized by hash

The seed a box got before this change, and the seed it gets now, are both
`briefing-seed` hashes. Template sync may have replaced the old seed with the new
one before the migration runs, so both count as an untouched stock briefing.

```ts
({ old: TEMPLATE_STOCK_HASHES["briefing-seed"].superseded.includes(sha(OLD_SEED)),
  current: TEMPLATE_STOCK_HASHES["briefing-seed"].current === sha(createBriefingTemplate()) })
=> { old: true, current: true }
```

## Case 1: an untouched stock briefing gives the root landmark the stock openers

The old seed becomes the current seed, and the root landmark gets the two
onboarding openers, which is what a new box gets.

```ts
const r = plan({ path: ROOT, text: OLD_SEED, landmark: { path: ROOT_LM, text: OLD_ROOT_LANDMARK } });
({ briefingIsSeed: r.writes[ROOT] === createBriefingTemplate(), openers: openersOf(r.writes[ROOT_LM]), outcomes: r.outcomes })
=> { briefingIsSeed: true, openers: ["Let me tell you what this box is for.", "What can you do?"], outcomes: ["stock"] }
```

The new seed (template sync ran first) lands in the same place: the briefing is
left alone and the landmark still gets the stock openers.

```ts
const r = plan({ path: ROOT, text: createBriefingTemplate(), landmark: { path: ROOT_LM, text: OLD_ROOT_LANDMARK } });
({ files: Object.keys(r.writes), openers: openersOf(r.writes[ROOT_LM]) })
=> { files: ["_content/Box.landmark.card"], openers: ["Let me tell you what this box is for.", "What can you do?"] }
```

A root landmark that already has an `openers` key, even `[]`, keeps it: the
agent may have turned the onboarding openers off.

```ts
plan({ path: ROOT, text: OLD_SEED, landmark: { path: ROOT_LM, text: landmark("  openers: []\n") } }).writes[ROOT_LM]
=> undefined
```

## Case 2: a briefing with no openers is left alone

```ts
plan({ text: briefing(""), landmark: { path: "_content/lending/Lending.landmark.card", text: landmark() } })
=> { writes: {}, outcomes: ["already"], failures: [] }
```

## Case 3: the list moves to the landmark beside the briefing

The edit is surgical: the landmark's other keys keep their place, and the
briefing keeps its body.

```ts
const LM = "_content/lending/Lending.landmark.card";
const r = plan({ text: briefing("openers:\n  - Who has what right now?\n"),
  landmark: { path: LM, text: "---\nsymbol:\n  glyph: 🤝\nnavigation:\n  label: Lending\n  expand:\n    - query: \"*.loan.card\"\n---\n" } });
r.writes
=> { "_content/lending/Lending.landmark.card": "---\nsymbol:\n  glyph: 🤝\nnavigation:\n  label: Lending\n  expand:\n    - query: \"*.loan.card\"\n  openers:\n    - Who has what right now?\n---\n", "_content/lending/briefing.briefing.card": "---\ntype: briefing\n---\n{% purpose %}\nCook.\n{% /purpose %}\n" }
```

A landmark with only `destinations` gains a `navigation` block.

```ts
const r = plan({ text: briefing("openers:\n  - File it\n"),
  landmark: { path: "_content/lending/Lending.landmark.card", text: "---\ndestinations:\n  - for: [triage]\n---\n" } });
r.writes["_content/lending/Lending.landmark.card"]
=> ---
destinations:
  - for: [triage]
navigation:
  openers:
    - File it
---
```

## Case 4: the landmark's list is authoritative

An equal list (after trimming) only leaves the briefing.

```ts
const r = plan({ text: briefing("openers:\n  - \" Who has what? \"\n"),
  landmark: { path: "_content/lending/Lending.landmark.card", text: landmark("  openers:\n    - Who has what?\n") } });
({ files: Object.keys(r.writes), outcomes: r.outcomes })
=> { files: ["_content/lending/briefing.briefing.card"], outcomes: ["converted"] }
```

A different list is never appended or overridden. It is a conflict, whether
the landmark lists other openers or `[]`.

```ts
const LM = "_content/lending/Lending.landmark.card";
const differ = plan({ text: briefing("openers:\n  - Who has what?\n"), landmark: { path: LM, text: landmark("  openers:\n    - Log a loan\n") } });
const empty = plan({ text: briefing("openers:\n  - Who has what?\n"), landmark: { path: LM, text: landmark("  openers: []\n") } });
({ differ: differ.failures, empty: empty.failures.map((f) => f.kind) })
=> { differ: [{ kind: "conflict", path: "_content/lending/briefing.briefing.card", message: "_content/lending/briefing.briefing.card: openers differ from _content/lending/Lending.landmark.card navigation.openers; resolve by hand" }], empty: ["conflict"] }
```

## Case 5: a root briefing with no root landmark creates one

```ts
const r = plan({ path: ROOT, text: briefing("openers:\n  - What's for dinner?\n") });
r.writes[ROOT_LM]
=> ---
navigation:
  label: kitchen
  openers:
    - What's for dinner?
symbol:
  glyph: 📦
---
```

## Case 6: openers with no place to go fail

A non-root briefing whose directory has no landmark: creating a place would add
it to every menu, and moving the list to an ancestor would change which place
shows it. A person decides.

```ts
plan({ path: "_content/old/briefing.briefing.card", text: briefing("openers:\n  - Hello\n") }).failures
=> [{ kind: "no-place", path: "_content/old/briefing.briefing.card", message: "_content/old/briefing.briefing.card: openers have no landmark in this directory; add a landmark here or move them by hand" }]
```

An empty list has nothing to move, so it is simply removed, even with no landmark.

```ts
plan({ path: "_content/old/briefing.briefing.card", text: briefing("openers: []\n") }).outcomes
=> ["converted"]
```

A value that is not a list of strings is `malformed`.

```ts
plan({ text: briefing("openers: hello\n"), landmark: { path: "_content/lending/Lending.landmark.card", text: landmark() } }).failures.map((f) => f.kind)
=> ["malformed"]
```

## End to end, in both template-sync orders

(i) The migrator on an old box: the old stock seed, tracked by the template
ledger, beside a root landmark with no openers.

```ts
const box = await makeTmpBox();
await box.write(ROOT, OLD_SEED);
await box.write(ROOT_LM, OLD_ROOT_LANDMARK);
await writeVersions(box.root, { [ROOT]: { sha256: sha(OLD_SEED), "installed-at": "2026-09-01T00:00:00.000Z", stock: OLD_SEED } });
const run = await runBriefingOpeners({ boxRoot: box.root, mode: "apply" });
({ code: run.code, openers: openersOf(await box.read(ROOT_LM)), seed: (await box.read(ROOT)) === createBriefingTemplate(),
  ledger: (await readVersions(box.root))[ROOT]?.sha256 === TEMPLATE_STOCK_HASHES["briefing-seed"].current })
=> { code: 0, openers: ["Let me tell you what this box is for.", "What can you do?"], seed: true, ledger: true }
```

A second run plans nothing and verifies clean.

```ts continue
(await runBriefingOpeners({ boxRoot: box.root, mode: "apply" })).lines
=> ["briefing-openers: moved 0, stock 1, already 0, files 0."]
```

(ii) Template sync first: `installBriefing` replaces the old seed (dropping its
openers) before the migrator runs. The root landmark still gets them.

```ts
const box = await makeTmpBox();
await box.write(ROOT, OLD_SEED);
await box.write(ROOT_LM, OLD_ROOT_LANDMARK);
await writeVersions(box.root, { [ROOT]: { sha256: sha(OLD_SEED), "installed-at": "2026-09-01T00:00:00.000Z", stock: OLD_SEED } });
await installBriefing(box.root);
const synced = (await box.read(ROOT)) === createBriefingTemplate();
const run = await runBriefingOpeners({ boxRoot: box.root, mode: "apply" });
({ synced, code: run.code, openers: openersOf(await box.read(ROOT_LM)),
  ledger: (await readVersions(box.root))[ROOT]?.sha256 === TEMPLATE_STOCK_HASHES["briefing-seed"].current })
=> { synced: true, code: 0, openers: ["Let me tell you what this box is for.", "What can you do?"], ledger: true }
```

(iii) A conflict anywhere in the box exits 1 and writes nothing, not even the
moves that had no conflict.

```ts
const box = await makeTmpBox();
await box.write(ROOT, OLD_SEED);
await box.write(ROOT_LM, OLD_ROOT_LANDMARK);
await box.write("_content/lending/briefing.briefing.card", briefing("openers:\n  - Who has what?\n"));
await box.write("_content/lending/Lending.landmark.card", landmark("  openers:\n    - Log a loan\n"));
const run = await runBriefingOpeners({ boxRoot: box.root, mode: "apply" });
({ code: run.code, lines: run.lines, rootUntouched: (await box.read(ROOT)) === OLD_SEED && (await box.read(ROOT_LM)) === OLD_ROOT_LANDMARK })
=> { code: 1, lines: ["failed (conflict): _content/lending/briefing.briefing.card: openers differ from _content/lending/Lending.landmark.card navigation.openers; resolve by hand", "briefing-openers: 1 failure(s); nothing written."], rootUntouched: true }
```

(iv) `--verify` alone is the convergence check: a briefing that still carries
`openers` exits 1 and is named.

```ts
const box = await makeTmpBox();
await box.write("_content/lending/briefing.briefing.card", briefing("openers:\n  - Planted\n"));
await runBriefingOpeners({ boxRoot: box.root, mode: "verify" })
=> { code: 1, lines: ["still carries openers: _content/lending/briefing.briefing.card", "briefing-openers: verify failed; 1 briefing(s) still carry openers."] }
```

The dry run prints the plan and writes nothing.

```ts
const box = await makeTmpBox();
await box.write(ROOT, OLD_SEED);
await box.write(ROOT_LM, OLD_ROOT_LANDMARK);
const run = await runBriefingOpeners({ boxRoot: box.root, mode: "plan" });
({ lines: run.lines, untouched: (await box.read(ROOT)) === OLD_SEED })
=> { lines: ["write _content/briefing.briefing.card (dry run; pass --apply)", "write _content/Box.landmark.card (dry run; pass --apply)", "briefing-openers: moved 0, stock 1, already 0, files 2."], untouched: true }
```
