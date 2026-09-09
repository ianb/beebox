# chat.bootstrap

Opening `/chat` used to take three serial round trips: `chat.defaultSession` to
learn the session id, a client navigation, then `chat.history` + `chat.status`
(both need a concrete id server-side, so they can't go out sooner).
`chat.bootstrap` resolves the session and answers all three at once. It also
carries the session's editorial `label` (the husk card's `title`, or null
when the session has no real name yet) — the chat page's session chip needs
it, and no other chat-page query has one.

It composes the same implementations the three procedures use, so it can't
report anything different from them.

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTestServer } from "../helpers/doctest-server.js";
import { getSessionDir } from "../../src/core/chat/session/transcript-paths.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A real server, because `chat.status` reads the live per-box chat runtime
// that `registerChatRoutes` installs.
function caller(server) {
  const ctx = {
    boxRoot: server.boxRoot,
    boxSlug: "test",
    eventBus: server.eventBus,
    services: {},
    user: null,
    authed: true,
    isOwner: true,
  };
  return appRouter.createCaller(ctx);
}

// The chat page's request shape: a bounded tail window.
const TAIL = { mode: "tail", tail: 200, minRealUserMessages: 2 };

const TRANSCRIPT = [
  JSON.stringify({
    type: "user",
    uuid: "u1",
    timestamp: "2026-01-01T00:00:00Z",
    message: { role: "user", content: [{ type: "text", text: "Hello" }] },
  }),
  JSON.stringify({
    type: "assistant",
    uuid: "a1",
    timestamp: "2026-01-01T00:00:01Z",
    message: { role: "assistant", content: [{ type: "text", text: "Hi there!" }] },
  }),
].join("\n");

// Point session discovery at a fixture dir and write one session's transcript.
async function seedTranscript(server, sessionId) {
  const dir = getSessionDir(server.boxRoot);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${sessionId}.jsonl`), TRANSCRIPT);
}

// Record the default-session pointer, as sending a message would.
async function setDefaultSession(server, sessionId) {
  await mkdir(join(server.boxRoot, ".beebox"), { recursive: true });
  await writeFile(
    join(server.boxRoot, ".beebox/chat-session-id.json"),
    JSON.stringify({ sessionId, savedAt: "2026-01-01T00:00:02Z" }),
  );
}
```

## A box with no chat yet: no session, no history

`history` is null exactly when `sessionId` is null — there is nothing to load —
and `status` reports the idle shape rather than failing.

```ts
const projects = await mkdtemp(join(tmpdir(), "bbx-bootstrap-projects-"));
process.env["BBX_CLAUDE_PROJECTS_DIR"] = projects;
const server = await makeTestServer();

const empty = await caller(server).chat.bootstrap({ slice: TAIL });
JSON.stringify(empty)
=> {"kind":"empty","sessionId":null,"history":null,"label":null,"status":{"sessionId":null,"running":false,"busy":false,"model":null,"source":"none","boxDefault":null,"pendingModel":null,"engine":"claude","enabledEngines":["claude"],"boxEngine":"claude"},"pending":[]}
```

## An explicit session id returns that session's history and status

```ts continue
await seedTranscript(server, "sess-explicit");

const got = await caller(server).chat.bootstrap({ session: "sess-explicit", slice: TAIL });
print(`sessionId: ${got.sessionId}`);
print(`total: ${got.history.total}`);
print(`entries: ${got.history.entries.map((e) => `${e.type}:${e.content[0].text}`).join(", ")}`);
print(`label: ${got.label}`);
print(`status: running=${got.status.running} busy=${got.status.busy} id=${got.status.sessionId}`);
=>
sessionId: sess-explicit
total: 2
entries: user:Hello, assistant:Hi there!
label: null
status: running=false busy=false id=sess-explicit
```

`label` is null here even though the transcript has messages: it is the
session's *editorial* title (husk `title` only — see the husk section
below), not the pickers' first-message fallback. The session chip shows an
icon face until a real title exists.

The history slice options are the ones `chat.history` takes:

```ts continue
const tailed = await caller(server).chat.bootstrap({ session: "sess-explicit", slice: { mode: "tail", tail: 1 } });
print(`kept: ${tailed.history.entries.length} of ${tailed.history.total}`);
print(`text: ${tailed.history.entries[0].content[0].text}`);
=>
kept: 1 of 2
text: Hi there!
```

## With no `session`, it resolves the default session itself

Same resolution `chat.defaultSession` does — which is the whole point: the
client no longer has to ask, navigate, and ask again.

```ts continue
await setDefaultSession(server, "sess-explicit");

const resolved = await caller(server).chat.bootstrap({ slice: TAIL });
print(`sessionId: ${resolved.sessionId}`);
print(`total: ${resolved.history.total}`);
=>
sessionId: sess-explicit
total: 2
```

## It matches the three procedures it replaces

```ts continue
const c = caller(server);
const [viaDefault, viaHistory, viaStatus] = await Promise.all([
  c.chat.defaultSession(),
  c.chat.history({ session: "sess-explicit", slice: TAIL }),
  c.chat.status({ session: "sess-explicit" }),
]);
const atomic = await c.chat.bootstrap({ slice: TAIL });

// `label` and `pending` are bootstrap's own additions — the three procedures it
// replaces have no equivalent (`pending` reads the acceptance record on the
// event bus, not the transcript) — so they sit out the comparison.
const { label, pending, ...composed } = atomic;
JSON.stringify(composed) === JSON.stringify({
  kind: "resumable",
  sessionId: viaDefault.sessionId,
  history: viaHistory,
  status: viaStatus,
})
=> true
```

## A session id with no transcript reads as empty, not an error

An id that hasn't produced a JSONL yet — a brand-new chat, or a turn that
errored before writing — is a normal state. `chat.history` already degrades
this way; `bootstrap` matches it rather than inventing an error the chat page
would have to handle.

The label is null — no husk, no editorial title. (The session *lists* fall
back to an id prefix for their rows; bootstrap's label deliberately
doesn't.)

```ts continue
const missing = await caller(server).chat.bootstrap({ session: "no-such-session", slice: TAIL });
JSON.stringify(missing)
=> {"kind":"unavailable","reason":"missing-local-transcript","transcript":{"state":"unknown"},"huskPath":null,"sessionId":"no-such-session","history":null,"label":null,"status":{"sessionId":"no-such-session","running":false,"busy":false,"model":null,"source":"none","boxDefault":null,"pendingModel":null,"engine":"claude","enabledEngines":["claude"],"boxEngine":"claude"},"pending":[]}
```

Input still validates: a non-string session is rejected before any work, and so
is an empty one — `""` is not a session id, and accepting it would report
`sessionId: ""` next to a status that correctly says there is no session.

```ts continue
await caller(server).chat.bootstrap({ session: 42, slice: TAIL }).then(() => "no error", (e) => e.code)
=> BAD_REQUEST

await caller(server).chat.bootstrap({ session: "", slice: TAIL }).then(() => "no error", (e) => e.code)
=> BAD_REQUEST
```

The slice is a discriminated union with hard bounds, and each arm is strict —
a tail request carrying page fields is a different request, not a tail request
with extras, and a slice past the retention ceiling is refused at the door
rather than served as a bigger read:

```ts continue
const c2 = caller(server);
print(await c2.chat.history({ session: "sess-explicit", slice: { mode: "tail", tail: 1, offset: 0, limit: 40 } }).then(() => "no error", (e) => e.code));
print(await c2.chat.history({ session: "sess-explicit", slice: { mode: "tail", tail: 50_000 } }).then(() => "no error", (e) => e.code));
print(await c2.chat.history({ session: "sess-explicit", slice: { mode: "page", offset: -1, limit: 10 } }).then(() => "no error", (e) => e.code));
print(await c2.chat.history({ session: "sess-explicit", slice: { mode: "tail", tail: 1.5 } }).then(() => "no error", (e) => e.code));
=>
BAD_REQUEST
BAD_REQUEST
BAD_REQUEST
BAD_REQUEST
```

## The label comes from the husk, like every other session list

A husk `title` — hand-set, or written by the nightly chat review — wins over the
transcript snippet, so the chip and the pickers can't disagree about what a chat
is called.

```ts continue
await mkdir(join(server.boxRoot, "_content/chat/web"), { recursive: true });
await writeFile(
  join(server.boxRoot, "_content/chat/web/2026-01-01_sess-exp.chat.card"),
  "---\nsession: sess-explicit\ntitle: Chasing down a duplicate charge\n---\n\n",
);

const titled = await caller(server).chat.bootstrap({ session: "sess-explicit", slice: TAIL });
titled.label
=> Chasing down a duplicate charge
```

A husk can be renamed freely — the `session` field is what identifies it, and
the pickers enumerate by that field. So a husk whose filename no longer carries
the id's `_<shortid>` suffix still names its chat; the filename convention is
only a fast path for finding it.

```ts continue
await writeFile(
  join(server.boxRoot, "_content/chat/web/Duplicate_charge_followup.chat.card"),
  "---\nsession: sess-renamed\ntitle: Renamed husk still names its chat\n---\n\n",
);

const renamed = await caller(server).chat.bootstrap({ session: "sess-renamed", slice: TAIL });
renamed.label
=> Renamed husk still names its chat
```

An empty id in the persisted default-session pointer means "none" too, rather
than a session named `""`:

```ts continue
await setDefaultSession(server, "");
JSON.stringify(await caller(server).chat.bootstrap({ slice: TAIL }))
=> {"kind":"empty","sessionId":null,"history":null,"label":null,"status":{"sessionId":null,"running":false,"busy":false,"model":null,"source":"none","boxDefault":null,"pendingModel":null,"engine":"claude","enabledEngines":["claude"],"boxEngine":"claude"},"pending":[]}
```

```ts cleanup
delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
await server.cleanup();
await rm(projects, { recursive: true, force: true });
```
