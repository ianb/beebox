# Box layout spec: single source for BOX_DIRS, the agent guide, and the docs

`BOX_LAYOUT` (`src/lib/box-layout-spec.ts`) is the one place the box
directory list, its paths, and its prose live. `BOX_DIRS` (`paths.ts`) and the
in-box agent guide's directory table (`agent-guide/box-shape.ts`) both derive
from it; this doctest checks the derivation, plus that `docs/box-layout.md`'s
hand-written tables haven't drifted from the spec's text — a stand-in for
regenerating the doc in place, since (unlike `docs/generated/*.md`, which are
whole-file generated) `docs/box-layout.md` mixes prose with tables.

```ts setup
import * as fs from "node:fs/promises";
import { BOX_LAYOUT } from "../../../src/lib/box-layout-spec.js";
import { BOX_ROOT_VOCABULARY } from "../../../src/lib/box-root-vocabulary.js";
import { BOX_DIRS, boxLayoutEntry, UnknownBoxDirsKeyError } from "../../../src/lib/paths.js";
import { directoryLayoutSection } from "../../../src/core/agent-guide/box-shape.js";

const keyedEntries = BOX_LAYOUT.filter((entry) => entry.boxDirsKey !== undefined);
const boxLayoutDoc = await fs.readFile(new URL("../../../docs/box-layout.md", import.meta.url), "utf-8");
```

## Every `BOX_DIRS` key/value comes from a spec entry, and vice versa

```ts
const boxDirsFromSpec = Object.fromEntries(keyedEntries.map((entry) => [entry.boxDirsKey, entry.path]));
JSON.stringify(boxDirsFromSpec) === JSON.stringify(BOX_DIRS)
=> true

// Same key count both ways — no spec entry silently dropped, no BOX_DIRS key the spec doesn't know about.
keyedEntries.length === Object.keys(BOX_DIRS).length
=> true
```

## Every spec'd path lives under an underscore area (or is code/agent-config)

```ts
const areasNeedingUnderscore = new Set(["content", "config", "bookkeeping", "publish", "tmp"]);
const wronglyRooted = keyedEntries.filter(
  (entry) => areasNeedingUnderscore.has(entry.area) && !entry.path.startsWith("_")
);
wronglyRooted
=> []
```

## `boxLayoutEntry` looks up a keyed entry's full spec record

```ts
boxLayoutEntry("archiveDone").path
=> _bookkeeping/archive/done

boxLayoutEntry("archiveDone").area
=> bookkeeping
```

An unrecognized key throws a typed error rather than returning `undefined` silently:

```ts
let error;
try { boxLayoutEntry("not-a-real-key"); } catch (e) { error = e; };
error instanceof UnknownBoxDirsKeyError
=> true

error.message
=> No box-layout-spec entry for BOX_DIRS key "not-a-real-key".
```

## `BOX_ROOT_VOCABULARY` covers every underscore area `BOX_LAYOUT` uses

```ts
const rootAreaNames = new Set(keyedEntries.map((entry) => entry.path.split("/")[0]).filter((seg) => seg.startsWith("_")));
const vocabAreaNames = new Set(BOX_ROOT_VOCABULARY.filter((e) => e.kind === "area").map((e) => e.name));
[...rootAreaNames].every((name) => vocabAreaNames.has(name))
=> true
```

## The agent guide's directory table text comes from the same spec entries

`directoryLayoutSection` doesn't hand-list directory paths or prose anymore —
it looks up each row by `BOX_DIRS` key. Spot-check a few rows carry the
spec's exact wording:

```ts
const guide = directoryLayoutSection();
guide.includes("| `_bookkeeping/questions/` | Pending questions for the user |")
=> true

guide.includes("| `_content/reviews/retro/` | Retrospective run reports (written by `bbx retro`) |")
=> true

// The _bookkeeping/archive/* rollup: a hand-written summary row, not a spec
// entry - box-shape.ts owns collapsing the three archive entries into one row.
guide.includes("| `_bookkeeping/archive/` | Processed/completed items |")
=> true
```

## `docs/box-layout.md`'s tables carry the same path + description text as the spec

Every keyed entry that has a developer-facing row in the doc's `content/`,
`bookkeeping/`, `config`, `publish`, `tmp`, or `tricks` tables must render the
exact `` `<path>/` | <description> `` text the spec declares — if someone
edits a description in `box-layout-spec.ts` (or renames/adds a directory)
without updating the doc, this fails.

`config` and `.claude` themselves are section headers in the doc (not table
rows — only their sub-paths get rows), so they're excluded here:

```ts
const docRelevantAreas = new Set(["content", "bookkeeping", "config", "publish", "tmp", "tricks", "agent-config"]);
const sectionHeaderKeys = new Set(["config", "claude"]);
const docEntries = keyedEntries.filter(
  (entry) => docRelevantAreas.has(entry.area) && !sectionHeaderKeys.has(entry.boxDirsKey)
);
const missingFromDoc = docEntries
  .map((entry) => `\`${entry.path}/\` | ${entry.description}`)
  .filter((row) => !boxLayoutDoc.includes(row));
missingFromDoc
=> []
```
