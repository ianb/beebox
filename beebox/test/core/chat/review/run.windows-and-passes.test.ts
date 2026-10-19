// # Chat Review: windows, title pass, and metadata pass
//
// Continues [run.doctest.md](run.doctest.md). This part covers reviewing a long backlog in windows, short chats titled by the title pass, the metadata pass advancing both journals, empty "keep" failures, filling a missing `first-message`, hand-owned titles, and saving each session's journal before the next.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, anything, not } from "@ianbicking/tap-check/check";
import { appendFile, mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { makeTmpBox, type TmpBox } from "../../../helpers/test-helpers.js";
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

/** A run summary with every counter zero except `over`. */
function summaryOf(over: Partial<Awaited<ReturnType<typeof runChatReview>>>): Awaited<ReturnType<typeof runChatReview>> {
  return {
    reviewed: 0, titled: 0, titlesKept: 0, alreadyApplied: 0, bootstrapped: 0, rewritten: 0, reviewerFailures: 0,
    sessionErrors: 0, exhausted: 0, rejected: [], missingTranscripts: 0, deferredActive: 0, belowThreshold: 0,
    belowTitleThreshold: 0, tooFewTurns: 0, foreignOrigin: 0, overflow: 0,
    ...over,
  };
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
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  // First pass: a short transcript, reviewed and journalled normally.
  await seed(box, {
    sessionId: "sesscap", husk: "title: Untouched\n", entries: [bulk("cap-0"), bulk("cap-1")],
  });
  await runChatReview(box.root, {
    reviewer: fakeReviewer([OUTPUT]), maxSessions: 10, now: NOW, ownerEmail: null,
  });
  const journalled = (await loadReviewState(box.root)).sessions[sid("sesscap")]?.applied["metadata"];
  t.check(journalled, { spanId: "70635d195d2e82f2", endUuid: "cap-1", endIndex: 1, prefixHash: "a40308cc011e9448", at: NOW.toISOString() });

  // Then the transcript grows by more than a whole read window.

  const logPath = getSessionLogPath(box.root, sid("sesscap"));
  // The last ten are bulky so the leftover span clears the size gate on its own.
  const grown = Array.from({ length: MAX_SESSION_ENTRIES + 10 },
    (_, i) => i < MAX_SESSION_ENTRIES ? userEntry(`cap-${String(i + 2)}`, `line ${String(i)}`) : bulk(`cap-${String(i + 2)}`));
  await appendFile(logPath, grown.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const when = new Date(NOW.getTime() - 5 * HOUR);
  await utimes(logPath, when, when);

  const second = fakeReviewer([OUTPUT]);
  const summary = await runChatReview(box.root, {
    reviewer: second, maxSessions: 10, now: NOW, ownerEmail: null,
  });
  const advanced = (await loadReviewState(box.root)).sessions[sid("sesscap")]?.applied["metadata"];
  t.check({ summary, advanced }, {
    summary: summaryOf({ reviewed: 1 }),
    advanced: { spanId: "6b43c80f6e94e649", endUuid: "cap-5001", endIndex: 5001, prefixHash: "a84b325c64a34730", at: NOW.toISOString() },
  });

  // The reviewer saw only the new material, and the remaining ten entries are the
  // next run's span — which in turn continues from `cap-5001`, not from the top.

  // The span is 5,000 generated lines plus a tail; the two narrow checks keep it readable.
  t.check(second.calls[0]?.span, any(String).includes("line 0"));
  t.check(second.calls[0]?.span, not(any(String).includes("aaaa")));

  const third = fakeReviewer([OUTPUT]);
  const again = await runChatReview(box.root, {
    reviewer: third, maxSessions: 10, now: NOW, ownerEmail: null,
  });
  const final = (await loadReviewState(box.root)).sessions[sid("sesscap")]?.applied["metadata"];
  t.check({ again, final }, {
    again: summaryOf({ reviewed: 1 }),
    final: { spanId: "7d31fb73a3315f37", endUuid: "cap-5011", endIndex: 5011, prefixHash: "d2a5b92180da74d3", at: NOW.toISOString() },
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
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  const huskPath = await seed(box, {
    sessionId: "sessshort",
    husk: "",
    entries: [smallTalk("h1"), smallTalk("h2")],
  });

  const reviewer = fakeReviewer(
    [new Error("the metadata pass must not run")],
    [{ title: "Planning a small birthday dinner" }],
  );
  const summary = await runChatReview(box.root, {
    reviewer, maxSessions: 10, now: NOW, ownerEmail: null,
  });
  t.check({ summary, reviewCalls: reviewer.calls, titleCalls: reviewer.titleCalls }, {
    summary: summaryOf({ titled: 1, belowThreshold: 1 }),
    reviewCalls: [],
    titleCalls: [{ sessionId: sid("sessshort"), currentTitle: null, span: any(String) }],
  });

  const card = await readFile(box.path(huskPath), "utf8");
  t.checkText(card, `---
session: ${sid("sessshort")}
title: Planning a small birthday dinner
first-message: please help me plan a small birthday dinner for saturday, eight people, one veg…
---`);

  const state = await loadReviewState(box.root);
  const entry = state.sessions[sid("sessshort")]?.applied;
  t.check(entry, { title: { spanId: "87c445c3e179cdce", endUuid: "h2", endIndex: 1, prefixHash: "b4cc4988165ea963", at: NOW.toISOString() } });

  // The same span asks nothing the second night — the title journal has advanced.

  const second = fakeReviewer([], [{ title: "Should not be needed" }]);
  const again = await runChatReview(box.root, {
    reviewer: second, maxSessions: 10, now: NOW, ownerEmail: null,
  });
  t.check({ again, calls: second.titleCalls }, { again: summaryOf({ belowTitleThreshold: 1 }), calls: [] });
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
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  await seed(box, {
    sessionId: "sessboth",
    husk: "",
    entries: [bulk("k1"), userEntry("k2", "and another thing"), bulk("k3")],
  });

  await runChatReview(box.root, {
    reviewer: fakeReviewer([OUTPUT]), maxSessions: 10, now: NOW, ownerEmail: null,
  });

  const state = await loadReviewState(box.root);
  const applied = state.sessions[sid("sessboth")]?.applied;
  const boundary = { spanId: "765ceb0227a4a499", endUuid: "k3", endIndex: 2, prefixHash: "93cf99a7230ded9f", at: NOW.toISOString() };
  t.check(applied, { metadata: boundary, title: boundary });

  // Short growth afterwards goes to the TITLE pass only — the summary journal is
  // ahead of it now.

  const logPath = getSessionLogPath(box.root, sid("sessboth"));
  const grown = [bulk("k1"), userEntry("k2", "and another thing"), bulk("k3"), smallTalk("k4"), smallTalk("k5")];
  await writeFile(logPath, grown.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const when = new Date(NOW.getTime() - 5 * HOUR);
  await utimes(logPath, when, when);

  const reviewer = fakeReviewer(
    [new Error("the metadata pass must not run")],
    [{ title: "" }],  // "keep": the billing title still fits the dinner addendum's absence
  );
  await runChatReview(box.root, {
    reviewer, maxSessions: 10, now: NOW, ownerEmail: null,
  });
  t.check({ reviewCalls: reviewer.calls, titleCalls: reviewer.titleCalls }, {
    reviewCalls: [],
    titleCalls: [anything()],
  });

  const after = await loadReviewState(box.root);
  t.check(after.sessions[sid("sessboth")]?.applied["title"], { spanId: any(String), endUuid: "k5", endIndex: 4, prefixHash: any(String), at: NOW.toISOString() });
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
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  const huskPath = await seed(box, {
    sessionId: "sessempty",
    husk: "",
    entries: [smallTalk("e1"), smallTalk("e2")],
  });

  const reviewer = fakeReviewer([], [{ title: "" }]);
  const summary = await runChatReview(box.root, {
    reviewer, maxSessions: 10, now: NOW, ownerEmail: null,
  });
  t.check(summary, summaryOf({ reviewerFailures: 1, belowThreshold: 1 }));

  const state = await loadReviewState(box.root);
  t.check(state.sessions[sid("sessempty")], {
    applied: {}, titleOwner: "unmanaged", titleHash: null, attempts: 0, titleAttempts: 1, titleFailedSpanId: "e76fa8c3a941634e",
  });

  // Nothing was written to the card.
  t.checkText(await readFile(box.path(huskPath), "utf8"), `---\nsession: ${sid("sessempty")}\n---`);
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
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  const huskPath = await seed(box, {
    sessionId: "sessfill",
    husk: "",
    entries: [smallTalk("f1"), smallTalk("f2")],
  });

  await runChatReview(box.root, {
    reviewer: fakeReviewer([], [{ title: "Planning a small birthday dinner" }]),
    maxSessions: 10, now: NOW, ownerEmail: null,
  });

  t.checkText(await readFile(box.path(huskPath), "utf8"), `---
session: ${sid("sessfill")}
title: Planning a small birthday dinner
first-message: please help me plan a small birthday dinner for saturday, eight people, one veg…
---`);
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
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  const huskPath = await seed(box, {
    sessionId: "sesshand",
    husk: "title: Notes on the roof leak\n",
    entries: [smallTalk("m1"), smallTalk("m2")],
  });

  const reviewer = fakeReviewer([], [{ title: "Must not be written" }]);
  const summary = await runChatReview(box.root, {
    reviewer, maxSessions: 10, now: NOW, ownerEmail: null,
  });
  t.check({ summary, calls: reviewer.titleCalls }, { summary: summaryOf({ belowThreshold: 1 }), calls: [] });

  const state = await loadReviewState(box.root);
  t.check(state.sessions[sid("sesshand")]?.applied["title"], { spanId: "9f14db44b15ae759", endUuid: "m2", endIndex: 1, prefixHash: "fc5024188147b92e", at: NOW.toISOString() });

  t.checkText(await readFile(box.path(huskPath), "utf8"), `---\nsession: ${sid("sesshand")}\ntitle: Notes on the roof leak\n---`);
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
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  // Oldest first: sessfirst is reviewed before sesssecond.
  await seed(box, { sessionId: "sessfirst", husk: "", entries: [smallTalk("p1"), smallTalk("p2")] });
  await utimes(getSessionLogPath(box.root, sid("sessfirst")), new Date(NOW.getTime() - 9 * HOUR), new Date(NOW.getTime() - 9 * HOUR));
  await seed(box, { sessionId: "sesssecond", husk: "", entries: [smallTalk("q1"), smallTalk("q2")] });

  const seen: { onDisk?: { owner: unknown; title: unknown } } = {};
  const reviewer = {
    async review() { throw new Error("must not run"); },
    async title(args: TitleArgs) {
      if (args.sessionId === sid("sesssecond")) {
        const onDisk = JSON.parse(await readFile(box.path(".beebox/chat-review/state.json"), "utf8"));
        const first = onDisk.sessions[sid("sessfirst")];
        seen.onDisk = { owner: first?.titleOwner, title: first?.applied?.["title"]?.endUuid };
      }
      return { title: args.sessionId === sid("sessfirst") ? "Planning a small birthday dinner" : "Another small plan" };
    },
  };
  await runChatReview(box.root, { reviewer, maxSessions: 10, now: NOW, ownerEmail: null });
  t.check(seen, { onDisk: { owner: "generated", title: "p2" } });
});
