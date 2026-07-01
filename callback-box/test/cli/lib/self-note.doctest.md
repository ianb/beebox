# Self-notes

Tests for agent-authored self-notes: the `<self-note>` tag parser, the
`cb session` renderer, and the `POST /api/chat/self-note` endpoint's
input validation.

```ts setup
import { parseSelfNote, parseSelfNotes, parseSessionLog, getSessionMetadata } from "../../../src/cli/lib/session.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { makeTestServer } from "../../helpers/doctest-server.js";
```

## parseSelfNote

### Full tag — ref and commit and body

```ts
const note = parseSelfNote('<self-note ref="config/schedules/daily.card" commit="abc123">body text</self-note>');
print(`ref: ${note.ref}`);
print(`commit: ${note.commit}`);
print(`body: ${note.body}`);
=>
ref: config/schedules/daily.card
commit: abc123
body: body text
```

### No attributes

```ts
const note = parseSelfNote("<self-note>just a body</self-note>");
print(`ref: ${note.ref}`);
print(`commit: ${note.commit}`);
print(`body: ${note.body}`);
=>
ref: null
commit: null
body: just a body
```

### Only ref

```ts
const note = parseSelfNote('<self-note ref="foo.card">hello</self-note>');
print(`ref: ${note.ref}`);
print(`commit: ${note.commit}`);
=>
ref: foo.card
commit: null
```

### Multi-line body

```ts
const note = parseSelfNote("<self-note>\nline one\nline two\n</self-note>");
JSON.stringify(note.body)
=> "line one\nline two"
```

### Surrounding whitespace is tolerated

```ts
const note = parseSelfNote("  \n<self-note>hi</self-note>\n  ");
note.body
=> hi
```

### The server-prepended `<chat-app>` snapshot is tolerated

Every turn is persisted with a `<chat-app .../>` snapshot prepended, so a
self-note arrives as `<chat-app .../>\n<self-note>...`. The snapshot is
stripped before matching, otherwise the note falls through to a normal
user bubble.

```ts
const note = parseSelfNote('<chat-app narration="off" prose="on" time="2026-07-01T02:47:12.815Z"/>\n<self-note ref="foo.md">did stuff</self-note>');
print(`ref: ${note.ref}`);
print(`body: ${note.body}`);
=>
ref: foo.md
body: did stuff
```

### XML-escaped attribute values decode

```ts
const note = parseSelfNote('<self-note ref="a &amp; b">x</self-note>');
note.ref
=> a & b
```

### Non-self-note text returns null

```ts
parseSelfNote("hello world") === null
=> true
```

```ts
parseSelfNote("<typed>regular user message</typed>") === null
=> true
```

```ts
parseSelfNote("<self-note>no closing tag") === null
=> true
```

## parseSelfNotes — multiple notes in one text block

`ChatSession.drainQueue()` concatenates a burst of enqueued self-notes
with `\n\n`, so a single user entry can contain several `<self-note>`
blocks back-to-back. `parseSelfNotes` returns them all.

```ts
const text = "<self-note>one</self-note>\n\n<self-note ref=\"x\">two</self-note>\n\n<self-note commit=\"abc\">three</self-note>";
const notes = parseSelfNotes(text);
print(`count: ${notes.length}`);
print(`0: ${notes[0].body}`);
print(`1 ref: ${notes[1].ref}, body: ${notes[1].body}`);
print(`2 commit: ${notes[2].commit}, body: ${notes[2].body}`);
=>
count: 3
0: one
1 ref: x, body: two
2 commit: abc, body: three
```

A single note returns a one-element array:

```ts
parseSelfNotes("<self-note>hi</self-note>").length
=> 1
```

Mixed content (self-note plus other text) is rejected — falls through
to normal user rendering so the other text isn't silently hidden:

```ts
parseSelfNotes("<self-note>note</self-note>\nrandom extra text") === null
=> true
```

```ts
parseSelfNotes("hello\n<self-note>note</self-note>") === null
=> true
```

```ts
parseSelfNotes("<self-note>a</self-note> BETWEEN <self-note>b</self-note>") === null
=> true
```

No self-notes in the text:

```ts
parseSelfNotes("just a typed message") === null
=> true
```

## Self-notes in parseSessionLog

A self-note written into the session JSONL as a user-position text entry
flows through `parseSessionLog` as a normal user entry — the rendering
layer is responsible for detecting the `<self-note>` wrapper and
styling it. The parser doesn't need to know.

```ts
const box = await makeTmpBox();
const lines = [
  JSON.stringify({
    type: "user",
    uuid: "u1",
    timestamp: "2026-04-17T00:00:00Z",
    message: { role: "user", content: [{ type: "text", text: "<typed>hello</typed>" }] },
  }),
  JSON.stringify({
    type: "user",
    uuid: "u2",
    timestamp: "2026-04-17T00:00:30Z",
    message: { role: "user", content: [{ type: "text", text: '<self-note ref="daily.card">did stuff</self-note>' }] },
  }),
].join("\n");
await box.write("log.jsonl", lines);
const result = await parseSessionLog({ logPath: box.path("log.jsonl") });
print(`entries: ${result.entries.length}`);
print(`e0 text: ${result.entries[0].content[0].text}`);
print(`e1 has self-note: ${result.entries[1].content[0].text.includes("self-note")}`);
=>
entries: 2
e0 text: <typed>hello</typed>
e1 has self-note: true
```

```ts cleanup
await box.cleanup();
```

## Self-notes don't count as user turns in metadata

A session whose only user-position entries are self-notes has zero user
turns (self-notes are not conversational input) and no first-user
snippet:

```ts
const box = await makeTmpBox();
const lines = [
  JSON.stringify({
    type: "user",
    uuid: "u1",
    timestamp: "2026-04-17T00:00:00Z",
    message: { role: "user", content: [{ type: "text", text: "<self-note>scheduled run</self-note>" }] },
  }),
].join("\n");
await box.write("log.jsonl", lines);
const meta = await getSessionMetadata({ sessionId: "s1", logPath: box.path("log.jsonl") });
print(`userTurns: ${meta.userTurns}`);
print(`firstUserSnippet: ${meta.firstUserSnippet}`);
=>
userTurns: 0
firstUserSnippet: null
```

```ts cleanup
await box.cleanup();
```

A self-note followed by a real typed message: one user turn, snippet from
the real message.

```ts
const box = await makeTmpBox();
const lines = [
  JSON.stringify({
    type: "user",
    uuid: "u1",
    timestamp: "2026-04-17T00:00:00Z",
    message: { role: "user", content: [{ type: "text", text: "<self-note>run</self-note>" }] },
  }),
  JSON.stringify({
    type: "user",
    uuid: "u2",
    timestamp: "2026-04-17T00:01:00Z",
    message: { role: "user", content: [{ type: "text", text: "<typed>hi there</typed>" }] },
  }),
].join("\n");
await box.write("log.jsonl", lines);
const meta = await getSessionMetadata({ sessionId: "s1", logPath: box.path("log.jsonl") });
print(`userTurns: ${meta.userTurns}`);
print(`firstUserSnippet: ${meta.firstUserSnippet}`);
=>
userTurns: 1
firstUserSnippet: hi there
```

```ts cleanup
await box.cleanup();
```

## POST /api/chat/self-note — validation

Missing body returns 400:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({ method: "POST", url: "/api/chat/self-note", payload: {} });
print(`status: ${res.statusCode}`);
print(`error: ${res.body.error}`);
=>
status: 400
error: body is required
```

```ts cleanup
await ctx.cleanup();
```

Empty-string body returns 400:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({ method: "POST", url: "/api/chat/self-note", payload: { body: "   " } });
print(`status: ${res.statusCode}`);
print(`error: ${res.body.error}`);
=>
status: 400
error: body is required
```

```ts cleanup
await ctx.cleanup();
```

Specifying a session that isn't live returns 404 — without a live chat
session, any session id mismatches:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/self-note",
  payload: { body: "hello", session: "nope" },
});
res.statusCode
=> 404
```

```ts continue
res.body.error.includes("not live")
=> true
```

```ts cleanup
await ctx.cleanup();
```
