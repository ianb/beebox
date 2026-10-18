// # Chat Review: windows, title pass, and metadata pass
//
// Continues [run.doctest.md](run.doctest.md). This part covers reviewing a long backlog in windows, short chats titled by the title pass, the metadata pass advancing both journals, empty "keep" failures, filling a missing `first-message`, hand-owned titles, and saving each session's journal before the next.

import { test } from "tap";
import "agent-doctest/tap";
import { appendFile, mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { makeTmpBox, type TmpBox } from "../../../helpers/doctest-helpers.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import { runChatReview } from "../../../../src/core/chat/review/run/core.js";
import { loadReviewState } from "../../../../src/core/chat/review/state.js";
import type { ChatReviewer, ReviewArgs, ReviewOutput, TitleArgs, TitleOutput } from "../../../../src/core/chat/review/reviewer.js";
import { MAX_SESSION_ENTRIES } from "../../../../src/cli/lib/session.js";

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
 * the name is only a convention.
 */
function sid(name: string): string {
  const h = createHash("sha256").update(name).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
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

/** Enough rendered text to clear the 400-char title gate, not the summary gate. */
function smallTalk(uuid: string) {
  return userEntry(uuid, "please help me plan a small birthday dinner for saturday, eight people, one vegetarian. ".repeat(4));
}

const OUTPUT: ReviewOutput = {
  title: "Sorting out a recurring billing problem",
  contains: "Working through a repeated billing error and how to stop it.",
  notes: [
    { kind: "decision", text: "cancel the duplicate subscription" },
    { kind: "follow-up", text: "check next month's statement" },
  ],
};

// ## A boundary past the first page is found, and a long backlog is reviewed in windows
//
// Nothing before the journal boundary is retained — the span walk streams the
// transcript in pages and folds the prefix hash as it goes — so a session that
// grew past `MAX_SESSION_ENTRIES` since its last review still continues from its
// real boundary. What comes back is bounded too: one run folds in at most
// `MAX_SESSION_ENTRIES` new entries and advances the journal that far; the next
// run picks up the rest. No run ever moves the journal backwards.
void test("Nothing before the journal boundary is retained — the span walk streams the t...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L134
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  // doctest:L137
  // First pass: a short transcript, reviewed and journalled normally.
  await seed(box, {
    sessionId: "sesscap", husk: "title: Untouched\n", entries: [bulk("cap-0"), bulk("cap-1")],
  });
  await runChatReview(box.root, {
    reviewer: fakeReviewer([OUTPUT]), maxSessions: 10, now: NOW, ownerEmail: null,
  });
  const journalled = (await loadReviewState(box.root)).sessions[sid("sesscap")]?.applied["metadata"];
  t.check({ endUuid: journalled?.endUuid, endIndex: journalled?.endIndex }, {
    endUuid: "cap-1",
    endIndex: 1,
  });

  // Then the transcript grows by more than a whole read window.

  // doctest:L152
  const logPath = getSessionLogPath(box.root, sid("sesscap"));
  // The last ten are bulky so the leftover span clears the size gate on its own.
  const grown = Array.from({ length: MAX_SESSION_ENTRIES + 10 },
    (_, i) => i < MAX_SESSION_ENTRIES ? userEntry(`cap-${String(i + 2)}`, `line ${String(i)}`) : bulk(`cap-${String(i + 2)}`));
  await appendFile(logPath, grown.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const when = new Date(NOW.getTime() - 5 * HOUR);
  await utimes(logPath, when, when);

  // doctest:L160
  const second = fakeReviewer([OUTPUT]);
  const summary = await runChatReview(box.root, {
    reviewer: second, maxSessions: 10, now: NOW, ownerEmail: null,
  });
  const advanced = (await loadReviewState(box.root)).sessions[sid("sesscap")]?.applied["metadata"];
  t.check(
    {
      reviewed: summary.reviewed,
      bootstrapped: summary.bootstrapped,
      endUuid: advanced?.endUuid,
      endIndex: advanced?.endIndex,
    },
    {
    reviewed: 1,
    bootstrapped: 0,
    endUuid: "cap-5001",
    endIndex: 5001,
  },
  );

  // The reviewer saw only the new material, and the remaining ten entries are the
  // next run's span — which in turn continues from `cap-5001`, not from the top.

  // doctest:L178
  await t.checkText(second.calls[0]?.span.includes("line 0") && !second.calls[0]?.span.includes("aaaa"), "true");

  // doctest:L181
  const third = fakeReviewer([OUTPUT]);
  const again = await runChatReview(box.root, {
    reviewer: third, maxSessions: 10, now: NOW, ownerEmail: null,
  });
  const final = (await loadReviewState(box.root)).sessions[sid("sesscap")]?.applied["metadata"];
  t.check({ bootstrapped: again.bootstrapped, endUuid: final?.endUuid, endIndex: final?.endIndex }, {
    bootstrapped: 0,
    endUuid: "cap-5011",
    endIndex: 5011,
  });
});

// \n
// ## A short chat is titled by the title pass, not summarized
//
// Two exchanges clear the 400-char title gate but not the 6,000-char summary
// gate, so the run asks only for a title: `review` is never called, no
// `contains` or account is written, and the journal records the `title`
// consumer alone.
void test("\\n Two exchanges clear the 400-char title gate but not the 6,000-char summary...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L202
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  // doctest:L205
  const huskPath = await seed(box, {
    sessionId: "sessshort",
    husk: "",
    entries: [smallTalk("h1"), smallTalk("h2")],
  });

  // doctest:L211
  const reviewer = fakeReviewer(
    [new Error("the metadata pass must not run")],
    [{ title: "Planning a small birthday dinner" }],
  );
  const summary = await runChatReview(box.root, {
    reviewer, maxSessions: 10, now: NOW, ownerEmail: null,
  });
  t.check(
    {
      titled: summary.titled,
      reviewed: summary.reviewed,
      reviewCalls: reviewer.calls.length,
      titleCalls: reviewer.titleCalls.length,
    },
    {
    titled: 1,
    reviewed: 0,
    reviewCalls: 0,
    titleCalls: 1,
  },
  );

  // doctest:L226
  const card = await readFile(box.path(huskPath), "utf8");
  t.check([card.includes("title: Planning a small birthday dinner"), card.includes("contains:"), card.includes("contains-evidence:"), card.includes("review-span:")].join(","), "true,false,false,false");

  // doctest:L230
  const state = await loadReviewState(box.root);
  const entry = state.sessions[sid("sessshort")]?.applied;
  t.check({ consumers: Object.keys(entry ?? {}).toSorted(), end: entry?.["title"]?.endUuid }, {
    consumers: [
      "title",
    ],
    end: "h2",
  });

  // The same span asks nothing the second night — the title journal has advanced.

  // doctest:L239
  const second = fakeReviewer([], [{ title: "Should not be needed" }]);
  const again = await runChatReview(box.root, {
    reviewer: second, maxSessions: 10, now: NOW, ownerEmail: null,
  });
  t.check({ titled: again.titled, calls: second.titleCalls.length }, {
    titled: 0,
    calls: 0,
  });
});

// ## A metadata pass advances both journals
//
// Summary-sized growth runs the full review, and its title decision covers the
// same span — the cheap gate should not re-ask about material the account pass
// just read.
void test("Summary-sized growth runs the full review, and its title decision covers the...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L258
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  // doctest:L261
  await seed(box, {
    sessionId: "sessboth",
    husk: "",
    entries: [bulk("k1"), userEntry("k2", "and another thing"), bulk("k3")],
  });

  // doctest:L267
  await runChatReview(box.root, {
    reviewer: fakeReviewer([OUTPUT]), maxSessions: 10, now: NOW, ownerEmail: null,
  });

  // doctest:L271
  const state = await loadReviewState(box.root);
  const applied = state.sessions[sid("sessboth")]?.applied;
  t.check(
    {
      consumers: Object.keys(applied ?? {}).toSorted(),
      sameBoundary: applied?.["metadata"]?.endUuid === applied?.["title"]?.endUuid,
    },
    {
    consumers: [
      "metadata",
      "title",
    ],
    sameBoundary: true,
  },
  );

  // Short growth afterwards goes to the TITLE pass only — the summary journal is
  // ahead of it now.

  // doctest:L284
  const logPath = getSessionLogPath(box.root, sid("sessboth"));
  const grown = [bulk("k1"), userEntry("k2", "and another thing"), bulk("k3"), smallTalk("k4"), smallTalk("k5")];
  await writeFile(logPath, grown.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const when = new Date(NOW.getTime() - 5 * HOUR);
  await utimes(logPath, when, when);

  // doctest:L290
  const reviewer = fakeReviewer(
    [new Error("the metadata pass must not run")],
    [{ title: "" }],  // "keep": the billing title still fits the dinner addendum's absence
  );
  await runChatReview(box.root, {
    reviewer, maxSessions: 10, now: NOW, ownerEmail: null,
  });
  t.check({ reviewCalls: reviewer.calls.length, titleCalls: reviewer.titleCalls.length }, {
    reviewCalls: 0,
    titleCalls: 1,
  });

  // doctest:L300
  const after = await loadReviewState(box.root);
  t.check(after.sessions[sid("sessboth")]?.applied["title"]?.endUuid, "k5");
});

// ## "Keep" with nothing to keep is a failure
//
// A title pass that answers empty against a chat with NO title reconciled
// nothing — counting it a no-op would mark the chat title-seen and leave it
// untitled forever. It is a failure instead: retried the next night.
void test("A title pass that answers empty against a chat with NO title reconciled nothi...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L316
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  // doctest:L319
  const huskPath = await seed(box, {
    sessionId: "sessempty",
    husk: "",
    entries: [smallTalk("e1"), smallTalk("e2")],
  });

  // doctest:L325
  const reviewer = fakeReviewer([], [{ title: "" }]);
  const summary = await runChatReview(box.root, {
    reviewer, maxSessions: 10, now: NOW, ownerEmail: null,
  });
  t.check(summary.reviewerFailures, 1);

  // doctest:L332
  const state = await loadReviewState(box.root);
  t.check(
    {
      applied: Object.keys(state.sessions[sid("sessempty")]?.applied ?? {}),
      titleAttempts: state.sessions[sid("sessempty")]?.titleAttempts,
    },
    {
    applied: [],
    titleAttempts: 1,
  },
  );

  // doctest:L339
  await t.checkText(
    // Nothing was written to the card.
    (await readFile(box.path(huskPath), "utf8")).includes("title:"),
    "false",
  );
});

// ## A pass fills a missing `first-message`
//
// A coined-id chat's husk is created before its transcript exists, so creation
// cannot write the opening snippet; every pass fills it when absent. It is the
// person's own opening message, not model output — no leak scan, and it renders
// quoted in lists.
void test("A coined-id chat's husk is created before its transcript exists, so creation...", async (t) => {
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

  // doctest:L359
  const huskPath = await seed(box, {
    sessionId: "sessfill",
    husk: "",
    entries: [smallTalk("f1"), smallTalk("f2")],
  });

  // doctest:L365
  await runChatReview(box.root, {
    reviewer: fakeReviewer([], [{ title: "Planning a small birthday dinner" }]),
    maxSessions: 10, now: NOW, ownerEmail: null,
  });

  // doctest:L370
  await t.checkText((await readFile(box.path(huskPath), "utf8")).includes("first-message: please help me plan a small birthday dinner"), "true");
});

// ## A hand-owned title costs nothing on the title pass
//
// `titleOwner: manual` is permanent hands-off. The hand that owns the title owns
// its freshness: no model call, no Jev call — only the journal advances.
void test("titleOwner:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L384
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  // doctest:L387
  const huskPath = await seed(box, {
    sessionId: "sesshand",
    husk: "title: Notes on the roof leak\n",
    entries: [smallTalk("m1"), smallTalk("m2")],
  });

  // doctest:L393
  const reviewer = fakeReviewer([], [{ title: "Must not be written" }]);
  const summary = await runChatReview(box.root, {
    reviewer, maxSessions: 10, now: NOW, ownerEmail: null,
  });
  t.check({ titled: summary.titled, calls: reviewer.titleCalls.length }, {
    titled: 0,
    calls: 0,
  });

  // doctest:L400
  const state = await loadReviewState(box.root);
  t.check(state.sessions[sid("sesshand")]?.applied["title"]?.endUuid, "m2");

  // doctest:L404
  await t.checkText((await readFile(box.path(huskPath), "utf8")).includes("title: Notes on the roof leak"), "true");
});

// ## Each session's journal is saved before the next one starts
//
// A run spans many model calls, and a process killed mid-run (a deploy restart)
// used to lose every journal advance the run had earned, because state was
// saved once at the end. Worse, the replay read a title this pass had written,
// with no stored hash, as a hand edit, and left it alone for good. State is now
// saved after every session. Here the second session's reviewer looks at the
// state file on disk while the run is still going.
void test("A run spans many model calls, and a process killed mid-run (a deploy restart)...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L422
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  // doctest:L425
  // Oldest first: sessfirst is reviewed before sesssecond.
  await seed(box, { sessionId: "sessfirst", husk: "", entries: [smallTalk("p1"), smallTalk("p2")] });
  await utimes(getSessionLogPath(box.root, sid("sessfirst")), new Date(NOW.getTime() - 9 * HOUR), new Date(NOW.getTime() - 9 * HOUR));
  await seed(box, { sessionId: "sesssecond", husk: "", entries: [smallTalk("q1"), smallTalk("q2")] });

  // doctest:L430
  let seenOnDisk = null;
  const reviewer = {
    async review() { throw new Error("must not run"); },
    async title(args: TitleArgs) {
      if (args.sessionId === sid("sesssecond")) {
        const onDisk = JSON.parse(await readFile(box.path(".beebox/chat-review/state.json"), "utf8"));
        const first = onDisk.sessions[sid("sessfirst")];
        seenOnDisk = { owner: first?.titleOwner, title: first?.applied?.["title"]?.endUuid };
      }
      return { title: args.sessionId === sid("sessfirst") ? "Planning a small birthday dinner" : "Another small plan" };
    },
  };
  await runChatReview(box.root, { reviewer, maxSessions: 10, now: NOW, ownerEmail: null });
  await t.checkText(seenOnDisk, "{ owner: \"generated\", title: \"p2\" }");
});
