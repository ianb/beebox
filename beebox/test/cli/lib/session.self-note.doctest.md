# Self-notes

Tests for agent-authored self-notes: the `<self-note>` tag parser, the
`bbx session` renderer, and the `POST /api/chat/self-note` endpoint's
input validation.

```ts setup
import { parseSelfNote, parseSelfNotes, entrySelfNotes, parseSessionLog, getSessionMetadata } from "../../../src/cli/lib/session.js";
// "Everything, bounded": the first page at the hard retention ceiling.
const ALL = { mode: "page", offset: 0, limit: 5000 };
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { makeTestServer } from "../../helpers/doctest-server.js";

// A transcript line: a user-position text entry.
const userLine = (uuid: string, timestamp: string, text: string) =>
  JSON.stringify({ type: "user", uuid, timestamp, message: { role: "user", content: [{ type: "text", text }] } });
```

## parseSelfNote

A tag yields `ref`, `commit` and `body`; absent attributes are `null`. A
multi-line body is trimmed, XML-escaped attribute values decode, and
surrounding whitespace is tolerated:

```ts
[
  '<self-note ref="_config/schedules/daily.card" commit="abc123">body text</self-note>',
  "<self-note>just a body</self-note>",
  "<self-note>\nline one\nline two\n</self-note>",
  "  \n<self-note>hi</self-note>\n  ",
  '<self-note ref="a &amp; b">x</self-note>',
].map((text) => parseSelfNote(text))
=>
[
  { ref: "_config/schedules/daily.card", commit: "abc123", body: "body text" },
  { ref: null, commit: null, body: "just a body" },
  { ref: null, commit: null, body: "line one\nline two" },
  { ref: null, commit: null, body: "hi" },
  { ref: "a & b", commit: null, body: "x" },
]
```

Every turn is persisted with a `<chat-app .../>` snapshot prepended, so a
self-note arrives as `<chat-app .../>\n<self-note>...`. The snapshot is
stripped before matching, otherwise the note falls through to a normal
user bubble:

```ts
parseSelfNote('<chat-app narration="off" prose="on" time="2026-07-01T02:47:12.815Z"/>\n<self-note ref="foo.md">did stuff</self-note>')
=> { ref: "foo.md", commit: null, body: "did stuff" }
```

Text that is not a self-note returns null, including an unclosed tag:

```ts
[parseSelfNote("hello world"), parseSelfNote("<self-note>no closing tag")]
=> [null, null]
```

## parseSelfNotes — multiple notes in one text block

`ChatSession.drainQueue()` concatenates a burst of enqueued self-notes
with `\n\n`, so a single user entry can contain several `<self-note>`
blocks back-to-back. `parseSelfNotes` returns them all:

```ts
parseSelfNotes("<self-note>one</self-note>\n\n<self-note ref=\"x\">two</self-note>\n\n<self-note commit=\"abc\">three</self-note>")
=>
[
  { ref: null, commit: null, body: "one" },
  { ref: "x", commit: null, body: "two" },
  { ref: null, commit: "abc", body: "three" },
]
```

Mixed content (self-note plus other text, before, after or between) is
rejected — falls through to normal user rendering so the other text isn't
silently hidden. Text with no self-notes is null too:

```ts
[
  parseSelfNotes("<self-note>note</self-note>\nrandom extra text"),
  parseSelfNotes("hello\n<self-note>note</self-note>"),
  parseSelfNotes("<self-note>a</self-note> BETWEEN <self-note>b</self-note>"),
  parseSelfNotes("just a typed message"),
]
=> [null, null, null, null]
```

## entrySelfNotes — extract from a session entry

`entrySelfNotes` is the shared extractor used by both the CLI transcript
renderer and the frontend chat renderer (a single implementation in
`core/self-note.ts`; the two formerly kept byte-identical copies under
different names). It takes any object with `type` + `content[]` and returns the
notes only for a pure-self-note `user` entry; non-user entries and user
entries without self-note text return null:

```ts
[
  entrySelfNotes({ type: "user", content: [{ type: "text", text: "<self-note ref=\"a.card\">hello</self-note>" }] }),
  entrySelfNotes({ type: "assistant", content: [{ type: "text", text: "<self-note>x</self-note>" }] }),
  entrySelfNotes({ type: "user", content: [{ type: "text", text: "just chatting" }] }),
]
=> [[{ ref: "a.card", commit: null, body: "hello" }], null, null]
```

## Self-notes in parseSessionLog

A self-note written into the session JSONL as a user-position text entry
flows through `parseSessionLog` as a normal user entry — the rendering
layer is responsible for detecting the `<self-note>` wrapper and
styling it. The parser doesn't need to know.

```ts
const box = await makeTmpBox();
await box.write("log.jsonl", [
  userLine("u1", "2026-04-17T00:00:00Z", "<typed>hello</typed>"),
  userLine("u2", "2026-04-17T00:00:30Z", '<self-note ref="daily.card">did stuff</self-note>'),
].join("\n"));
const result = await parseSessionLog({ logPath: box.path("log.jsonl"), slice: ALL });
result.entries.map((entry) => entry.content[0].text)
=> ["<typed>hello</typed>", "<self-note ref=\"daily.card\">did stuff</self-note>"]
```

```ts cleanup
await box.cleanup();
```

## Self-notes don't count as user turns in metadata

A session whose only user-position entries are self-notes has zero user
turns (self-notes are not conversational input) and no first-user
snippet. A self-note followed by a real typed message: one user turn, snippet
from the real message.

```ts
const box = await makeTmpBox();
async function metaOf(lines: string[]) {
  await box.write("log.jsonl", lines.join("\n"));
  const meta = await getSessionMetadata({ sessionId: "s1", logPath: box.path("log.jsonl") });
  return { userTurns: meta.userTurns, firstUserSnippet: meta.firstUserSnippet };
}
const onlyNote = await metaOf([userLine("u1", "2026-04-17T00:00:00Z", "<self-note>scheduled run</self-note>")]);
const noteThenTyped = await metaOf([
  userLine("u1", "2026-04-17T00:00:00Z", "<self-note>run</self-note>"),
  userLine("u2", "2026-04-17T00:01:00Z", "<typed>hi there</typed>"),
]);
({ onlyNote, noteThenTyped })
=> { onlyNote: { userTurns: 0, firstUserSnippet: null }, noteThenTyped: { userTurns: 1, firstUserSnippet: "hi there" } }
```

```ts cleanup
await box.cleanup();
```

## POST /api/chat/self-note — validation

A missing or blank body is a 400. Specifying a session that isn't live is a
404: without a live chat session, any session id mismatches.

```ts
const ctx = await makeTestServer();
const post = async (payload: Record<string, unknown>) => {
  const res = await ctx.request({ method: "POST", url: "/api/chat/self-note", payload });
  return { status: res.statusCode, error: res.body.error };
};
const missing = await post({});
const blank = await post({ body: "   " });
const notLive = await post({ body: "hello", session: "nope" });
({ missing, blank, notLive: { status: notLive.status, mentionsNotLive: notLive.error.includes("not live") } })
=>
{
  missing: { status: 400, error: "body is required" },
  blank: { status: 400, error: "body is required" },
  notLive: { status: 404, mentionsNotLive: true }
}
```

```ts cleanup
await ctx.cleanup();
```
