// # Box layout spec: single source for BOX_DIRS, the agent guide, and the docs
//
// `BOX_LAYOUT` (`src/lib/paths/box-layout-spec.ts`) is the one place the box
// directory list, its paths, and its prose live. `BOX_DIRS` (`paths.ts`) and the
// in-box agent guide's directory table (`agent-guide/box-shape.ts`) both derive
// from it; this doctest checks the derivation, plus that `docs/box-layout.md`'s
// hand-written tables haven't drifted from the spec's text — a stand-in for
// regenerating the doc in place, since (unlike the generated agent docs, which are
// whole-file generated) `docs/box-layout.md` mixes prose with tables.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { instanceOf } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import { BOX_LAYOUT } from "../../../src/lib/paths/box-layout-spec.js";
import { BOX_ROOT_VOCABULARY } from "../../../src/shared/box-root-vocabulary.js";
import { BOX_DIRS, boxLayoutEntry, UnknownBoxDirsKeyError } from "../../../src/lib/paths/core.js";
import { directoryLayoutRows } from "../../../src/core/agent-guide/guide/box-shape.js";

const keyedEntries = BOX_LAYOUT.filter((entry) => "boxDirsKey" in entry);
const boxLayoutDoc = await fs.readFile(new URL("../../../docs/box-layout.md", import.meta.url), "utf-8");

// ## Every `BOX_DIRS` key/value comes from a spec entry, and vice versa
void test("Every `BOX_DIRS` key/value comes from a spec entry, and vice versa", async (t) => {
  const boxDirsFromSpec = Object.fromEntries(keyedEntries.map((entry) => [entry.boxDirsKey, entry.path]));
  t.check(boxDirsFromSpec, BOX_DIRS);

  // Same key count both ways — no spec entry silently dropped, no BOX_DIRS key the spec doesn't know about.
  const specKeys: string[] = keyedEntries.map((entry) => entry.boxDirsKey);
  t.check(specKeys.toSorted(), Object.keys(BOX_DIRS).toSorted());
});

// ## Every spec'd path lives under an underscore area (or is code/agent-config)
void test("Every spec'd path lives under an underscore area (or is code/agent-config)", async (t) => {
  const areasNeedingUnderscore = new Set(["content", "config", "bookkeeping", "publish", "tmp"]);
  const wronglyRooted = keyedEntries.filter(
    (entry) => areasNeedingUnderscore.has(entry.area) && !entry.path.startsWith("_")
  );
  t.check(wronglyRooted, []);
});

// ## `boxLayoutEntry` rejects an unknown key
//
// An unrecognized key throws a typed error rather than returning `undefined` silently:
void test("An unrecognized key throws a typed error rather than returning undefined sile...", async (t) => {
  // The key parameter is a closed union; Reflect.apply passes a key outside it to reach the runtime guard.
  await t.checkThrows(
    () => Reflect.apply(boxLayoutEntry, undefined, ["not-a-real-key"]),
    "UnknownBoxDirsKeyError: No box-layout-spec entry for BOX_DIRS key \"not-a-real-key\".",
  );
  let caught: unknown;
  try { Reflect.apply(boxLayoutEntry, undefined, ["not-a-real-key"]); } catch (e) { caught = e; }
  t.check(caught, instanceOf(UnknownBoxDirsKeyError));
});

// ## `BOX_ROOT_VOCABULARY` covers every underscore area `BOX_LAYOUT` uses
void test("`BOX_ROOT_VOCABULARY` covers every underscore area `BOX_LAYOUT` uses", async (t) => {
  const rootAreaNames = new Set<string>(keyedEntries.map((entry) => entry.path.split("/")[0] ?? "").filter((seg) => seg.startsWith("_")));
  const vocabAreaNames = new Set<string>(BOX_ROOT_VOCABULARY.filter((e) => e.kind === "area").map((e) => e.name));
  t.check([...rootAreaNames].filter((name) => !vocabAreaNames.has(name)), []);
});

// ## The agent guide's archive row is a rollup
//
// `directoryLayoutRows` looks up each row by `BOX_DIRS` key. The
// `_bookkeeping/archive/*` row is the exception: a hand-written summary, not a
// spec entry - box-shape.ts owns collapsing the three archive entries into one row.
void test("directoryLayoutRows looks up each row by BOXDIRS key.", async (t) => {
  t.checkText(directoryLayoutRows(), "«*»| `_bookkeeping/archive/` | Processed/completed items |«*»");
});

// ## `docs/box-layout.md`'s tables carry the same path + description text as the spec
//
// Every keyed entry that has a developer-facing row in the doc's `content/`,
// `bookkeeping/`, `config`, `publish`, `tmp`, or `tricks` tables must render the
// exact `` `<path>/` | <description> `` text the spec declares — if someone
// edits a description in `box-layout-spec.ts` (or renames/adds a directory)
// without updating the doc, this fails.
//
// `config` and `.claude` themselves are section headers in the doc (not table
// rows — only their sub-paths get rows), so they're excluded here:
void test("Every keyed entry that has a developer-facing row in the doc's content/, book...", async (t) => {
  const docRelevantAreas = new Set(["content", "bookkeeping", "config", "publish", "tmp", "tricks", "agent-config"]);
  const sectionHeaderKeys = new Set(["config", "claude"]);
  const docEntries = keyedEntries.filter(
    (entry) => docRelevantAreas.has(entry.area) && !sectionHeaderKeys.has(entry.boxDirsKey)
  );
  const missingFromDoc = docEntries
    .map((entry) => `\`${entry.path}/\` | ${entry.description}`)
    .filter((row) => !boxLayoutDoc.includes(row));
  t.check(missingFromDoc, []);
});
