// # Chat Review: a run end to end
//
// `src/core/chat/review/run/core.ts` walks the husks whose transcripts have grown,
// asks a reviewer for a title / `contains` / account, writes them to the husk, and
// advances the journal.
//
// The reviewer is behind an interface, so this exercises the whole pipeline with a
// scripted fake and no model.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { makeTmpBox, type TmpBox } from "../../../helpers/test-helpers.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import { runChatReview } from "../../../../src/core/chat/review/run/core.js";
import { loadReviewState } from "../../../../src/core/chat/review/state.js";
import type { ChatReviewer, ReviewArgs, ReviewOutput, TitleArgs, TitleOutput } from "../../../../src/core/chat/review/reviewer.js";
import { getSessionMetadata } from "../../../../src/cli/lib/session.js";

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

/** The husk as a review leaves it: fields in the order the writer emits them. */
function huskText(fields: { session: string; titleFirst?: boolean; span: string }, title: string): string {
  const body = `contains: Working through a repeated billing error and how to stop it.
contains-evidence: |-
  - decision: cancel the duplicate subscription
  - follow-up: check next month's statement
`;
  const head = `---\nsession: ${fields.session}\n`;
  const tail = `review-span: ${fields.span}\nfirst-message: ${"a".repeat(79)}…\n---`;
  return fields.titleFirst === true ? `${head}title: ${title}\n${body}${tail}` : `${head}${body}title: ${title}\n${tail}`;
}

/** The rendered form of a `bulk` entry. */
function bulkSpan(): string {
  return `**User** (2026-07-28T03:00:00Z)\n${"a".repeat(4000)}`;
}

const OUTPUT: ReviewOutput = {
  title: "Sorting out a recurring billing problem",
  contains: "Working through a repeated billing error and how to stop it.",
  notes: [
    { kind: "decision", text: "cancel the duplicate subscription" },
    { kind: "follow-up", text: "check next month's statement" },
  ],
};

// ## A qualifying session gets titled, summarized, and journalled
void test("A qualifying session gets titled, summarized, and journalled", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L127
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  // doctest:L130
  const huskPath = await seed(box, {
    sessionId: "sess1234",
    husk: "",
    entries: [bulk("u1"), userEntry("u2", "and another thing"), bulk("u3")],
  });

  // doctest:L136
  const reviewer = fakeReviewer([OUTPUT]);
  const summary = await runChatReview(box.root, {
    reviewer, maxSessions: 10, now: NOW, ownerEmail: null,
  });
  t.check(summary, {
    reviewed: 1, titled: 0, titlesKept: 0, alreadyApplied: 0, bootstrapped: 1, rewritten: 0, reviewerFailures: 0,
    sessionErrors: 0, exhausted: 0, rejected: [], missingTranscripts: 0, deferredActive: 0, belowThreshold: 0,
    belowTitleThreshold: 0, tooFewTurns: 0, foreignOrigin: 0, overflow: 0,
  });

  // The husk carries all four fields, and the reviewer was told this was a bootstrap
  // pass with no prior account.

  // doctest:L148
  const card = await readFile(box.path(huskPath), "utf8");
  t.checkText(card, huskText({ session: sid("sess1234"), span: "6bf738fa00192a0e" }, "Sorting out a recurring billing problem"));

  // doctest:L157
  t.check(reviewer.calls, [{
    sessionId: sid("sess1234"),
    currentTitle: null,
    currentAccount: null,
    span: `${bulkSpan()}\n\n---\n\n**User** (2026-07-28T03:00:00Z)\nand another thing\n\n---\n\n${bulkSpan()}`,
    bootstrap: true,
  }]);

  // ## Running again immediately does nothing
  //
  // The journal has advanced to the end of the transcript, so there is no new span
  // and no model call.

  // doctest:L167
  const second = fakeReviewer([OUTPUT]);
  const again = await runChatReview(box.root, {
    reviewer: second, maxSessions: 10, now: NOW, ownerEmail: null,
  });
  t.check({ again, calls: second.calls }, {
    again: {
      reviewed: 0, titled: 0, titlesKept: 0, alreadyApplied: 0, bootstrapped: 0, rewritten: 0, reviewerFailures: 0,
      sessionErrors: 0, exhausted: 0, rejected: [], missingTranscripts: 0, deferredActive: 0, belowThreshold: 0,
      belowTitleThreshold: 1, tooFewTurns: 0, foreignOrigin: 0, overflow: 0,
    },
    calls: [],
  });

  // ## Growth is an increment, and the previous account is the input

  // doctest:L178
  const logPath = getSessionLogPath(box.root, sid("sess1234"));
  const grown = [bulk("u1"), userEntry("u2", "and another thing"), bulk("u3"), bulk("u4"), bulk("u5")];
  await writeFile(logPath, grown.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const when = new Date(NOW.getTime() - 5 * HOUR);
  await utimes(logPath, when, when);

  // doctest:L184
  const third = fakeReviewer([{ ...OUTPUT, title: "" }]);
  await runChatReview(box.root, { reviewer: third, maxSessions: 10, now: NOW, ownerEmail: null });

  // doctest:L187
  t.check(third.calls[0], {
    sessionId: sid("sess1234"),
    currentTitle: "Sorting out a recurring billing problem",
    currentAccount: "- decision: cancel the duplicate subscription\n- follow-up: check next month's statement",
    span: `${bulkSpan()}\n\n---\n\n${bulkSpan()}`,
    bootstrap: false,
  });

  // An empty title means "keep the existing one", so it survives.

  // doctest:L201
  t.checkText(await readFile(box.path(huskPath), "utf8"), huskText({ session: sid("sess1234"), span: "64ffeea542992332" }, "Sorting out a recurring billing problem"));
});

// ## A hand-edited title is never overwritten again
//
// The review detects that the title no longer hashes to what it wrote, marks the
// field `manual`, and leaves it alone from then on — while still updating
// `contains` and the account.
void test("The review detects that the title no longer hashes to what it wrote, marks th...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L216
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
  const huskPath = await seed(box, {
    sessionId: "sess5678", husk: "", entries: [bulk("v1"), bulk("v2")],
  });

  // doctest:L222
  await runChatReview(box.root, {
    reviewer: fakeReviewer([OUTPUT]), maxSessions: 10, now: NOW, ownerEmail: null,
  });

  // doctest:L226
  // The boxholder retitles it by hand.
  const written = await readFile(box.path(huskPath), "utf8");
  await writeFile(box.path(huskPath),
    written.replace("title: Sorting out a recurring billing problem", "title: The Acme mess"));

  // doctest:L231
  // More conversation arrives.
  const logPath = getSessionLogPath(box.root, sid("sess5678"));
  await writeFile(logPath, [bulk("v1"), bulk("v2"), bulk("v3"), bulk("v4")].map((e) => JSON.stringify(e)).join("\n") + "\n");
  const when = new Date(NOW.getTime() - 5 * HOUR);
  await utimes(logPath, when, when);

  // doctest:L237
  await runChatReview(box.root, {
    reviewer: fakeReviewer([{ ...OUTPUT, title: "A completely different title" }]),
    maxSessions: 10, now: NOW, ownerEmail: null,
  });

  // doctest:L242
  const after = await readFile(box.path(huskPath), "utf8");
  t.checkText(after, huskText({ session: sid("sess5678"), span: "1adea253dc56352d" }, "The Acme mess"));

  // The ownership flag is recorded, so the decision survives a restart. The
  // title journal advances with the metadata journal even though the model
  // offered a replacement: a hand-owned title is reconciled by definition, so the
  // next short growth has nothing to ask about.

  // doctest:L253
  const state = await loadReviewState(box.root);
  const entry = state.sessions[sid("sess5678")];
  t.check(entry, {
    applied: {
      metadata: { spanId: "1adea253dc56352d", endUuid: "v4", endIndex: 3, prefixHash: "60703c3af6c5065a", at: NOW.toISOString() },
      title: { spanId: "1adea253dc56352d", endUuid: "v4", endIndex: 3, prefixHash: "60703c3af6c5065a", at: NOW.toISOString() },
    },
    titleOwner: "manual",
    titleHash: null,
    attempts: 0,
    titleAttempts: 0,
  });
});

// ## A title typed before the first review is not clobbered
//
// At first review there is no stored hash, but the husk may already carry a title:
// either the first-message snippet `ensureChatHusk` writes, or something the
// boxholder typed. They have to be told apart — the snippet is reproducible, so
// anything else is a person's.
void test("At first review there is no stored hash, but the husk may already carry a title:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L271
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
  const huskPath = await seed(box, {
    sessionId: "sesspre", husk: "title: Notes on the roof leak\n", entries: [bulk("p1"), bulk("p2")],
  });

  // doctest:L277
  await runChatReview(box.root, {
    reviewer: fakeReviewer([OUTPUT]), maxSessions: 10, now: NOW, ownerEmail: null,
  });
  const card = await readFile(box.path(huskPath), "utf8");
  t.checkText(card, huskText({ session: sid("sesspre"), span: "9b5cd26becaf6b27", titleFirst: true }, "Notes on the roof leak"));

  // The rest of the review still lands, and the field is marked `manual` from here on.

  // doctest:L288
  // doctest:L291
  t.check((await loadReviewState(box.root)).sessions[sid("sesspre")], {
    applied: {
      metadata: { spanId: "9b5cd26becaf6b27", endUuid: "p2", endIndex: 1, prefixHash: "0c87745b677be2fc", at: NOW.toISOString() },
      title: { spanId: "9b5cd26becaf6b27", endUuid: "p2", endIndex: 1, prefixHash: "0c87745b677be2fc", at: NOW.toISOString() },
    },
    titleOwner: "manual",
    titleHash: null,
    attempts: 0,
    titleAttempts: 0,
  });

  // An auto-set snippet title, by contrast, is ours to replace — otherwise the
  // feature could never improve the titles it exists to improve.

  // doctest:L299
  const box2 = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box2.path("claude-projects");
  const husk2 = await seed(box2, {
    sessionId: "sesssnip", husk: "", entries: [bulk("q1"), bulk("q2")],
  });

  // doctest:L305
  // The exact snippet ensureChatHusk would have written, derived the same way.
  const meta = await getSessionMetadata({
    sessionId: sid("sesssnip"),
    logPath: getSessionLogPath(box2.root, sid("sesssnip")),
    snippetMaxLen: 80,
  });
  await writeFile(box2.path(husk2),
    `---\nsession: ${sid("sesssnip")}\ntitle: ${meta.firstUserSnippet}\n---\n\n`);
  await runChatReview(box2.root, {
    reviewer: fakeReviewer([OUTPUT]), maxSessions: 10, now: NOW, ownerEmail: null,
  });
  t.checkText(await readFile(box2.path(husk2), "utf8"), huskText({ session: sid("sesssnip"), span: "0cd03e6cdee49df8", titleFirst: true }, "Sorting out a recurring billing problem"));

  // doctest:L319
  await box2.cleanup();
});
