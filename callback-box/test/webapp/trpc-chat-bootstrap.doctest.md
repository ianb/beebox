# chat.bootstrap

Opening `/chat` used to take three serial round trips: `chat.defaultSession` to
learn the session id, a client navigation, then `chat.history` + `chat.status`
(both need a concrete id server-side, so they can't go out sooner).
`chat.bootstrap` resolves the session and answers all three at once.

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
  await mkdir(join(server.boxRoot, ".callback-box"), { recursive: true });
  await writeFile(
    join(server.boxRoot, ".callback-box/chat-session-id.json"),
    JSON.stringify({ sessionId, savedAt: "2026-01-01T00:00:02Z" }),
  );
}
```

## A box with no chat yet: no session, no history

`history` is null exactly when `sessionId` is null — there is nothing to load —
and `status` reports the idle shape rather than failing.

```ts
const projects = await mkdtemp(join(tmpdir(), "cb-bootstrap-projects-"));
process.env["CB_CLAUDE_PROJECTS_DIR"] = projects;
const server = await makeTestServer();

const empty = await caller(server).chat.bootstrap({});
JSON.stringify(empty)
=> {"sessionId":null,"history":null,"status":{"sessionId":null,"running":false,"busy":false,"model":null}}
```

## An explicit session id returns that session's history and status

```ts continue
await seedTranscript(server, "sess-explicit");

const got = await caller(server).chat.bootstrap({ session: "sess-explicit" });
print(`sessionId: ${got.sessionId}`);
print(`total: ${got.history.total}`);
print(`entries: ${got.history.entries.map((e) => `${e.type}:${e.content[0].text}`).join(", ")}`);
print(`status: running=${got.status.running} busy=${got.status.busy} id=${got.status.sessionId}`);
=>
sessionId: sess-explicit
total: 2
entries: user:Hello, assistant:Hi there!
status: running=false busy=false id=sess-explicit
```

The history slice options are the ones `chat.history` takes:

```ts continue
const tailed = await caller(server).chat.bootstrap({ session: "sess-explicit", tail: 1 });
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

const resolved = await caller(server).chat.bootstrap({});
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
  c.chat.history({ session: "sess-explicit" }),
  c.chat.status({ session: "sess-explicit" }),
]);
const atomic = await c.chat.bootstrap({});

JSON.stringify(atomic) === JSON.stringify({
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

```ts continue
const missing = await caller(server).chat.bootstrap({ session: "no-such-session" });
JSON.stringify(missing)
=> {"sessionId":"no-such-session","history":{"sessionId":"no-such-session","entries":[],"total":0},"status":{"sessionId":"no-such-session","running":false,"busy":false,"model":null}}
```

Input still validates: a non-string session is rejected before any work, and so
is an empty one — `""` is not a session id, and accepting it would report
`sessionId: ""` next to a status that correctly says there is no session.

```ts continue
await caller(server).chat.bootstrap({ session: 42 }).then(() => "no error", (e) => e.code)
=> BAD_REQUEST

await caller(server).chat.bootstrap({ session: "" }).then(() => "no error", (e) => e.code)
=> BAD_REQUEST
```

An empty id in the persisted default-session pointer means "none" too, rather
than a session named `""`:

```ts continue
await setDefaultSession(server, "");
JSON.stringify(await caller(server).chat.bootstrap({}))
=> {"sessionId":null,"history":null,"status":{"sessionId":null,"running":false,"busy":false,"model":null}}
```

```ts cleanup
delete process.env["CB_CLAUDE_PROJECTS_DIR"];
await server.cleanup();
await rm(projects, { recursive: true, force: true });
```
