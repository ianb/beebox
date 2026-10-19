// # Chat Review: what discovery hands on
//
// `src/core/chat/review/discovery.ts` decides which husks are worth reviewing
// tonight. It has to parse each transcript to answer that — but it must not *keep*
// what it parsed.
//
// Discovery holds every qualified session at once and `runChatReview` caps the run
// only afterwards, so a retained transcript array per session is N × 5000 fat
// `SessionEntry` objects resident simultaneously (whole `tool_use.input` bodies,
// base64 image payloads) — the allocation class that OOM'd `bbx serve`. A
// `QualifiedSession` is therefore scalars only.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import assert from "node:assert/strict";
import { makeTmpBox, type TmpBox } from "../../../helpers/test-helpers.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import {
  discoverSessions,
  readSessionWindow,
  QUIESCENCE_MS,
} from "../../../../src/core/chat/review/discovery.js";
import { loadReviewState, saveReviewState } from "../../../../src/core/chat/review/state.js";
import { MAX_SESSION_ENTRIES, parseSessionLog } from "../../../../src/cli/lib/session.js";
import { prefixHash } from "../../../../src/core/chat/review/span.js";

// Pin this machine's origin id to a file under the tmp box, so a test run
// neither reads nor mints the real `~/.local/share/beebox/origin-id`.
const LOCAL_ORIGIN = "11111111-2222-4333-8444-555555555555";
const FOREIGN_ORIGIN = "99999999-8888-4777-8666-555555555555";

const NOW = new Date("2026-07-28T12:00:00Z");
const HOUR = 60 * 60 * 1000;

function userEntry(uuid: string, text: string) {
  return {
    type: "user",
    uuid,
    timestamp: "2026-07-28T03:00:00Z",
    message: { role: "user", content: [{ type: "text", text }] },
  };
}

/** Enough rendered text to clear REVIEW_CHAR_THRESHOLD on its own. */
function bulk(uuid: string) {
  return userEntry(uuid, "a".repeat(4000));
}

/**
 * Seed a husk plus a transcript whose mtime is `agoHours` old. `origin` is
 * omitted by default — a pre-Track-2 husk, which discovery claims on the
 * strength of the transcript being here.
 */
async function seed(box: TmpBox, opts: { sessionId: string; entries: object[]; agoHours: number; origin?: string }) {
  const originLine = opts.origin === undefined ? "" : `origin: ${opts.origin}\n`;
  await box.write(`_content/chat/web/2026-07-28_${opts.sessionId}.chat.card`,
    `---\nsession: ${opts.sessionId}\n${originLine}---\n\n`);
  const logPath = getSessionLogPath(box.root, opts.sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, opts.entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const when = new Date(NOW.getTime() - opts.agoHours * HOUR);
  await utimes(logPath, when, when);
}

/** The qualified session a two-`bulk` transcript seeded `agoHours` ago discovers as. */
function bulkSession(box: TmpBox, { sessionId, agoHours }: { sessionId: string; agoHours: number }) {
  return {
    sessionId,
    huskPath: `_content/chat/web/2026-07-28_${sessionId}.chat.card`,
    logPath: getSessionLogPath(box.root, sessionId),
    mtime: new Date(NOW.getTime() - agoHours * HOUR),
    spanChars: 8071,
    bootstrap: "no-journal" as const,
    needsMetadata: true,
    titleSpanChars: 8071,
    titleBootstrap: "no-journal" as const,
    snippetTitle: `${"a".repeat(79)}…`,
    userTurns: 2,
  };
}

async function discover(box: TmpBox) {
  await writeFile(box.path("origin-id"), `${LOCAL_ORIGIN}\n`);
  process.env["BBX_ORIGIN_ID_FILE"] = box.path("origin-id");
  return discoverSessions(box.root, {
    now: NOW,
    quiescenceMs: QUIESCENCE_MS,
    state: await loadReviewState(box.root),
  });
}

// ## A qualified session is scalars — no parsed transcript rides along
void test("A qualified session is scalars — no parsed transcript rides along", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  await seed(box, { sessionId: "sessone", entries: [bulk("a1"), bulk("a2")], agoHours: 5 });
  const result = await discover(box);
  const session = result.qualified[0];
  assert.ok(session);

  // The whole session is scalars. `entries` and `span` are the regression: retaining
  // either one restores the peak this shape exists to remove, and the exact key set
  // below keeps them out. The scalars the reviewer and `--dry-run` actually need
  // survive: how much new material there is, and whether the span continues the
  // journal or restarts it.
  t.check(session, bulkSession(box, { sessionId: "sessone", agoHours: 5 }));

  // ## The window is re-read on demand, from the same journal
  //
  // `readSessionWindow` is how the reviewer gets the entries back. Discovery
  // measured `spanChars` from exactly this, so the two agree.

  const window = await readSessionWindow({
    sessionId: "sessone",
    logPath: session.logPath,
    state: await loadReviewState(box.root),
    consumer: "metadata",
  });
  assert.ok(window);
  t.check(
    { ...window, entries: window.entries.map((e) => e.uuid) },
    { entries: ["a1", "a2"], endIndex: 1, endPrefixHash: "768efaf0fa6038d4", bootstrap: "no-journal", clipped: false },
  );

  // A husk whose transcript is gone reads as null rather than throwing.

  t.check(
    await readSessionWindow({
      sessionId: "nosuch",
      logPath: box.path("claude-projects/nosuch.jsonl"),
      state: await loadReviewState(box.root),
      consumer: "metadata",
    }),
    null,
  );
});

// ## The gates are unchanged
//
// Dropping the arrays did not move any threshold. A short session is below the
// char threshold, a single-turn session has too few turns, a transcript touched
// within the quiescence window is deferred, and a husk with no transcript at all
// is counted separately.
void test("Dropping the arrays did not move any threshold.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  await seed(box, { sessionId: "sessbig", entries: [bulk("b1"), bulk("b2")], agoHours: 5 });
  await seed(box, {
    sessionId: "sesssmall",
    entries: [userEntry("s1", "hi"), userEntry("s2", "there")],
    agoHours: 5,
  });
  await seed(box, { sessionId: "sessone1", entries: [bulk("o1")], agoHours: 5 });
  await seed(box, { sessionId: "sessnow", entries: [bulk("n1"), bulk("n2")], agoHours: 0 });
  await box.write("_content/chat/web/2026-07-28_sessgone.chat.card", "---\nsession: sessgone\n---\n\n");

  const result = await discover(box);
  t.check(result, {
    qualified: [bulkSession(box, { sessionId: "sessbig", agoHours: 5 })],
    deferredActive: ["sessnow"],
    belowTitleThreshold: 1,
    titleOnly: 0,
    belowThreshold: 0,
    tooFewTurns: 1,
    missingTranscripts: 1,
    foreignOrigin: 0,
  });

  // ## Qualified sessions come back oldest first
  //
  // The run cap is applied to this order, so the longest-neglected session is the
  // one a capped night makes progress on.

  await seed(box, { sessionId: "sessold", entries: [bulk("d1"), bulk("d2")], agoHours: 40 });
  await seed(box, { sessionId: "sessmid", entries: [bulk("m1"), bulk("m2")], agoHours: 20 });

  t.check(await discover(box), {
    qualified: [
      bulkSession(box, { sessionId: "sessold", agoHours: 40 }),
      bulkSession(box, { sessionId: "sessmid", agoHours: 20 }),
      bulkSession(box, { sessionId: "sessbig", agoHours: 5 }),
    ],
    deferredActive: ["sessnow"],
    belowTitleThreshold: 1,
    titleOnly: 0,
    belowThreshold: 0,
    tooFewTurns: 1,
    missingTranscripts: 1,
    foreignOrigin: 0,
  });
});

// ## Review is claimed by origin
//
// A session's transcript lives on one machine, and that machine is the only one
// that can see the whole conversation — so a husk stamped with another machine's
// `origin` is skipped here even when a transcript for that id happens to sit in
// this checkout's engine store. It is counted, never named.
void test("A session's transcript lives on one machine, and that machine is the only one...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  await seed(box, { sessionId: "sessmine", entries: [bulk("m1"), bulk("m2")], agoHours: 5, origin: LOCAL_ORIGIN });
  await seed(box, { sessionId: "sesstheirs", entries: [bulk("t1"), bulk("t2")], agoHours: 5, origin: FOREIGN_ORIGIN });
  await seed(box, { sessionId: "sessunset", entries: [bulk("u1"), bulk("u2")], agoHours: 5 });

  const result = await discover(box);
  // The foreign husk's transcript is never opened, so a session that ran elsewhere
  // costs nothing to skip — it is turned away before the stat.
  t.check(result, {
    qualified: [
      bulkSession(box, { sessionId: "sessmine", agoHours: 5 }),
      bulkSession(box, { sessionId: "sessunset", agoHours: 5 }),
    ],
    deferredActive: [],
    belowTitleThreshold: 0,
    titleOnly: 0,
    belowThreshold: 0,
    tooFewTurns: 0,
    missingTranscripts: 0,
    foreignOrigin: 1,
  });
});

// ## A boundary past the first page is still found; the span is bounded
//
// The span walk streams the transcript in pages, so a session that grew past
// `MAX_SESSION_ENTRIES` since its last review continues from its real boundary
// rather than bootstrapping over it. What it hands on is capped at one window of
// new entries (`clipped`), with the rest left for a later run.
void test("The span walk streams the transcript in pages, so a session that grew past MA...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  const overCap = Array.from({ length: MAX_SESSION_ENTRIES + 10 },
    (_, i) => userEntry(`cap-${String(i)}`, `line ${String(i)}`));
  await seed(box, { sessionId: "sesscap", entries: overCap, agoHours: 5 });

  // A journal whose boundary sits at index 3 — computed over the parsed prefix,
  // exactly as a prior run would have recorded it.
  const parsed = await parseSessionLog({
    logPath: getSessionLogPath(box.root, "sesscap"),
    slice: { mode: "page", offset: 0, limit: 4 },
  });
  await saveReviewState(box.root, {
    lastRunAt: null,
    sessions: {
      sesscap: {
        applied: {
          metadata: {
            spanId: "prior-span",
            endUuid: "cap-3",
            endIndex: 3,
            prefixHash: prefixHash(parsed.entries, 3),
            at: "2026-07-27T12:00:00Z",
          },
        },
        titleOwner: "unmanaged",
        titleHash: null,
        attempts: 0,
      },
    },
  });

  const window = await readSessionWindow({
    sessionId: "sesscap",
    logPath: getSessionLogPath(box.root, "sesscap"),
    state: await loadReviewState(box.root),
    consumer: "metadata",
  });
  assert.ok(window);
  const { entries: spanEntries, ...spanRest } = window;
  t.check(spanRest, { endIndex: 5003, endPrefixHash: any(String), bootstrap: null, clipped: true });
  t.check(
    spanEntries.map((e) => e.uuid),
    Array.from({ length: 5000 }, (_, i) => `cap-${String(i + 4)}`),
  );

  // The journal hash for the new boundary covers the whole prefix, not just the
  // window — so the next run's walk verifies against it.

  const logPath = getSessionLogPath(box.root, "sesscap");
  const head = await parseSessionLog({ logPath, slice: { mode: "page", offset: 0, limit: MAX_SESSION_ENTRIES } });
  const tail = await parseSessionLog({ logPath, slice: { mode: "page", offset: MAX_SESSION_ENTRIES, limit: 4 } });
  t.check(window.endPrefixHash, prefixHash([...head.entries, ...tail.entries], 5003));
});

// ## A short chat qualifies for the title pass, not the summary pass
//
// Titling is decoupled from the summary gate: a couple of exchanges (2 turns,
// ~500 chars) clears the 400-char title threshold but not the 6,000-char summary
// threshold, so the session is `qualified` with `needsMetadata: false` and the
// run titles it without paying for an account
// (`docs/implemented-plans/chat-titles.md` § Track A).
void test("Titling is decoupled from the summary gate:", async (t) => {
  t.teardown(async () => {
    try {
      await tbox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const tbox = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = tbox.path("claude-projects");

  await seed(tbox, {
    sessionId: "sesschat",
    entries: [
      userEntry("t1", "please help me plan a small birthday dinner for saturday. ".repeat(8)),
      userEntry("t2", "eight people, one vegetarian, nothing fancy — what should I make? ".repeat(8)),
    ],
    agoHours: 5,
  });
  const result = await discover(tbox);
  const session = result.qualified[0];
  assert.ok(session);
  t.check(session, {
    sessionId: "sesschat",
    huskPath: "_content/chat/web/2026-07-28_sesschat.chat.card",
    logPath: getSessionLogPath(tbox.root, "sesschat"),
    mtime: new Date(NOW.getTime() - 5 * HOUR),
    spanChars: 1061,
    bootstrap: "no-journal",
    needsMetadata: false,
    titleSpanChars: 1061,
    titleBootstrap: "no-journal",
    snippetTitle: "please help me plan a small birthday dinner for saturday. please help me plan a…",
    userTurns: 2,
  });
});
