# `debugLog.submit` — tagged, capped, strictly-durable log forwarding

Extends the existing web-only `debugLog.submit` sink (`ts [level] message`
lines + a 200-entry ring buffer) to accept native-forwarded entries: an
optional per-batch `source` slug, a closed `level` enum, a per-entry `at`
device timestamp, and hard caps (≤100 entries, message ≤4000 chars). See
`docs/plans/ios-log-forwarding.md` chunk 1 and `docs/mobile-contract.md` §5.7.

Rendering stays `ts [level] message` when there's no `source` (today's web
shape, unchanged except control-character normalization); gains a `[source]`
tag when present, and `[source@<at>]` once `at` drifts more than 5s from the
server's receipt time — the case where a queued entry flushes long after the
incident it describes.

Durability changes too: this route now writes through
`appendRollingLogStrict`, so a filesystem failure makes the mutation reject
(rather than silently 200) — the mobile client only clears its queued copy on
a real 2xx.

```ts setup
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { makeTestServer } from "../helpers/doctest-server.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "mobile-contract", "fixtures", "debug-log-submit");

function loadSubmitFixtures() {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, fixture: JSON.parse(readFileSync(join(FIXTURES_DIR, file), "utf-8")) }));
}

// POST every fixture's `expected` body exactly as the phone would send it.
async function postSubmitFixtures(server, fixtures) {
  const lines = [];
  for (const { file, fixture } of fixtures) {
    const res = await server.request({
      method: "POST",
      url: "/api/trpc/debugLog.submit",
      payload: fixture.expected,
    });
    lines.push(`${file} ${res.statusCode} ${JSON.stringify(res.body)}`);
  }
  return lines.join("\n");
}

function caller(boxRoot) {
  const ctx = {
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
    user: null,
    authed: true,
    isOwner: true,
  };
  return appRouter.createCaller(ctx);
}

async function code(p) {
  return p.then(() => "none", (e) => e.code);
}

const LOG_PATH = ".callback-box/client-debug.log";
```

## Web-shaped input (no `source`) renders exactly as before, modulo control-char normalization

```ts
const box = await makeTmpBox({ git: true });
const c = caller(box.root);

await c.debugLog.submit({
  entries: [
    { level: "error", message: "Something broke" },
    { level: "warn", message: "multiline\nmessage\rwith\tcontrol chars" },
  ],
});

const lines = (await box.read(LOG_PATH)).trim().split("\n");
lines[0]
=> «date» [error] Something broke

// CR/LF/tab all collapse to single spaces -- a crafted message can't forge
// extra log lines.
lines[1]
=> «date» [warn] multiline message with control chars

lines.length
=> 2
```

The in-memory ring buffer (`debugLog.get`) is untouched by the tagging
change when there's no `source`.

```ts continue
const got = await c.debugLog.get();
JSON.stringify(got.entries.map((e) => e.message))
=> ["Something broke","multiline message with control chars"]
```

```ts cleanup
await box.cleanup();
```

## iOS-shaped input: `source` tags every line; `at` only surfaces once it drifts >5s from receipt

```ts
const box = await makeTmpBox({ git: true });
const c = caller(box.root);

const recentAt = new Date(Date.now() - 1000).toISOString(); // 1s ago: no tag
const staleAt = new Date(Date.now() - 3600_000).toISOString(); // 1h ago: tagged

await c.debugLog.submit({
  source: "ios",
  entries: [
    { level: "error", message: "capture: upload failed", at: recentAt },
    { level: "warn", message: "capture: retrying after failure", at: staleAt },
  ],
});

const lines = (await box.read(LOG_PATH)).trim().split("\n");
lines[0]
=> «date» [error] [ios] capture: upload failed

lines[1]
=> «date» [warn] [ios@«date»] capture: retrying after failure
```

The ring buffer entry's `message` carries the same `[source]`/`[source@<at>]`
tag baked in -- `debugLog.get` stays a flat `{ts,level,message}` shape.

```ts continue
const got = await c.debugLog.get();
got.entries[0].message
=> [ios] capture: upload failed

got.entries[1].message.startsWith("[ios@")
=> true
```

```ts cleanup
await box.cleanup();
```

## Caps and the closed level enum are enforced (`BAD_REQUEST`)

```ts
const box = await makeTmpBox({ git: true });
const c = caller(box.root);

// Message over the 4000-char cap.
await code(c.debugLog.submit({ entries: [{ level: "error", message: "x".repeat(4001) }] }))
=> BAD_REQUEST

// Level outside the closed enum.
await code(c.debugLog.submit({ entries: [{ level: "debug", message: "hi" }] }))
=> BAD_REQUEST

// More than 100 entries in a batch.
const tooMany = Array.from({ length: 101 }, () => ({ level: "log", message: "x" }));
await code(c.debugLog.submit({ entries: tooMany }))
=> BAD_REQUEST

// Bad source slug (uppercase not allowed).
await code(c.debugLog.submit({ source: "iOS", entries: [{ level: "error", message: "hi" }] }))
=> BAD_REQUEST
```

Nothing landed in the log file from any of the rejected batches.

```ts continue
await box.read(LOG_PATH).catch((e) => e.code)
=> ENOENT
```

```ts cleanup
await box.cleanup();
```

## Unknown extra keys are stripped (forward-compat), entries still land

A plain (non-strict) `z.object` -- old server against a newer client that
started sending fields it doesn't know yet -- degrades to today's behavior
instead of rejecting the whole batch.

```ts
const box = await makeTmpBox({ git: true });
const c = caller(box.root);

await c.debugLog.submit({
  source: "ios",
  futureTopLevelField: "ignored",
  entries: [{ level: "error", message: "still lands", at: new Date().toISOString(), futureEntryField: 123 }],
});

const lines = (await box.read(LOG_PATH)).trim().split("\n");
lines[0]
=> «date» [error] [ios] still lands
```

```ts cleanup
await box.cleanup();
```

## A filesystem write failure makes the mutation reject (strict durability)

Unlike the old lenient `appendRollingLog`, this route's write goes through
`appendRollingLogStrict` -- so a 2xx really does mean "durably written," and a
mobile client that only clears its queue on 2xx never loses entries to a
swallowed disk error. Simulated here by making the log file's path itself a
directory, so `fs.appendFile` fails with `EISDIR`.

```ts
const box = await makeTmpBox({ git: true });
const c = caller(box.root);

await box.write(`${LOG_PATH}/blocker`, "occupying the path as a directory");

await code(c.debugLog.submit({ entries: [{ level: "error", message: "should not silently vanish" }] }))
=> INTERNAL_SERVER_ERROR
```

```ts cleanup
await box.cleanup();
```

## Raw HTTP: the exact Swift-shaped wire body decodes and lands

Pins the non-batched tRPC HTTP-RPC shape a Swift `URLSession` POST actually
sends -- the input object as the raw JSON body, no `LogForwarder.swift`
process in the loop.

```ts
const server = await makeTestServer();

const res = await server.request({
  method: "POST",
  url: "/api/trpc/debugLog.submit",
  payload: { source: "ios", entries: [{ level: "error", message: "capture: probe", at: "2026-08-03T12:00:00Z" }] },
});
res.statusCode
=> 200

JSON.stringify(res.body)
=> {"result":{"data":{"ok":true}}}

const line = (await server.read(LOG_PATH)).trim();
/^\S+ \[error\] \[ios(@[^\]]+)?\] capture: probe$/.test(line)
=> true
```

```ts cleanup
await server.cleanup();
```

## The shared golden fixtures POST verbatim and land

`test/mobile-contract/fixtures/debug-log-submit/` holds the same vectors
`LogForwarderTests.testFlushPostsTheFixtureWireShape` asserts the Swift encoder
produces. Here each fixture's `expected` body -- the exact bytes the phone puts
on the wire -- is POSTed as-is, so a change to either side fails the other's
suite. Every entry is stale by fixture design (a fixed 2026 timestamp), so all
of them render with the `[ios@<at>]` incident-time tag.

```ts
const server = await makeTestServer();
const fixtures = loadSubmitFixtures();

fixtures.length > 0
=> true

await postSubmitFixtures(server, fixtures)
=> capture-upload-failure.json 200 {"result":{"data":{"ok":true}}}
mixed-level-batch.json 200 {"result":{"data":{"ok":true}}}
```

Every fixture entry landed as its own tagged line, in order, with the message
the fixture pins.

```ts continue
const lines = (await server.read(LOG_PATH)).trim().split("\n");
const expectedMessages = fixtures.flatMap(({ fixture }) => fixture.expected.entries);
lines.length === expectedMessages.length
=> true

lines.every((line, i) => line.endsWith(` ${expectedMessages[i].message}`))
=> true

lines.every((line, i) => line.includes(`[${expectedMessages[i].level}] [ios@`))
=> true
```

```ts cleanup
await server.cleanup();
```
