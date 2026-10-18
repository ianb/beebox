// # Chat Review: failures, caps, and races in a run
//
// Continues [run.doctest.md](run.doctest.md). This part covers credentials dropped from generated text, repair after a crash between the husk and journal writes, reviewer failures, the per-run cap, transcripts that vanish or come back to life mid-run, and the untouched husk body.

import { test } from "tap";
import "agent-doctest/tap";
import { appendFile, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { makeTmpBox, type TmpBox } from "../../../helpers/doctest-helpers.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import { runChatReview } from "../../../../src/core/chat/review/run/core.js";
import { loadReviewState } from "../../../../src/core/chat/review/state.js";
import type { ChatReviewer, ReviewArgs, ReviewOutput, TitleArgs, TitleOutput } from "../../../../src/core/chat/review/reviewer.js";

const NOW = new Date("2026-07-28T12:00:00Z");

const HOUR = 60 * 60 * 1000;

/** A reviewer that returns canned output and records what it was asked. */
function fakeReviewer(
  outputs: Array<ReviewOutput | Error>,
  titleOutputs?: Array<TitleOutput | Error>,
): ChatReviewer & { calls: ReviewArgs[]; titleCalls: TitleArgs[] } {
  const calls: ReviewArgs[] = [];
  const titleCalls: TitleArgs[] = [];
  let i = 0;
  let j = 0;
  return {
    calls,
    titleCalls,
    async review(args: ReviewArgs) {
      calls.push(args);
      const out = outputs[Math.min(i, outputs.length - 1)];
      i += 1;
      if (out === undefined) throw new Error("fakeReviewer: no scripted review output");
      if (out instanceof Error) throw out;
      return out;
    },
    async title(args: TitleArgs) {
      titleCalls.push(args);
      if (titleOutputs === undefined) throw new Error("unexpected title call");
      const out = titleOutputs[Math.min(j, titleOutputs.length - 1)];
      j += 1;
      if (out === undefined) throw new Error("fakeReviewer: no scripted title output");
      if (out instanceof Error) throw out;
      return out;
    },
  };
}

function userEntry(uuid: string, text: string) {
  return {
    type: "user",
    uuid,
    timestamp: "2026-07-28T03:00:00Z",
    message: { role: "user", content: [{ type: "text", text }] },
  };
}

/**
 * A readable fixture label as a stable UUID. The husk's `session` field is
 * validated as a UUID (`schemas/chat.ts`), while the husk *filename* below
 * keeps the label — the same split the schema enforces: the field is the key,
 * the name is only a convention. `label`/`labelled` map back so the
 * expectations stay readable.
 */
const idsByLabel = new Map<string, string>();

const labelsById = new Map<string, string>();

function sid(name: string): string {
  const cached = idsByLabel.get(name);
  if (cached !== undefined) return cached;
  const h = createHash("sha256").update(name).digest("hex");
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  idsByLabel.set(name, id);
  labelsById.set(id, name);
  return id;
}

function label(sessionId: string): string {
  return labelsById.get(sessionId) ?? sessionId;
}

function labelled(text: string): string {
  let out = text;
  for (const [id, name] of labelsById) out = out.split(id).join(name);
  return out;
}

/** Seed a husk card plus a backdated transcript big enough to clear the gate. */
async function seed(box: TmpBox, opts: { sessionId: string; husk: string; entries: object[] }) {
  await box.write(`_content/chat/web/2026-07-28_${opts.sessionId}.chat.card`,
    `---\nsession: ${sid(opts.sessionId)}\n${opts.husk}---\n\n`);
  const logPath = getSessionLogPath(box.root, sid(opts.sessionId));
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, opts.entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const when = new Date(NOW.getTime() - 5 * HOUR);
  await utimes(logPath, when, when);
  return `_content/chat/web/2026-07-28_${opts.sessionId}.chat.card`;
}

/** Enough rendered text to clear REVIEW_CHAR_THRESHOLD. */
function bulk(uuid: string) {
  return userEntry(uuid, "a".repeat(4000));
}

const OUTPUT: ReviewOutput = {
  title: "Sorting out a recurring billing problem",
  contains: "Working through a repeated billing error and how to stop it.",
  notes: [
    { kind: "decision", text: "cancel the duplicate subscription" },
    { kind: "follow-up", text: "check next month's statement" },
  ],
};

// ## A credential in generated text is dropped, not committed
//
// The leak scan rejects exactly one thing: a credential shape. That is secret
// hygiene rather than editorial judgement — an API key in a git-tracked card is a
// problem regardless of which field it landed in or who reads it.
//
// Names, addresses, figures and dates are **not** rejected. A title that would
// embarrass someone is a real risk, but no regex detects it, so that judgement lives
// in the prompt where it can actually be exercised rather than half here.
void test("The leak scan rejects exactly one thing:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L129
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
  const huskPath = await seed(box, {
    sessionId: "sess9999", husk: "", entries: [bulk("w1"), bulk("w2")],
  });

  // doctest:L135
  const summary = await runChatReview(box.root, {
    reviewer: fakeReviewer([{
      ...OUTPUT,
      title: "Rotating sk-abcdefghijklmnopqrstuvwxyz012345",
    }]),
    maxSessions: 10, now: NOW, ownerEmail: null,
  });
  t.check(labelled(summary.rejected.join(",")), "sess9999:title");

  // doctest:L145
  const card = await readFile(box.path(huskPath), "utf8");
  t.check([card.includes("sk-abcdefghijklmnop"), card.includes("contains: Working through")].join(","), "false,true");

  // An ordinary title full of specifics sails through — no name-stripping, no
  // address-stripping.

  // doctest:L154
  const box2 = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box2.path("claude-projects");
  const husk2 = await seed(box2, {
    sessionId: "sessplain", husk: "", entries: [bulk("v1"), bulk("v2")],
  });
  const plain = await runChatReview(box2.root, {
    reviewer: fakeReviewer([{
      ...OUTPUT,
      title: "Indigo's custodial account paperwork",
      contains: "Sorting out a clerical error, dana.lin@example.com copied in.",
    }]),
    maxSessions: 10, now: NOW, ownerEmail: null,
  });
  await t.checkText(plain.rejected.length, "0");

  // doctest:L170
  const card2 = await readFile(box2.path(husk2), "utf8");
  t.check([card2.includes("Indigo's custodial account paperwork"), card2.includes("dana.lin@example.com")].join(","), "true,true");

  // doctest:L174
  await box2.cleanup();
});

// ## A crash between the husk write and the journal write is repaired, not replayed
//
// The husk is written first and the journal second, so a crash in between leaves
// the account already extended while the journal still points at the old boundary.
// Naively re-running would hand the model the already-extended account *plus* the
// same span again — it could fold the same material in twice.
//
// The applied span id on the husk is what prevents that: the next run recomputes
// the same id, sees it already recorded, and just advances the journal.
void test("The husk is written first and the journal second, so a crash in between leave...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L192
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
  const huskPath = await seed(box, {
    sessionId: "sesscrash", husk: "", entries: [bulk("c1"), bulk("c2")],
  });

  // doctest:L198
  await runChatReview(box.root, {
    reviewer: fakeReviewer([OUTPUT]), maxSessions: 10, now: NOW, ownerEmail: null,
  });
  const afterFirst = await readFile(box.path(huskPath), "utf8");

  // doctest:L203
  t.check(
    // The marker and the account it claims landed together — the marker is never
    // written without them, so it can never certify an account that isn't there.
    [afterFirst.includes("review-span:"), afterFirst.includes("contains-evidence:")].join(","),
    "true,true",
  );

  // doctest:L208
  // Simulate the crash: the husk write landed, the journal did not.
  await writeFile(box.path(".beebox/chat-review/state.json"),
    JSON.stringify({ lastRunAt: null, sessions: {} }, null, 2) + "\n");

  // doctest:L212
  const recovery = fakeReviewer([{ ...OUTPUT, title: "Should never be written" }]);
  const summary = await runChatReview(box.root, {
    reviewer: recovery, maxSessions: 10, now: NOW, ownerEmail: null,
  });
  t.check({ alreadyApplied: summary.alreadyApplied, modelCalls: recovery.calls.length }, {
    alreadyApplied: 1,
    modelCalls: 0,
  });

  // The card is untouched, and the journal has caught up — so a third run sees
  // nothing new either.

  // doctest:L224
  await t.checkText((await readFile(box.path(huskPath), "utf8")) === afterFirst, "true");

  // doctest:L227
  const state = await loadReviewState(box.root);
  t.check(state.sessions[sid("sesscrash")]?.applied["metadata"]?.endUuid, "c2");
});

// ## A reviewer failure is counted, not fatal
void test("A reviewer failure is counted, not fatal", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L239
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
  await seed(box, { sessionId: "sessfail", husk: "", entries: [bulk("x1"), bulk("x2")] });

  // doctest:L243
  const summary = await runChatReview(box.root, {
    reviewer: fakeReviewer([new Error("model unavailable")]),
    maxSessions: 10, now: NOW, ownerEmail: null,
  });
  t.check({ reviewed: summary.reviewed, failures: summary.reviewerFailures }, {
    reviewed: 0,
    failures: 1,
  });

  // doctest:L250
  const state = await loadReviewState(box.root);
  t.check(state.sessions[sid("sessfail")]?.attempts, 1);
});

// ## The per-run cap picks the oldest sessions
//
// Discovery no longer carries parsed transcripts — each reviewed session's window
// is re-read inside the per-session step, after the `--max-sessions` slice, so the
// cap now decides how many transcripts are ever *resident* at once. What it
// selects is unchanged: oldest first, the rest deferred to the next run.
void test("Discovery no longer carries parsed transcripts — each reviewed session's wind...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L267
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  // doctest:L270
  for (const [sessionId, agoHours] of [["sessnew", 5], ["sessold", 40], ["sessmid", 20]] satisfies Array<[string, number]>) {
    await seed(box, { sessionId, husk: "", entries: [bulk(`${sessionId}1`), bulk(`${sessionId}2`)] });
    const when = new Date(NOW.getTime() - agoHours * HOUR);
    await utimes(getSessionLogPath(box.root, sid(sessionId)), when, when);
  }

  // doctest:L276
  const reviewer = fakeReviewer([OUTPUT]);
  const summary = await runChatReview(box.root, {
    reviewer, maxSessions: 2, now: NOW, ownerEmail: null,
  });
  t.check(
    {
      reviewed: summary.reviewed,
      overflow: summary.overflow,
      asked: reviewer.calls.map((c) => label(c.sessionId)),
    },
    {
    reviewed: 2,
    overflow: 1,
    asked: [
      "sessold",
      "sessmid",
    ],
  },
  );

  // The deferred session is untouched — no husk fields, no journal entry — and the
  // next run picks it up.

  // doctest:L292
  await t.checkText((await readFile(box.path("_content/chat/web/2026-07-28_sessnew.chat.card"), "utf8")).includes("title:"), "false");

  // doctest:L295
  const rest = fakeReviewer([OUTPUT]);
  const second = await runChatReview(box.root, {
    reviewer: rest, maxSessions: 2, now: NOW, ownerEmail: null,
  });
  t.check({ reviewed: second.reviewed, asked: rest.calls.map((c) => label(c.sessionId)) }, {
    reviewed: 1,
    asked: [
      "sessnew",
    ],
  });

  // ## A transcript that vanishes between discovery and review is counted, not fatal
  //
  // Discovery stats and parses the transcript; the reviewer re-reads it a moment
  // later. In between, the SDK may have cleaned it up. Here the first session's
  // review deletes the second's transcript, so the second re-read finds nothing.

  // doctest:L310
  const box2 = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box2.path("claude-projects");
  for (const [sessionId, agoHours] of [["sessfirst", 40], ["sessvanish", 20]] satisfies Array<[string, number]>) {
    await seed(box2, { sessionId, husk: "", entries: [bulk(`${sessionId}1`), bulk(`${sessionId}2`)] });
    const when = new Date(NOW.getTime() - agoHours * HOUR);
    await utimes(getSessionLogPath(box2.root, sid(sessionId)), when, when);
  }

  // doctest:L318
  const sabotagedCalls: ReviewArgs[] = [];
  const saboteur: ChatReviewer & { calls: ReviewArgs[] } = {
    calls: sabotagedCalls,
    async title(): Promise<TitleOutput> { throw new Error("unexpected title call"); },
    async review(args: ReviewArgs) {
      sabotagedCalls.push(args);
      await rm(getSessionLogPath(box2.root, sid("sessvanish")), { force: true });
      return OUTPUT;
    },
  };
  const vanished = await runChatReview(box2.root, {
    reviewer: saboteur, maxSessions: 10, now: NOW, ownerEmail: null,
  });
  t.check(
    {
      reviewed: vanished.reviewed,
      missing: vanished.missingTranscripts,
      asked: saboteur.calls.map((c) => label(c.sessionId)),
    },
    {
    reviewed: 1,
    missing: 1,
    asked: [
      "sessfirst",
    ],
  },
  );

  // doctest:L338
  await box2.cleanup();
});

// ## A session that comes back to life mid-run is deferred, not summarized
//
// A run spans one model call per session, so a session that was quiet when
// discovery looked can be live again by the time its turn comes. Discovery's
// quiescence check covered a snapshot the reviewer no longer uses, so quiescence is
// re-checked against the file as it stands at review time.
//
// Here reviewing the first session appends to the second's transcript — the same
// thing a person typing into that chat would do.
void test("A run spans one model call per session, so a session that was quiet when disc...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L356
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
  for (const [sessionId, agoHours] of [["sessfirst", 40], ["sesslive", 20]] satisfies Array<[string, number]>) {
    await seed(box, { sessionId, husk: "", entries: [bulk(`${sessionId}1`), bulk(`${sessionId}2`)] });
    const when = new Date(NOW.getTime() - agoHours * HOUR);
    await utimes(getSessionLogPath(box.root, sid(sessionId)), when, when);
  }

  // doctest:L364
  const liveLog = getSessionLogPath(box.root, sid("sesslive"));
  const interruptedCalls: ReviewArgs[] = [];
  const interrupting: ChatReviewer & { calls: ReviewArgs[] } = {
    calls: interruptedCalls,
    async title(): Promise<TitleOutput> { throw new Error("unexpected title call"); },
    async review(args: ReviewArgs) {
      interruptedCalls.push(args);
      await appendFile(liveLog, JSON.stringify(bulk("typed-just-now")) + "\n");
      return OUTPUT;
    },
  };
  const summary = await runChatReview(box.root, {
    reviewer: interrupting, maxSessions: 10, now: NOW, ownerEmail: null,
  });
  t.check(
    {
      reviewed: summary.reviewed,
      deferredActive: summary.deferredActive,
      asked: interrupting.calls.map((c) => label(c.sessionId)),
    },
    {
    reviewed: 1,
    deferredActive: 1,
    asked: [
      "sessfirst",
    ],
  },
  );

  // The deferred session keeps its husk and its journal, so the next quiet night
  // reviews the whole conversation including the new material.

  // doctest:L390
  const state = await loadReviewState(box.root);
  t.check(
    {
      husk: (await readFile(box.path("_content/chat/web/2026-07-28_sesslive.chat.card"), "utf8")).includes("title:"),
      journal: sid("sesslive") in state.sessions,
    },
    {
    husk: false,
    journal: false,
  },
  );
});

// ## The husk body is never touched
//
// The account lives in a field, so prose the boxholder wrote in the body survives
// every pass.
void test("The account lives in a field, so prose the boxholder wrote in the body surviv...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L408
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
  const huskPath = await seed(box, {
    sessionId: "sessbody", husk: "", entries: [bulk("y1"), bulk("y2")],
  });
  await writeFile(box.path(huskPath),
    `---\nsession: ${sid("sessbody")}\n---\n\nMy own notes about this chat.\n`);

  // doctest:L416
  await runChatReview(box.root, {
    reviewer: fakeReviewer([OUTPUT]), maxSessions: 10, now: NOW, ownerEmail: null,
  });
  await t.checkText((await readFile(box.path(huskPath), "utf8")).includes("My own notes about this chat."), "true");
});
