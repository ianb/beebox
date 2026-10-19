// # First user message of a transcript
//
// `readFirstUserSnippet` is what names a chat that has no editorial title, in the
// history dropdown and the landmark picker. It answers the same question
// `getSessionMetadata().firstUserSnippet` answers, but stops at the first
// qualifying user turn instead of folding the whole file — the label lives a few
// lines into a transcript that can be megabytes, and every chat in the box gets
// one resolved when a list is built. (Measured 2026-08-08 on a ~10k-file box:
// 65 chats went from ~500ms to ~25ms.)
//
// Both readers share one `userTurnText`, so what counts as "a real user turn"
// can't drift between the label a list shows and the turn counts a report shows.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { readFirstUserSnippet } from "../../../src/cli/lib/session-snippet.js";
import { getSessionMetadata } from "../../../src/cli/lib/session.js";
import type { TmpBox } from "../../helpers/test-helpers.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

function user(text: string, extra?: Record<string, unknown>) {
  return JSON.stringify({
    type: "user",
    timestamp: "2026-08-08T03:00:00Z",
    message: { role: "user", content: [{ type: "text", text }] },
    ...extra,
  });
}

function assistant(text: string) {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-08-08T03:00:01Z",
    message: { role: "assistant", model: "claude", content: [{ type: "text", text }] },
  });
}

/** Write a transcript from raw JSONL lines and return its path. */
async function transcript(box: TmpBox, lines: string[]): Promise<string> {
  const logPath = box.path("log.jsonl");
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, lines.join("\n") + "\n");
  return logPath;
}

// ## The first real user turn is the snippet
void test("The first real user turn is the snippet", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L51
  const box = await makeTmpBox();
  const logPath = await transcript(box, [
    user("what's on my calendar tomorrow"),
    assistant("Three things."),
    user("and the day after?"),
  ]);

  // doctest:L58
  t.check(await readFirstUserSnippet({ logPath, snippetMaxLen: 400 }), "what's on my calendar tomorrow");

  // It is trimmed to `snippetMaxLen`, with an ellipsis marking the cut.

  // doctest:L65
  t.check(await readFirstUserSnippet({ logPath, snippetMaxLen: 12 }), "what's on m…");

  // An empty transcript, or one that never holds a real user turn, has no snippet —
  // callers fall back to the session id rather than inventing a name.

  // doctest:L73
  const emptyLog = box.path("empty.jsonl");
  await writeFile(emptyLog, "");
  t.check(await readFirstUserSnippet({ logPath: emptyLog, snippetMaxLen: 400 }), null);
});

// ## The machine's own traffic in the user position is skipped
//
// Tool-result plumbing, SDK meta prompts, post-compaction summaries, and
// self-notes all arrive as `type: "user"` but were never typed by a person. A
// chat named after one of them reads as gibberish in the list.
void test("Tool-result plumbing, SDK meta prompts, post-compaction summaries, and self-n...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L90
  const box = await makeTmpBox();
  const logPath = await transcript(box, [
    user("Tool loaded."),
    user("<system-reminder>housekeeping</system-reminder>", { isMeta: true }),
    user("This session is being continued from a previous conversation that ran out of context. Here is a summary."),
    user("<self-note>remember the lentils</self-note>"),
    user("ok so about that recipe"),
  ]);

  // doctest:L99
  t.check(await readFirstUserSnippet({ logPath, snippetMaxLen: 400 }), "ok so about that recipe");

  // The full-file scanner agrees, because both read the same `userTurnText`.

  // doctest:L106
  const meta = await getSessionMetadata({ sessionId: "s1", logPath, snippetMaxLen: 400 });
  t.check(meta.firstUserSnippet, "ok so about that recipe");

  // doctest:L112
  t.check(meta.userTurns, 1);
});

// ## A turn that strips to nothing doesn't end the scan
//
// Speech-wrapper markup (`<chat-app …>`, `<instructions>`, `<speech>`) is stripped
// before a snippet is taken, so a message that was *only* wrappers has no text
// left. That is not "this chat has no name" — keep looking.
void test("Speech-wrapper markup (<chat-app …>, <instructions>, <speech>) is stripped be...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L127
  const box = await makeTmpBox();
  const logPath = await transcript(box, [
    user("<instructions>speak briefly</instructions>"),
    user("<speech>how's my week looking</speech>"),
  ]);

  // doctest:L133
  t.check(await readFirstUserSnippet({ logPath, snippetMaxLen: 400 }), "how's my week looking");
});

// ## Unparseable lines are skipped, a missing file throws
//
// A partial or concurrent write mustn't abort the scan — the transcript is being
// appended to while lists are read. (Expect a `skipping unparseable JSONL line`
// debug line below; that's the fixture.)
void test("A partial or concurrent write mustn't abort the scan — the transcript is bein...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L148
  const box = await makeTmpBox();
  const logPath = await transcript(box, [
    "{ not json",
    "",
    user("still found me"),
  ]);

  // doctest:L155
  t.check(await readFirstUserSnippet({ logPath, snippetMaxLen: 400 }), "still found me");

  // A transcript that isn't there is the caller's problem, not a silent null — the
  // session lists treat "no transcript" as "nothing to resume" and say so.

  // doctest:L163
  t.check(await readFirstUserSnippet({ logPath: box.path("gone.jsonl"), snippetMaxLen: 400 }).catch((e) => e.code), "ENOENT");
});
