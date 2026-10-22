// # Self-notes
//
// Tests for agent-authored self-notes: the `<self-note>` tag parser, the
// `bbx session` renderer, and the `POST /api/chat/self-note` endpoint's
// input validation.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { parseSelfNote, parseSelfNotes, entrySelfNotes, parseSessionLog, getSessionMetadata } from "../../../src/cli/lib/session.js";
import type { SessionLogSlice } from "../../../src/cli/lib/session-retention.js";
import assert from "node:assert/strict";
import { isRecord } from "../../../src/shared/is-record.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { makeTestServer } from "../../helpers/test-route-server.js";

// "Everything, bounded": the first page at the hard retention ceiling.
const ALL = { mode: "page", offset: 0, limit: 5000 } satisfies SessionLogSlice;

// A transcript line: a user-position text entry.
const userLine = ({ uuid, timestamp, text }: { uuid: string; timestamp: string; text: string }) =>
  JSON.stringify({ type: "user", uuid, timestamp, message: { role: "user", content: [{ type: "text", text }] } });

// ## parseSelfNote
//
// A tag yields `ref`, `commit` and `body`; absent attributes are `null`. A
// multi-line body is trimmed, XML-escaped attribute values decode, and
// surrounding whitespace is tolerated:
void test("A tag yields ref, commit and body; absent attributes are null.", async (t) => {
  t.check(
    [
      '<self-note ref="_config/schedules/daily.card" commit="abc123">body text</self-note>',
      "<self-note>just a body</self-note>",
      "<self-note>\nline one\nline two\n</self-note>",
      "  \n<self-note>hi</self-note>\n  ",
      '<self-note ref="a &amp; b">x</self-note>',
    ].map((text) => parseSelfNote(text)),
    [
    {
      ref: "_config/schedules/daily.card",
      commit: "abc123",
      body: "body text",
    },
    {
      ref: null,
      commit: null,
      body: "just a body",
    },
    {
      ref: null,
      commit: null,
      body: `line one
line two`,
    },
    {
      ref: null,
      commit: null,
      body: "hi",
    },
    {
      ref: "a & b",
      commit: null,
      body: "x",
    },
  ],
  );
});

// Every turn is persisted with a `<chat-app .../>` snapshot prepended, so a
// self-note arrives as `<chat-app .../>\n<self-note>...`. The snapshot is
// stripped before matching, otherwise the note falls through to a normal
// user bubble:
void test("Every turn is persisted with a <chat-app .../> snapshot prepended, so a self-...", async (t) => {
  t.check(parseSelfNote('<chat-app narration="off" prose="on" time="2026-07-01T02:47:12.815Z"/>\n<self-note ref="foo.md">did stuff</self-note>'), {
    ref: "foo.md",
    commit: null,
    body: "did stuff",
  });
});

// Text that is not a self-note returns null, including an unclosed tag:
void test("Text that is not a self-note returns null, including an unclosed tag:", async (t) => {
  t.check([parseSelfNote("hello world"), parseSelfNote("<self-note>no closing tag")], [
    null,
    null,
  ]);
});

// ## parseSelfNotes — multiple notes in one text block
//
// `ChatSession.drainQueue()` concatenates a burst of enqueued self-notes
// with `\n\n`, so a single user entry can contain several `<self-note>`
// blocks back-to-back. `parseSelfNotes` returns them all:
void test("ChatSession.drainQueue() concatenates a burst of enqueued self-notes with \\n\\...", async (t) => {
  t.check(parseSelfNotes("<self-note>one</self-note>\n\n<self-note ref=\"x\">two</self-note>\n\n<self-note commit=\"abc\">three</self-note>"), [
    {
      ref: null,
      commit: null,
      body: "one",
    },
    {
      ref: "x",
      commit: null,
      body: "two",
    },
    {
      ref: null,
      commit: "abc",
      body: "three",
    },
  ]);
});

// Mixed content (self-note plus other text, before, after or between) is
// rejected — falls through to normal user rendering so the other text isn't
// silently hidden. Text with no self-notes is null too:
void test("Mixed content (self-note plus other text, before, after or between) is reject...", async (t) => {
  t.check(
    [
      parseSelfNotes("<self-note>note</self-note>\nrandom extra text"),
      parseSelfNotes("hello\n<self-note>note</self-note>"),
      parseSelfNotes("<self-note>a</self-note> BETWEEN <self-note>b</self-note>"),
      parseSelfNotes("just a typed message"),
    ],
    [
    null,
    null,
    null,
    null,
  ],
  );
});

// ## entrySelfNotes — extract from a session entry
//
// `entrySelfNotes` is the shared extractor used by both the CLI transcript
// renderer and the frontend chat renderer (a single implementation in
// `core/self-note.ts`; the two formerly kept byte-identical copies under
// different names). It takes any object with `type` + `content[]` and returns the
// notes only for a pure-self-note `user` entry; non-user entries and user
// entries without self-note text return null:
void test("entrySelfNotes is the shared extractor used by both the CLI transcript render...", async (t) => {
  t.check(
    [
      entrySelfNotes({ type: "user", content: [{ type: "text", text: "<self-note ref=\"a.card\">hello</self-note>" }] }),
      entrySelfNotes({ type: "assistant", content: [{ type: "text", text: "<self-note>x</self-note>" }] }),
      entrySelfNotes({ type: "user", content: [{ type: "text", text: "just chatting" }] }),
    ],
    [
    [
      {
        ref: "a.card",
        commit: null,
        body: "hello",
      },
    ],
    null,
    null,
  ],
  );
});

// ## Self-notes in parseSessionLog
//
// A self-note written into the session JSONL as a user-position text entry
// flows through `parseSessionLog` as a normal user entry — the rendering
// layer is responsible for detecting the `<self-note>` wrapper and
// styling it. The parser doesn't need to know.
void test("A self-note written into the session JSONL as a user-position text entry flow...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write("log.jsonl", [
    userLine({ uuid: "u1", timestamp: "2026-04-17T00:00:00Z", text: "<typed>hello</typed>" }),
    userLine({ uuid: "u2", timestamp: "2026-04-17T00:00:30Z", text: '<self-note ref="daily.card">did stuff</self-note>' }),
  ].join("\n"));
  const result = await parseSessionLog({ logPath: box.path("log.jsonl"), slice: ALL });
  t.check(result.entries.map((entry) => entry.content[0]?.text), [
    "<typed>hello</typed>",
    "<self-note ref=\"daily.card\">did stuff</self-note>",
  ]);
});

// ## Self-notes don't count as user turns in metadata
//
// A session whose only user-position entries are self-notes has zero user
// turns (self-notes are not conversational input) and no first-user
// snippet. A self-note followed by a real typed message: one user turn, snippet
// from the real message.
void test("A session whose only user-position entries are self-notes has zero user turns...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  async function metaOf(lines: string[]) {
    await box.write("log.jsonl", lines.join("\n"));
    const meta = await getSessionMetadata({ sessionId: "s1", logPath: box.path("log.jsonl") });
    return { userTurns: meta.userTurns, firstUserSnippet: meta.firstUserSnippet };
  }
  const onlyNote = await metaOf([userLine({ uuid: "u1", timestamp: "2026-04-17T00:00:00Z", text: "<self-note>scheduled run</self-note>" })]);
  const noteThenTyped = await metaOf([
    userLine({ uuid: "u1", timestamp: "2026-04-17T00:00:00Z", text: "<self-note>run</self-note>" }),
    userLine({ uuid: "u2", timestamp: "2026-04-17T00:01:00Z", text: "<typed>hi there</typed>" }),
  ]);
  t.check(({ onlyNote, noteThenTyped }), {
    onlyNote: {
      userTurns: 0,
      firstUserSnippet: null,
    },
    noteThenTyped: {
      userTurns: 1,
      firstUserSnippet: "hi there",
    },
  });
});

// ## POST /api/chat/self-note — validation
//
// A missing or blank body is a 400. Specifying a session that isn't live is a
// 404: without a live chat session, any session id mismatches.
void test("A missing or blank body is a 400.", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer();
  const post = async (payload: Record<string, unknown>) => {
    const res = await ctx.request({ method: "POST", url: "/api/chat/self-note", payload });
    const body: unknown = res.body;
    assert.ok(isRecord(body) && typeof body.error === "string");
    return { status: res.statusCode, error: body.error };
  };
  const missing = await post({});
  const blank = await post({ body: "   " });
  const notLive = await post({ body: "hello", session: "nope" });
  t.check(({ missing, blank, notLive: { status: notLive.status, mentionsNotLive: notLive.error.includes("not live") } }), {
    missing: {
      status: 400,
      error: "body is required",
    },
    blank: {
      status: 400,
      error: "body is required",
    },
    notLive: {
      status: 404,
      mentionsNotLive: true,
    },
  });
});
