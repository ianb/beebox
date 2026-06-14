# `cb chat whats-changed` + turn marker

The chat turn marker (`src/core/chat-turn-marker.ts`) records the git HEAD a
session was left at after each reply; `summarizeWhatsChanged`
(`src/core/chat-whats-changed.ts`) diffs `marker.head..HEAD` (committed) plus
the uncommitted working tree to tell the agent what changed since it last
spoke. The ranged git helpers it needs live in `src/cli/lib/git-range.ts`.

```ts setup
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import {
  recordTurnMarker,
  loadTurnMarker,
  recordTurnMarkerForSession,
} from "../src/core/chat-turn-marker.js";
import { summarizeWhatsChanged } from "../src/core/chat-whats-changed.js";
```

## Marker round-trip

`recordTurnMarker` writes one file per session; `loadTurnMarker` reads it back,
returning `null` for an absent or malformed marker.

```
const box = await makeTmpBox({ git: true });
recordTurnMarker(box.root, { sessionId: "sess-1", head: "deadbeef", time: "2026-06-14T00:00:00Z" });
JSON.stringify(loadTurnMarker(box.root, "sess-1"))
=> {"head":"deadbeef","time":"2026-06-14T00:00:00Z"}

loadTurnMarker(box.root, "never-recorded") === null
=> true
```

```cleanup
await box.cleanup();
```

## Report: commits since the marker, plus the uncommitted tree

After recording the marker, a later commit shows up as "since your last reply",
an earlier commit does not, and an untracked file shows in the working tree.

```
const box = await makeTmpBox({ git: true });
await box.write("store/Trip.memo.card", "first");
box.commitAll("add trip card");
// Mark this point as "my last reply".
await recordTurnMarkerForSession(box.root, "sess-1");
// Work since: one new commit, plus one new untracked file.
await box.write("store/Trip.memo.card", "first\nsecond");
box.commitAll("expand trip card");
await box.write("store/Notes.memo.card", "scratch");
const report = await summarizeWhatsChanged(box.root, { sessionId: "sess-1" });

report.includes("Commits since your last reply")
=> true

report.includes("expand trip card")
=> true

report.includes("add trip card")
=> false

report.includes("Uncommitted working tree")
=> true

report.includes("Untracked: store/Notes.memo.card")
=> true
```

Scoping to a card path narrows every section to that path: the Trip card's
commit stays, the out-of-scope Notes file drops out.

```continue
const scoped = await summarizeWhatsChanged(box.root, { sessionId: "sess-1", card: "store/Trip.memo.card" });
scoped.includes("Scope: store/Trip.memo.card")
=> true

scoped.includes("expand trip card")
=> true

scoped.includes("Notes")
=> false
```

```cleanup
await box.cleanup();
```

## Marker-absent fallback (first turn)

With no marker yet, the report falls back to the last few commits, labeled as
such, rather than claiming a precise delta.

```
const box = await makeTmpBox({ git: true });
await box.write("store/Trip.memo.card", "first");
box.commitAll("add trip card");
const report = await summarizeWhatsChanged(box.root, { sessionId: "no-marker-session" });

report.includes("No turn marker yet")
=> true

report.includes("add trip card")
=> true
```

```cleanup
await box.cleanup();
```
