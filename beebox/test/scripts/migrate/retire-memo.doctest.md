# Migration: retire the memo card type

`retire-memo-2026-10` turns every `*.memo.card` into a `*.doc.card` with the
same directory and basename (docs/plans/retire-memo.md, Track D). A recording
moves under an `audio` card in the doc's attach scope, and every mention of the
memo's filename follows the rename. It fails closed: a field it does not map,
or a recording it cannot place, names the memo, writes nothing, and exits 1.

```ts setup
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { planRetireMemo, type PlannedWrite } from "../../../src/scripts/migrate/retire-memo/plan.js";
import { runRetireMemo } from "../../../src/scripts/migrate/retire-memo/run.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

/** Plan a box given as path → text; `files` adds non-text files. */
function plan(texts: Record<string, string>, files: string[] = []) {
  return planRetireMemo({ texts: new Map(Object.entries(texts)), files: new Set([...Object.keys(texts), ...files]) });
}
/** The text a plan writes to the first path that matches; a missing write is an error. */
function after(p: ReturnType<typeof plan>, match: (w: PlannedWrite) => boolean): string {
  const write = p.writes.find(match);
  if (write === undefined) throw new Error(p.failures.length > 0 ? p.failures.join("; ") : "no such write");
  return write.after;
}
/** The text the plan writes to one path. */
function written(texts: Record<string, string>, target: string, files: string[] = []): string {
  return after(plan(texts, files), (w) => w.path === target);
}
const memo = (front: string, body = "") => `---\n${front}---\n${body}`;
/** A quick-capture voice memo whose recording sits in its attach scope. */
const voice = { "c/X.memo.card": memo("status: processed\ncreated: 2026-10-12T12:00:00Z\nsource: apple-voice-recording\ntitle: Voice note\ntranscription:\n  text: Pick up the paint\ntranscription-error:\n  permanent: false\n  message: stale\n", "[Recorded audio](attach/recording.m4a)\n") };
```

## Titles

An explicit `title:` wins. Otherwise a leading heading becomes the title and
leaves the body, since a doc does not repeat its title as a heading.

```ts
written({ "n/A.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\ntitle: Kept\n", "# Not this\nBody\n") }, "n/A.doc.card")
=>
---
title: Kept
---
# Not this
Body

written({ "n/A.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\n", "# Porch *plan*\n\nBody\n") }, "n/A.doc.card")
=>
---
title: Porch plan
---
Body
```

Without either, the first paragraph is the title, joined across its hard
wraps and cut at 80 characters. That is what the memo list showed. An empty
memo is titled from its filename.

```ts
written({ "n/A.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\n", "- Buy *cedar* boards for\n  the porch\n\nSecond.\n") }, "n/A.doc.card").split("\n")
=> ["---","title: Buy cedar boards for the porch","---","- Buy *cedar* boards for","  the porch","","Second.",""]

written({ "n/Old_Voice.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\n") }, "n/Old_Voice.doc.card")
=>
---
title: Old Voice
---
```

## Provenance

`source` becomes `via.channel`, verbatim. A page URL becomes the doc's
`sources` entry with its title as the label; clipped text goes into a
`## Clipping` section. A clip title with no URL stays in that section.
Global fields such as `todos` and `share-id` are kept.

```ts
written({ "n/A.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\nsource: telegram\nshare-id: 11111111-1111-4111-8111-111111111111\ntodos: []\ncontext:\n  url: https://example.com/a\n  title: A page\n  text: A quoted line\n", "My words\n") }, "n/A.doc.card").split("\n")
=> ["---","title: My words","todos: []","share-id: 11111111-1111-4111-8111-111111111111","via:","  channel: telegram","sources:","  - href: https://example.com/a","    label: A page","---","My words","","## Clipping","","> A quoted line",""]

written({ "n/A.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\ncontext:\n  title: A book\n  text: A quoted line\n", "Note\n") }, "n/A.doc.card").split("\n")
=> ["---","title: Note","---","Note","","## Clipping","","Clipped from “A book”:","","> A quoted line",""]
```

A field the migration does not map, top-level or nested, fails the whole run.

```ts
plan({ "n/A.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\npriority: high\ncontext:\n  author: Odette\n") }).failures
=> ["n/A.memo.card: fields this migration does not map: priority, context.author"]
```

## Transcriptions

A transcription with no recording becomes the body, or a `## Transcript`
section when the body says something else. A body that already holds the
same words, re-wrapped or with a link, gets no second copy. Its language,
time, and an error with no recording to retry are dropped and reported.

```ts
const tx = "status: new\ncreated: 2026-01-01T00:00:00Z\ntranscription:\n  text: Pick up the paint\n  language: en\n";
written({ "n/A.memo.card": memo(tx) }, "n/A.doc.card")
=>
---
title: Pick up the paint
---
Pick up the paint

written({ "n/A.memo.card": memo(tx, "Pick up\nthe [paint](x.doc.card)\n") }, "n/A.doc.card")
=>
---
title: Pick up the paint
---
Pick up
the [paint](x.doc.card)

plan({ "n/A.memo.card": memo(tx + "transcription-error:\n  permanent: true\n  message: Bad audio\n", "Other words\n") }).dropped
=> ["n/A.memo.card: transcription.language = en","n/A.memo.card: transcription-error with no recording = {\"permanent\":true,\"message\":\"Bad audio\"}"]
```

## Recordings

A quick-capture recording in the attach scope gets `recording.audio.card`
and moves into that card's own attach scope. The memo's `created` becomes
the card's `via.at`, the only place a creation time is kept; a voice capture
was recorded on a microphone. The doc links the card where it linked the file.

```ts
const p = plan(voice, ["c/X.attach/recording.m4a"]);
[p.moves, p.writes.map((w) => `${w.kind} ${w.path}`)]
=> [[{from:"c/X.attach/recording.m4a",to:"c/X.attach/recording.attach/recording.m4a"}],["audio c/X.attach/recording.audio.card","doc c/X.doc.card"]]

after(p, (w) => w.kind === "audio")
=>
---
filename:
  ref: attach/recording.m4a
  via:
    channel: microphone
    at: 2026-10-12T12:00:00Z
transcript: Pick up the paint
transcription-error:
  permanent: false
  message: stale
---

after(p, (w) => w.kind === "doc")
=>
---
title: Voice note
via:
  channel: apple-voice-recording
---
[Recorded audio](attach/recording.audio.card)
```

The older layout keeps the recording beside the card (`Note.m4a` next to
`Note.memo.card`). It moves into the doc's attach scope, and the doc gains a
link to it because the memo had none.

```ts
const sib = plan({ "n/Note.memo.card": memo("status: new\ncreated: 2026-05-01T08:00:00-05:00\nsource: telegram\n") }, ["n/Note.m4a"]);
[sib.moves, after(sib, (w) => w.kind === "doc")]
=> [[{from:"n/Note.m4a",to:"n/Note.attach/Note.attach/Note.m4a"}],"---\ntitle: Note\nvia:\n  channel: telegram\n---\n[Recorded audio](attach/Note.audio.card)\n"]
```

Two recordings for one memo, or a recording with no `created` time for the
card, is a failure.

```ts
plan({ "n/Note.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\n") }, ["n/Note.m4a", "n/Note.attach/b.webm"]).failures
=> ["n/Note.memo.card: more than one recording (n/Note.m4a, n/Note.attach/b.webm); move the extra ones out first"]

plan({ "n/Note.memo.card": memo("status: new\n") }, ["n/Note.m4a"]).failures
=> ["n/Note.memo.card: has a recording but no `created` time for its audio card's via.at"]
```

## References follow the rename

The doc keeps the memo's directory and basename, so every mention of the
memo's filename becomes the doc's, whatever form it takes: a link, a
frontmatter ref, an inline YAML map that `bbx mv` skips, or prose. A link to
the recording file gains its new folder.

```ts
const refs = plan({
  ...voice,
  "c/Index.doc.card": "---\ntitle: Index\nrefs: [{ref: X.memo.card}]\n---\nSee [it](/c/X.memo.card), `X.memo.card`, and [audio](X.attach/recording.m4a). Not `**/*.memo.card`.\n",
}, ["c/X.attach/recording.m4a"]);
after(refs, (w) => w.path === "c/Index.doc.card")
=>
---
title: Index
refs: [{ref: X.doc.card}]
---
See [it](/c/X.doc.card), `X.doc.card`, and [audio](X.attach/recording.attach/recording.m4a). Not `**/*.memo.card`.
```

A memo that links another memo links the other memo's doc.

```ts
written({ "n/A.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\ntitle: A\n", "See [B](./B.memo.card)\n"), "n/B.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\ntitle: B\n") }, "n/A.doc.card")
=>
---
title: A
---
See [B](./B.doc.card)
```

A sibling recording's bare filename cannot be told apart from prose, so a
remaining mention of it is a failure to fix by hand.

```ts
plan({ "n/Note.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\n"), "n/Other.doc.card": "---\ntitle: O\n---\n[audio](Note.m4a)\n" }, ["n/Note.m4a"]).failures
=> ["n/Other.doc.card: mentions a recording that moves into an attach scope; update it by hand first"]
```

## Resuming an interrupted run

The runner writes audio cards, moves recordings, writes docs, rewrites
referrers, then deletes memos. A rerun after any of those steps sees the memo
again and accepts the pieces already in place. Here the audio card and the
move landed before the interruption.

```ts
const audioCard = after(plan(voice, ["c/X.attach/recording.m4a"]), (w) => w.kind === "audio");
const moved = plan({ ...voice, "c/X.attach/recording.audio.card": audioCard }, ["c/X.attach/recording.attach/recording.m4a"]);
[moved.failures, moved.moves, moved.writes.map((w) => `${w.kind} ${w.path}`), moved.deletes]
=> [[],[],["doc c/X.doc.card"],["c/X.memo.card"]]
```

A doc already at the target that differs from what the plan writes is not
this migration's work, so the run stops.

```ts
plan({ "n/A.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\n", "Words\n"), "n/A.doc.card": "---\ntitle: Someone else's\n---\n" }).failures
=> ["n/A.memo.card: n/A.doc.card already exists with different content"]
```

## On a box, with an annexed recording

The runner applies the plan to a real box. The recording is a git-annex
symlink; moved one folder deeper it still reaches its content. Box code that
names memo cards is reported and left alone. A second run finds nothing.

```ts
const box = await makeTmpBox({ git: true });
await mkdir(box.path("_content/captures/X.attach"), { recursive: true });
await writeFile(box.path("_content/captures/X.memo.card"), voice["c/X.memo.card"]);
await writeFile(box.path("_content/captures/X.attach/recording.m4a"), "audio bytes");
await mkdir(box.path("src/views"), { recursive: true });
await writeFile(box.path("src/views/memos.tsx"), `export const dependencies = ["_content/**/*.memo.card"];\n`);
execFileSync("git", ["annex", "add", "--force-large", "_content/captures/X.attach/recording.m4a"], { cwd: box.root, stdio: "ignore" });
execFileSync("git", ["add", "-A"], { cwd: box.root });
execFileSync("git", ["commit", "-qm", "fixture", "--no-verify"], { cwd: box.root });
(await lstat(box.path("_content/captures/X.attach/recording.m4a"))).isSymbolicLink()
=> true

const run = await runRetireMemo({ boxRoot: box.root, mode: "apply" });
[run.code, run.lines.filter((l) => !l.startsWith("audio ") && !l.startsWith("doc "))]
=> [0,["warning: src/views/memos.tsx names memo cards; it needs updating by hand after this migration","move _content/captures/X.attach/recording.m4a → _content/captures/X.attach/recording.attach/recording.m4a","delete _content/captures/X.memo.card","retire-memo: memos 1, recordings 1, referrers 0."]]

await readFile(box.path("_content/captures/X.attach/recording.attach/recording.m4a"), "utf8")
=> audio bytes

(await runRetireMemo({ boxRoot: box.root, mode: "apply" })).lines.at(-1)
=> retire-memo: memos 0, recordings 0, referrers 0.

await box.cleanup();
```
