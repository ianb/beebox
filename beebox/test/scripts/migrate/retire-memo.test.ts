// # Migration: retire the memo card type
//
// `retire-memo-2026-10` turns every `*.memo.card` into a `*.doc.card` with the
// same directory and basename (docs/implemented-plans/retire-memo.md, Track D). A recording
// moves under an `audio` card in the doc's attach scope, and every mention of the
// memo's filename follows the rename. It fails closed: a field it does not map,
// or a recording it cannot place, names the memo, writes nothing, and exits 1.

import { test } from "tap";
import "agent-doctest/tap";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { planRetireMemo, type PlannedWrite } from "../../../src/scripts/migrate/retire-memo/plan.js";
import { runRetireMemo } from "../../../src/scripts/migrate/retire-memo/run.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

/** Plan a box given as path → text; `files` adds non-text files. */
function plan(texts: Record<string, string>, files?: string[]) {
  return planRetireMemo({ texts: new Map(Object.entries(texts)), files: new Set([...Object.keys(texts), ...(files ?? [])]) });
}
/** The text a plan writes to the first path that matches; a missing write is an error. */
function after(p: ReturnType<typeof plan>, match: (w: PlannedWrite) => boolean): string {
  const write = p.writes.find(match);
  if (write === undefined) throw new Error(p.failures.length > 0 ? p.failures.join("; ") : "no such write");
  return write.after;
}
/** The text the plan writes to one path. */
function written(texts: Record<string, string>, target: string): string {
  return after(plan(texts), (w) => w.path === target);
}
const memo = (front: string, body?: string) => `---\n${front}---\n${body ?? ""}`;
/** A quick-capture voice memo whose recording sits in its attach scope. */
const voice = { "c/X.memo.card": memo("status: processed\ncreated: 2026-10-12T12:00:00Z\nsource: apple-voice-recording\ntitle: Voice note\ntranscription:\n  text: Pick up the paint\ntranscription-error:\n  permanent: false\n  message: stale\n", "[Recorded audio](attach/recording.m4a)\n") };

// ## Titles
//
// An explicit `title:` wins. Otherwise a leading heading becomes the title and
// leaves the body, since a doc does not repeat its title as a heading.
void test("An explicit title: wins.", async (t) => {
  // doctest:L41
  await t.checkText(written({ "n/A.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\ntitle: Kept\n", "# Not this\nBody\n") }, "n/A.doc.card"), `---
title: Kept
---
# Not this
Body`);

  // doctest:L49
  await t.checkText(written({ "n/A.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\n", "# Porch *plan*\n\nBody\n") }, "n/A.doc.card"), `---
title: Porch plan
---
Body`);
});

// Without either, the first paragraph is the title, joined across its hard
// wraps and cut at 80 characters. That is what the memo list showed. An empty
// memo is titled from its filename.
void test("Without either, the first paragraph is the title, joined across its hard wrap...", async (t) => {
  // doctest:L62
  t.check(written({ "n/A.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\n", "- Buy *cedar* boards for\n  the porch\n\nSecond.\n") }, "n/A.doc.card").split("\n"), [
    "---",
    "title: Buy cedar boards for the porch",
    "---",
    "- Buy *cedar* boards for",
    "  the porch",
    "",
    "Second.",
    "",
  ]);

  // doctest:L65
  await t.checkText(written({ "n/Old_Voice.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\n") }, "n/Old_Voice.doc.card"), `---
title: Old Voice
---`);
});

// ## Provenance
//
// `source` becomes `via.channel`, verbatim. A page URL becomes the doc's
// `sources` entry with its title as the label; clipped text goes into a
// `## Clipping` section. A clip title with no URL stays in that section.
// Global fields such as `todos` and `share-id` are kept.
void test("source becomes via.channel, verbatim.", async (t) => {
  // doctest:L80
  t.check(
    written({ "n/A.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\nsource: telegram\nshare-id: 11111111-1111-4111-8111-111111111111\ntodos: []\ncontext:\n  url: https://example.com/a\n  title: A page\n  text: A quoted line\n", "My words\n") }, "n/A.doc.card").split("\n")
    ,
    [
    "---",
    "title: My words",
    "todos: []",
    "share-id: 11111111-1111-4111-8111-111111111111",
    "via:",
    "  channel: telegram",
    "sources:",
    "  - href: https://example.com/a",
    "    label: A page",
    "---",
    "My words",
    "",
    "## Clipping",
    "",
    "> A quoted line",
    "",
  ],
  );

  // doctest:L83
  t.check(written({ "n/A.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\ncontext:\n  title: A book\n  text: A quoted line\n", "Note\n") }, "n/A.doc.card").split("\n"), [
    "---",
    "title: Note",
    "---",
    "Note",
    "",
    "## Clipping",
    "",
    "Clipped from “A book”:",
    "",
    "> A quoted line",
    "",
  ]);
});

// A field the migration does not map, top-level or nested, fails the whole run.
void test("A field the migration does not map, top-level or nested, fails the whole run.", async (t) => {
  // doctest:L90
  t.check(plan({ "n/A.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\npriority: high\ncontext:\n  author: Odette\n") }).failures, [
    "n/A.memo.card: fields this migration does not map: priority, context.author",
  ]);
});

// ## Transcriptions
//
// A transcription with no recording becomes the body, or a `## Transcript`
// section when the body says something else. A body that already holds the
// same words, re-wrapped or with a link, gets no second copy. Its language,
// time, and an error with no recording to retry are dropped and reported.
void test("A transcription with no recording becomes the body, or a ## Transcript sectio...", async (t) => {
  // doctest:L102
  const tx = "status: new\ncreated: 2026-01-01T00:00:00Z\ntranscription:\n  text: Pick up the paint\n  language: en\n";
  await t.checkText(written({ "n/A.memo.card": memo(tx) }, "n/A.doc.card"), `---
title: Pick up the paint
---
Pick up the paint`);

  // doctest:L110
  await t.checkText(written({ "n/A.memo.card": memo(tx, "Pick up\nthe [paint](x.doc.card)\n") }, "n/A.doc.card"), `---
title: Pick up the paint
---
Pick up
the [paint](x.doc.card)`);

  // doctest:L118
  t.check(plan({ "n/A.memo.card": memo(tx + "transcription-error:\n  permanent: true\n  message: Bad audio\n", "Other words\n") }).dropped, [
    "n/A.memo.card: transcription.language = en",
    "n/A.memo.card: transcription-error with no recording = {\"permanent\":true,\"message\":\"Bad audio\"}",
  ]);
});

// ## Recordings
//
// A quick-capture recording in the attach scope gets `recording.audio.card`
// and moves into that card's own attach scope. The memo's `created` becomes
// the card's `via.at`, the only place a creation time is kept; a voice capture
// was recorded on a microphone. The doc links the card where it linked the file.
void test("A quick-capture recording in the attach scope gets recording.audio.card and m...", async (t) => {
  // doctest:L130
  const p = plan(voice, ["c/X.attach/recording.m4a"]);
  t.check([p.moves, p.writes.map((w) => `${w.kind} ${w.path}`)], [
    [
      {
        from: "c/X.attach/recording.m4a",
        to: "c/X.attach/recording.attach/recording.m4a",
      },
    ],
    [
      "audio c/X.attach/recording.audio.card",
      "doc c/X.doc.card",
    ],
  ]);

  // doctest:L134
  await t.checkText(after(p, (w) => w.kind === "audio"), `---
filename:
  ref: attach/recording.m4a
  via:
    channel: microphone
    at: 2026-10-12T12:00:00Z
transcript: Pick up the paint
transcription-error:
  permanent: false
  message: stale
---`);

  // doctest:L148
  await t.checkText(after(p, (w) => w.kind === "doc"), `---
title: Voice note
via:
  channel: apple-voice-recording
---
[Recorded audio](attach/recording.audio.card)`);
});

// The older layout keeps the recording beside the card (`Note.m4a` next to
// `Note.memo.card`). It moves into the doc's attach scope, and the doc gains a
// link to it because the memo had none.
void test("The older layout keeps the recording beside the card (Note.m4a next to Note.m...", async (t) => {
  // doctest:L163
  const sib = plan({ "n/Note.memo.card": memo("status: new\ncreated: 2026-05-01T08:00:00-05:00\nsource: telegram\n") }, ["n/Note.m4a"]);
  t.check([sib.moves, after(sib, (w) => w.kind === "doc")], [
    [
      {
        from: "n/Note.m4a",
        to: "n/Note.attach/Note.attach/Note.m4a",
      },
    ],
    `---
title: Note
via:
  channel: telegram
---
[Recorded audio](attach/Note.audio.card)
`,
  ]);
});

// Two recordings for one memo, or a recording with no `created` time for the
// card, is a failure.
void test("Two recordings for one memo, or a recording with no created time for the card...", async (t) => {
  // doctest:L172
  t.check(plan({ "n/Note.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\n") }, ["n/Note.m4a", "n/Note.attach/b.webm"]).failures, [
    "n/Note.memo.card: more than one recording (n/Note.m4a, n/Note.attach/b.webm); move the extra ones out first",
  ]);

  // doctest:L175
  t.check(plan({ "n/Note.memo.card": memo("status: new\n") }, ["n/Note.m4a"]).failures, [
    "n/Note.memo.card: has a recording but no `created` time for its audio card's via.at",
  ]);
});

// ## References follow the rename
//
// The doc keeps the memo's directory and basename, so every mention of the
// memo's filename becomes the doc's, whatever form it takes: a link, a
// frontmatter ref, an inline YAML map that `bbx mv` skips, or prose. A link to
// the recording file gains its new folder.
void test("The doc keeps the memo's directory and basename, so every mention of the memo...", async (t) => {
  // doctest:L187
  const refs = plan({
    ...voice,
    "c/Index.doc.card": "---\ntitle: Index\nrefs: [{ref: X.memo.card}]\n---\nSee [it](/c/X.memo.card), `X.memo.card`, and [audio](X.attach/recording.m4a). Not `**/*.memo.card`.\n",
  }, ["c/X.attach/recording.m4a"]);
  await t.checkText(after(refs, (w) => w.path === "c/Index.doc.card"), `---
title: Index
refs: [{ref: X.doc.card}]
---
See [it](/c/X.doc.card), \`X.doc.card\`, and [audio](X.attach/recording.attach/recording.m4a). Not \`**/*.memo.card\`.`);
});

// A memo that links another memo links the other memo's doc.
void test("A memo that links another memo links the other memo's doc.", async (t) => {
  // doctest:L203
  await t.checkText(written({ "n/A.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\ntitle: A\n", "See [B](./B.memo.card)\n"), "n/B.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\ntitle: B\n") }, "n/A.doc.card"), `---
title: A
---
See [B](./B.doc.card)`);
});

// A sibling recording's bare filename cannot be told apart from prose, so a
// remaining mention of it is a failure to fix by hand.
void test("A sibling recording's bare filename cannot be told apart from prose, so a rem...", async (t) => {
  // doctest:L215
  t.check(plan({ "n/Note.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\n"), "n/Other.doc.card": "---\ntitle: O\n---\n[audio](Note.m4a)\n" }, ["n/Note.m4a"]).failures, [
    "n/Other.doc.card: mentions a recording that moves into an attach scope; update it by hand first",
  ]);
});

// ## Resuming an interrupted run
//
// The runner writes audio cards, moves recordings, writes docs, rewrites
// referrers, then deletes memos. A rerun after any of those steps sees the memo
// again and accepts the pieces already in place. Here the audio card and the
// move landed before the interruption.
void test("The runner writes audio cards, moves recordings, writes docs, rewrites referr...", async (t) => {
  // doctest:L227
  const audioCard = after(plan(voice, ["c/X.attach/recording.m4a"]), (w) => w.kind === "audio");
  const moved = plan({ ...voice, "c/X.attach/recording.audio.card": audioCard }, ["c/X.attach/recording.attach/recording.m4a"]);
  t.check([moved.failures, moved.moves, moved.writes.map((w) => `${w.kind} ${w.path}`), moved.deletes], [
    [],
    [
      {
        from: "c/X.attach/recording.m4a",
        to: "c/X.attach/recording.attach/recording.m4a",
      },
    ],
    [
      "doc c/X.doc.card",
    ],
    [
      "c/X.memo.card",
    ],
  ]);
});

// The move is planned again even then: the annex-preserving move repairs the
// recording's link when an earlier attempt renamed it but stopped before
// fixing the link.
//
// A memo that links another memo is resumed too: the doc the first run wrote
// already links the other doc, and the rerun compares it that way.
void test("The move is planned again even then:", async (t) => {
  // doctest:L241
  const pair = { "n/A.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\ntitle: A\n", "See [B](./B.memo.card)\n"), "n/B.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\ntitle: B\n") };
  const firstA = written(pair, "n/A.doc.card");
  t.check(plan({ ...pair, "n/A.doc.card": firstA }).failures, []);
});

// A sibling recording whose audio card was written before the interruption
// resumes without mistaking that card's own reference for a stray mention.
void test("A sibling recording whose audio card was written before the interruption resu...", async (t) => {
  // doctest:L251
  const sibMemo = { "n/Note.memo.card": memo("status: new\ncreated: 2026-05-01T08:00:00-05:00\n") };
  const sibCard = after(plan(sibMemo, ["n/Note.m4a"]), (w) => w.kind === "audio");
  const resumed = plan({ ...sibMemo, "n/Note.attach/Note.audio.card": sibCard }, ["n/Note.m4a"]);
  t.check([resumed.failures, resumed.moves], [
    [],
    [
      {
        from: "n/Note.m4a",
        to: "n/Note.attach/Note.attach/Note.m4a",
      },
    ],
  ]);
});

// A doc already at the target that differs from what the plan writes is not
// this migration's work, so the run stops.
void test("A doc already at the target that differs from what the plan writes is not thi...", async (t) => {
  // doctest:L262
  t.check(plan({ "n/A.memo.card": memo("status: new\ncreated: 2026-01-01T00:00:00Z\n", "Words\n"), "n/A.doc.card": "---\ntitle: Someone else's\n---\n" }).failures, [
    "n/A.memo.card: n/A.doc.card already exists with different content",
  ]);
});

// ## On a box, with an annexed recording
//
// The runner applies the plan to a real box. The recording is a git-annex
// symlink; moved one folder deeper it still reaches its content.
//
// Box code and card fields that still name memo cards are leftovers the filename
// rewrite cannot fix, like a view's dependency glob or a styling rule. The run
// converts everything else and exits 2, listing the leftovers last. Exit 2 sends
// the migration to the sweep's agent repair, and the rerun after repair confirms
// it. A warning with exit 0 would leave the box broken with nobody told.
void test("The runner applies the plan to a real box.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L278
  const box = await makeTmpBox({ git: true });
  await mkdir(box.path("_content/captures/X.attach"), { recursive: true });
  await writeFile(box.path("_content/captures/X.memo.card"), voice["c/X.memo.card"]);
  await writeFile(box.path("_content/captures/X.attach/recording.m4a"), "audio bytes");
  await mkdir(box.path("src/views"), { recursive: true });
  await writeFile(box.path("src/views/memos.tsx"), "export const dependencies = [\"_content/**/*.memo.card\"];\n");
  await writeFile(box.path("_content/Look.mockup.card"), "---\nrules:\n  - match: \"**/*.memo.card\"\n---\nA prose mention of Old.memo.card is not a leftover.\n");
  execFileSync("git", ["annex", "add", "--force-large", "_content/captures/X.attach/recording.m4a"], { cwd: box.root, stdio: "ignore" });
  execFileSync("git", ["add", "-A"], { cwd: box.root });
  execFileSync("git", ["commit", "-qm", "fixture", "--no-verify"], { cwd: box.root });
  t.check((await lstat(box.path("_content/captures/X.attach/recording.m4a"))).isSymbolicLink(), true);

  // doctest:L291
  const run = await runRetireMemo({ boxRoot: box.root, mode: "apply" });
  t.check([run.code, run.lines.filter((l) => !l.startsWith("audio ") && !l.startsWith("doc "))], [
    2,
    [
      "move _content/captures/X.attach/recording.m4a → _content/captures/X.attach/recording.attach/recording.m4a",
      "delete _content/captures/X.memo.card",
      "retire-memo: memos 1, recordings 1, referrers 0.",
      "leftover: src/views/memos.tsx is box code that names memo cards; change it to doc cards",
      "leftover: _content/Look.mockup.card names memo cards in a field; change it to doc cards",
      "retire-memo: converted; 2 leftover(s) still name memo cards.",
    ],
  ]);

  // doctest:L295
  t.check(await readFile(box.path("_content/captures/X.attach/recording.attach/recording.m4a"), "utf8"), "audio bytes");

  // Until the leftovers are fixed, a rerun exits 2 again. A repair that missed one
  // is then recorded with a question for the boxholder that lists it, not as
  // done.

  // doctest:L305
  const again = await runRetireMemo({ boxRoot: box.root, mode: "apply" });
  t.check([again.code, again.lines.at(-1)], [
    2,
    "retire-memo: converted; 2 leftover(s) still name memo cards.",
  ]);

  // Once the agent has changed both to doc cards, the rerun converts nothing and
  // exits 0.

  // doctest:L314
  await writeFile(box.path("src/views/memos.tsx"), "export const dependencies = [\"_content/**/*.doc.card\"];\n");
  await writeFile(box.path("_content/Look.mockup.card"), "---\nrules:\n  - match: \"**/*.doc.card\"\n---\n");
  const fixed = await runRetireMemo({ boxRoot: box.root, mode: "apply" });
  t.check([fixed.code, fixed.lines.at(-1)], [
    0,
    "retire-memo: memos 0, recordings 0, referrers 0.",
  ]);
});
