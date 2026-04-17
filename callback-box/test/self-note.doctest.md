# Self-notes

Tests for agent-authored self-notes: the `<self-note>` tag parser, the
`cb session` renderer, and the `POST /api/chat/self-note` endpoint's
input validation.

```ts setup
import { parseSelfNote, parseSessionLog, getSessionMetadata } from "../src/cli/lib/session.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { makeTestServer } from "./helpers/doctest-server.js";
```

## parseSelfNote

### Full tag — ref and commit and body

```
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

```
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

```
const note = parseSelfNote('<self-note ref="foo.card">hello</self-note>');
print(`ref: ${note.ref}`);
print(`commit: ${note.commit}`);
=>
ref: foo.card
commit: null
```

### Multi-line body

```
const note = parseSelfNote("<self-note>\nline one\nline two\n</self-note>");
JSON.stringify(note.body)
=> "line one\nline two"
```

### Surrounding whitespace is tolerated

```
const note = parseSelfNote("  \n<self-note>hi</self-note>\n  ");
note.body
=> hi
```

### XML-escaped attribute values decode

```
const note = parseSelfNote('<self-note ref="a &amp; b">x</self-note>');
note.ref
=> a & b
```

### Non-self-note text returns null

```
parseSelfNote("hello world") === null
=> true
```

```
parseSelfNote("<typed>regular user message</typed>") === null
=> true
```

```
parseSelfNote("<self-note>no closing tag") === null
=> true
```

## Self-notes in parseSessionLog

A self-note written into the session JSONL as a user-position text entry
flows through `parseSessionLog` as a normal user entry — the rendering
layer is responsible for detecting the `<self-note>` wrapper and
styling it. The parser doesn't need to know.

```
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

``` cleanup
await box.cleanup();
```

## Self-notes don't count as user turns in metadata

A session whose only user-position entries are self-notes has zero user
turns (self-notes are not conversational input) and no first-user
snippet:

```
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

``` cleanup
await box.cleanup();
```

A self-note followed by a real typed message: one user turn, snippet from
the real message.

```
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

``` cleanup
await box.cleanup();
```

## POST /api/chat/self-note — validation

Missing body returns 400:

```
const ctx = await makeTestServer();
const res = await ctx.request({ method: "POST", url: "/api/chat/self-note", payload: {} });
print(`status: ${res.statusCode}`);
print(`error: ${res.body.error}`);
=>
status: 400
error: body is required
```

``` cleanup
await ctx.cleanup();
```

Empty-string body returns 400:

```
const ctx = await makeTestServer();
const res = await ctx.request({ method: "POST", url: "/api/chat/self-note", payload: { body: "   " } });
print(`status: ${res.statusCode}`);
print(`error: ${res.body.error}`);
=>
status: 400
error: body is required
```

``` cleanup
await ctx.cleanup();
```

Specifying a session that isn't live returns 404 — without a live chat
session, any session id mismatches:

```
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/self-note",
  payload: { body: "hello", session: "nope" },
});
res.statusCode
=> 404
```

``` continue
res.body.error.includes("not live")
=> true
```

``` cleanup
await ctx.cleanup();
```
