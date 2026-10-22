// # Chat Review: a title right after a turn
//
// A chat used to keep "New conversation" until the nightly chat-review run
// titled it, and a fresh box never ran that pass
// (issues/closed/bugs/2026-10-08-conversation-keeps-placeholder-title.md).
// `src/core/chat/review/after-turn.ts` runs the title pass for one session as
// soon as a turn completes. It shares the title journal and the run lock with
// the nightly run, so a chat it titled is not titled again until it grows.
//
// The reviewer is a scripted fake; no model is called.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { eventually } from "@ianbicking/tap-check/check";
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { makeTmpBox, type TmpBox } from "../../../helpers/test-helpers.js";
import type { ChatReviewer, TitleArgs } from "../../../../src/core/chat/review/reviewer.js";
import { appendSessionManifest } from "../../../../src/core/agent/manifest.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import {
  afterTurnTitleGate,
  FIRST_TURN_TITLE_CHARS,
  titleChatAfterTurn,
  wireAfterTurnTitling,
} from "../../../../src/core/chat/review/after-turn.js";
import { runChatReview } from "../../../../src/core/chat/review/run/core.js";
import { loadReviewState } from "../../../../src/core/chat/review/state.js";
import { ChatSession } from "../../../../src/core/chat/session/run/core.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { tick, plainTestPrompt } from "../../../helpers/chat-session-spawner-helpers.js";

const NOW = new Date("2026-07-28T12:00:00Z");
const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";

function fakeReviewer(title: string): ChatReviewer & { titleCalls: string[] } {
  const titleCalls: string[] = [];
  return {
    titleCalls,
    async review() { throw new Error("the after-turn path never runs the full review"); },
    async title(args: TitleArgs) { titleCalls.push(args.sessionId); return { title }; },
  };
}

function user(uuid: string, text: string) {
  return { type: "user", uuid, timestamp: "2026-07-28T11:59:00Z",
    message: { role: "user", content: [{ type: "text", text }] } };
}

function agent(uuid: string, text: string) {
  return { type: "assistant", uuid, timestamp: "2026-07-28T11:59:30Z",
    message: { role: "assistant", content: [{ type: "text", text }] } };
}

const REPLY = "Here is a plan for the evening, with a menu that works for everyone. ".repeat(6);

/** A husk plus a transcript written just now (the turn that just finished). */
async function seed(box: TmpBox, { sessionId, entries }: { sessionId: string; entries: object[] }) {
  const huskPath = `_content/chat/web/2026-07-28_${sessionId}.chat.card`;
  await box.write(huskPath, `---\nsession: ${sessionId}\n---\n\n`);
  const logPath = getSessionLogPath(box.root, sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  // The transcript is newer than the review's quiescence window would allow.
  await utimes(logPath, NOW, NOW);
  return huskPath;
}

async function freshBox() {
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
  await writeFile(box.path("origin-id"), "11111111-2222-4333-8444-555555555555\n");
  process.env["BBX_ORIGIN_ID_FILE"] = box.path("origin-id");
  return box;
}

// ## The gate: one substantial exchange, or two
//
// A chat qualifies once the person has sent two messages, or after one when the
// first message alone is at least `FIRST_TURN_TITLE_CHARS` characters, about one
// sentence naming a subject. There is no span-size gate: two short exchanges
// are enough.
void test("A chat qualifies once the person has sent two messages, or after one when the...", async (t) => {
  t.check(FIRST_TURN_TITLE_CHARS, 40);

  t.check(
    [
      afterTurnTitleGate({ userTurns: 1, firstMessage: "Help me plan a birthday dinner for Saturday" }),
      afterTurnTitleGate({ userTurns: 1, firstMessage: "hi, can you help me?" }),
      afterTurnTitleGate({ userTurns: 2, firstMessage: "hi" }),
      afterTurnTitleGate({ userTurns: 0, firstMessage: null }),
    ],
    [
    true,
    false,
    true,
    false,
  ],
  );
});

// ## A substantial first exchange is titled at once, and only that session
//
// Two chats have finished a substantial first turn. Titling after session A's
// turn writes A's title and journal and leaves B alone.
void test("Two chats have finished a substantial first turn.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await freshBox();
  const first = "Help me plan a birthday dinner for Saturday, eight people, one vegetarian.";
  const huskA = await seed(box, { sessionId: A, entries: [user("a1", first), agent("a2", REPLY)] });
  const huskB = await seed(box, { sessionId: B, entries: [user("b1", first), agent("b2", REPLY)] });

  const reviewer = fakeReviewer("Saturday birthday dinner for eight");
  t.check(await titleChatAfterTurn(box.root, { sessionId: A, reviewer, now: NOW, ownerEmail: null }), {
    kind: "titled",
    title: "Saturday birthday dinner for eight",
  });

  t.check(reviewer.titleCalls, [
    "aaaaaaaa-1111-4111-8111-111111111111",
  ]);

  const state = await loadReviewState(box.root);
  t.check(state, {
    lastRunAt: null,
    sessions: {
      [A]: {
        applied: {
          title: {
            spanId: "f13ea7698283a1c8",
            endUuid: "a2",
            endIndex: 1,
            prefixHash: "7c7e9990cb2bbd03",
            at: NOW.toISOString(),
          },
        },
        titleOwner: "generated",
        titleHash: "245ff8bea4776953",
        attempts: 0,
        titleAttempts: 0,
      },
    },
  });
  t.checkText(await readFile(box.path(huskB), "utf8"), `---
session: ${B}
---`);

  // The next turn finds the title journal and makes no call; refreshing the title
  // is the nightly run's job.

  const again = fakeReviewer("Something else");
  t.check(await titleChatAfterTurn(box.root, { sessionId: A, reviewer: again, now: NOW, ownerEmail: null }), {
    kind: "skipped",
    reason: "has-title-journal",
  });

  t.check(again.titleCalls, []);

  // The nightly run does not redo it either. Session A has one user turn, below
  // the nightly two-turn minimum, and session B is still inside the quiescence
  // window.

  const nightly = fakeReviewer("Nightly title");
  const summary = await runChatReview(box.root, { reviewer: nightly, maxSessions: 10, now: NOW, ownerEmail: null });
  t.check(summary, {
    reviewed: 0,
    titled: 0,
    titlesKept: 0,
    alreadyApplied: 0,
    bootstrapped: 0,
    rewritten: 0,
    reviewerFailures: 0,
    sessionErrors: 0,
    exhausted: 0,
    rejected: [],
    missingTranscripts: 0,
    deferredActive: 2,
    belowThreshold: 0,
    belowTitleThreshold: 0,
    tooFewTurns: 0,
    foreignOrigin: 0,
    overflow: 0,
  });
  t.check(nightly.titleCalls, []);

  t.checkText(await readFile(box.path(huskA), "utf8"), `---
session: ${A}
title: Saturday birthday dinner for eight
first-message: Help me plan a birthday dinner for Saturday, eight people, one vegetarian.
---`);
});

// ## The title run commits its usage line
//
// A real title pass is a model session, and every model session appends a line
// to the tracked usage manifest (`_bookkeeping/usage/session-manifest.jsonl`).
// The title run writes nothing else that a commit picks up, so the manifest used
// to stay dirty after every chat's first title, until an unrelated commit swept
// it in under that commit's name
// (`issues/closed/bugs/2026-10-09-chat-title-run-leaves-usage-manifest-uncommitted.md`).
// The after-turn path now commits the manifest with the session's husk (which
// no one else commits); the transcript is not part of that commit. The commit names the file
// (`Commit-Source: usage-manifest`), since the manifest can also hold lines that
// other runs appended at the same time.
void test("A real title pass is a model session, and every model session appends a line...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await freshBox();
  const first = "Help me plan a birthday dinner for Saturday, eight people, one vegetarian.";
  await seed(box, { sessionId: A, entries: [user("a1", first), agent("a2", REPLY)] });
  const reviewer = {
    async review() { throw new Error("unused"); },
    async title(args: TitleArgs) {
      appendSessionManifest(box.root, { sessionId: "title-run-1", task: `chat-title:${args.sessionId}`, timestamp: NOW.toISOString() });
      return { title: "Saturday birthday dinner for eight" };
    },
  };

  t.check(await titleChatAfterTurn(box.root, { sessionId: A, reviewer, now: NOW, ownerEmail: null }), {
    kind: "titled",
    title: "Saturday birthday dinner for eight",
  });

  const git = (...args: string[]) => execFileSync("git", args, { cwd: box.root, encoding: "utf8" }).trim();
  t.check(
    ({
      subject: git("log", "-1", "--format=%s"),
      source: git("log", "-1", "--format=%(trailers:key=Commit-Source,valueonly)"),
      files: git("show", "--name-only", "--format=", "HEAD").split("\n"),
      manifestDirty: git("status", "--porcelain", "--", "_bookkeeping/usage/session-manifest.jsonl"),
      huskDirty: git("status", "--porcelain", "--", "_content/chat/web"),
    }),
    {
    subject: "Usage: record agent sessions",
    source: "usage-manifest",
    files: [
      "_bookkeeping/usage/session-manifest.jsonl",
      `_content/chat/web/2026-07-28_${A}.chat.card`,
    ],
    huskDirty: "",
    manifestDirty: "",
  },
  );
});

// ## The nightly run commits its usage lines too
//
// The nightly run calls the same title pass, so a chat it titles appends the
// same manifest line. The run commits the manifest once, after it releases its
// review lock. Another run's model session can append to the manifest at the same
// time, so the commit names the file it records, not a single run.
void test("The nightly run calls the same title pass, so a chat it titles appends the sa...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await freshBox();
  const talk = "please help me plan a small birthday dinner for saturday, eight people, one vegetarian. ".repeat(4);
  await seed(box, { sessionId: A, entries: [user("n1", talk), agent("n2", REPLY), user("n3", talk), agent("n4", REPLY)] });
  const quiet = new Date(NOW.getTime() - 5 * 60 * 60 * 1000);
  await utimes(getSessionLogPath(box.root, A), quiet, quiet);
  // A husk with no transcript (so the run does not review it), edited by someone else, stays out of the commit.
  const otherHusk = `_content/chat/web/2026-07-28_${B}.chat.card`;
  await box.write(otherHusk, `---\nsession: ${B}\n---\n\n`);
  execFileSync("git", ["add", otherHusk], { cwd: box.root });
  execFileSync("git", ["commit", "-m", "other husk"], { cwd: box.root });
  await box.write(otherHusk, `---\nsession: ${B}\ntitle: Edited by hand\n---\n\n`);
  const reviewer = {
    async review() { throw new Error("unused"); },
    async title(args: TitleArgs) {
      appendSessionManifest(box.root, { sessionId: "nightly-run-1", task: `chat-title:${args.sessionId}`, timestamp: NOW.toISOString() });
      return { title: "Saturday birthday dinner for eight" };
    },
  };

  t.check(await runChatReview(box.root, { reviewer, maxSessions: 10, now: NOW, ownerEmail: null }), {
    reviewed: 0,
    titled: 1,
    titlesKept: 0,
    alreadyApplied: 0,
    bootstrapped: 0,
    rewritten: 0,
    reviewerFailures: 0,
    sessionErrors: 0,
    exhausted: 0,
    rejected: [],
    missingTranscripts: 1,
    deferredActive: 0,
    belowThreshold: 1,
    belowTitleThreshold: 0,
    tooFewTurns: 0,
    foreignOrigin: 0,
    overflow: 0,
  });

  const git = (...args: string[]) => execFileSync("git", args, { cwd: box.root, encoding: "utf8" }).trim();
  t.check(
    ({
      subject: git("log", "-1", "--format=%s"),
      source: git("log", "-1", "--format=%(trailers:key=Commit-Source,valueonly)"),
      files: git("show", "--name-only", "--format=", "HEAD").split("\n"),
      manifestDirty: git("status", "--porcelain", "--", "_bookkeeping/usage/session-manifest.jsonl"),
      huskDirty: git("status", "--porcelain", "--", "_content/chat/web"),
    }),
    {
    subject: "Usage: record agent sessions",
    source: "usage-manifest",
    files: [
      "_bookkeeping/usage/session-manifest.jsonl",
      `_content/chat/web/2026-07-28_${A}.chat.card`,
    ],
    huskDirty: `M ${otherHusk}`,
    manifestDirty: "",
  },
  );
});

// ## A greeting waits for the second exchange
//
// A first message of "hi there" names nothing, so the first turn is skipped;
// the second exchange qualifies on the two-turn rule, though the whole chat is
// far below the nightly 400-character title gate.
void test("A first message of \"hi there\" names nothing, so the first turn is skipped; th...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await freshBox();
  const entries = [user("g1", "hi there"), agent("g2", "Hello!")];
  await seed(box, { sessionId: A, entries });
  const reviewer = fakeReviewer("Planning a birthday dinner");

  t.check(await titleChatAfterTurn(box.root, { sessionId: A, reviewer, now: NOW, ownerEmail: null }), {
    kind: "skipped",
    reason: "below-gate",
  });

  // The new husk is committed even though no title was written, and a later
  // below-gate turn with nothing changed adds no commit.
  const git = (...args: string[]) => execFileSync("git", args, { cwd: box.root, encoding: "utf8" }).trim();
  const afterFirst = git("rev-parse", "HEAD");
  t.check({
    files: git("show", "--name-only", "--format=", "HEAD").split("\n"),
    huskDirty: git("status", "--porcelain", "--", "_content/chat/web"),
  }, {
    files: [`_content/chat/web/2026-07-28_${A}.chat.card`],
    huskDirty: "",
  });
  await titleChatAfterTurn(box.root, { sessionId: A, reviewer, now: NOW, ownerEmail: null });
  t.check(git("rev-parse", "HEAD"), afterFirst);

  await seed(box, { sessionId: A, entries: [...entries, user("g3", "help me plan dinner"), agent("g4", "What day?")] });
  t.check(await titleChatAfterTurn(box.root, { sessionId: A, reviewer, now: NOW, ownerEmail: null }), {
    kind: "titled",
    title: "Planning a birthday dinner",
  });
});

// ## A title someone typed is left alone
//
// The husk already carries a title nobody generated, so the pass records it as
// `manual` and makes no model call.
void test("The husk already carries a title nobody generated, so the pass records it as...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await freshBox();
  const huskPath = await seed(box, { sessionId: A, entries: [user("m1", "Help me plan a birthday dinner for Saturday please"), agent("m2", REPLY)] });
  await writeFile(box.path(huskPath), `---\nsession: ${A}\ntitle: Dana's party\n---\n\n`);
  const reviewer = fakeReviewer("Generated");

  t.check(await titleChatAfterTurn(box.root, { sessionId: A, reviewer, now: NOW, ownerEmail: null }), {
    kind: "skipped",
    reason: "not-titled",
  });

  t.check(reviewer.titleCalls, []);
  t.check(await loadReviewState(box.root), {
    lastRunAt: null,
    sessions: {
      [A]: {
        applied: {
          title: {
            spanId: "3b8a22e9394cc8e1",
            endUuid: "m2",
            endIndex: 1,
            prefixHash: "1099de046fd3d6fc",
            at: NOW.toISOString(),
          },
        },
        titleOwner: "manual",
        titleHash: null,
        attempts: 0,
        titleAttempts: 0,
      },
    },
  });
});

// ## A completed turn triggers titling for its own session
//
// `wireAfterTurnTitling` listens for a chat session's `done` and titles that
// session. The fake backend plays one turn for session A; session B, also
// eligible, is not touched.
void test("wireAfterTurnTitling listens for a chat session's done and titles that session.", async (t) => {
  t.teardown(async () => {
    try {
      session.stop();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await freshBox();
  const first = "Help me plan a birthday dinner for Saturday, eight people, one vegetarian.";
  await seed(box, { sessionId: A, entries: [user("a1", first), agent("a2", REPLY)] });
  const huskB = await seed(box, { sessionId: B, entries: [user("b1", first), agent("b2", REPLY)] });

  const backend = createFakeChatBackend();
  const session = new ChatSession(box.root, { backend, systemPrompt: plainTestPrompt, skipBootstrap: true });
  const reviewer = fakeReviewer("Saturday birthday dinner for eight");
  const titled: Array<{ sessionId: string; title: string }> = [];
  wireAfterTurnTitling(session, {
    boxRoot: box.root, reviewer, now: () => NOW, ownerEmail: () => null,
    onTitled: (event) => { titled.push(event); },
  });

  await session.send("hello");
  await tick();
  const run = backend.lastRun();
  assert.ok(run);
  const done = once(session, "done");
  run.emitSessionInit(A);
  run.emitAssistantText("plain reply");
  run.emitResult();
  await done;
  await eventually(() => titled.length === 1, { label: "session A is titled" });

  t.check(titled, [
    {
      sessionId: "aaaaaaaa-1111-4111-8111-111111111111",
      title: "Saturday birthday dinner for eight",
    },
  ]);

  t.check(reviewer.titleCalls, [A]);
  t.checkText(await readFile(box.path(huskB), "utf8"), `---
session: ${B}
---`);
});
