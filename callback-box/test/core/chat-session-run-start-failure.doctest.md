# A run that fails to start leaves the session usable

When `backend.start()` throws — the real case is an SDK subprocess spawn failing
with `EBADF` once the process is out of file descriptors
(`issues/bugs/2026-08-03-intermittent-spawn-ebadf-sdk-chat-run.md`) — the session
used to be left in the `starting` phase. That reads as permanently busy, and
neither `stop()` nor `restart()` can clear it because both need a live run to
close, so every later message queued behind a turn that would never end. The
observable symptom was a chat that had to be recovered by restarting `cb serve`.

`openChatRun` now unwinds: it releases the chat-active lock, returns the session
to `idle`, and rethrows so the caller can report the failure.

```ts setup
import { ChatSession } from "../../src/core/chat/session/index.js";
import { createFakeChatBackend } from "../../src/services/claude-chat.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { tick } from "../helpers/chat-session-spawner-helpers.js";
```

## The failure propagates, and the session goes back to idle

```ts
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const session = new ChatSession(box.root, { backend, skipBootstrap: true });

backend.failNextStart = Object.assign(new Error("spawn EBADF"), { code: "EBADF" });

let caught = "none";
try {
  await session.send("hello");
} catch (e) {
  caught = e instanceof Error ? e.message : String(e);
}

`${caught} | busy=${session.isBusy()} | running=${session.isRunning()}`
=> spawn EBADF | busy=false | running=false
```

```ts cleanup
session.stop();
await box.cleanup();
```

## The next send starts a run normally

The point of resetting to `idle`: the very next message works, with no restart
and no operator intervention.

```ts
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const session = new ChatSession(box.root, { backend, skipBootstrap: true });

backend.failNextStart = new Error("spawn EBADF");
await session.send("first").catch(() => undefined);

const sent = await session.send("second");
await tick();

`sent=${sent} | runs=${backend.runs.length} | busy=${session.isBusy()}`
=> sent=true | runs=1 | busy=true
```

```ts cleanup
session.stop();
await box.cleanup();
```

## A failed start does not strand the chat-active run lock

A lock left held would make `cb tick` defer commits indefinitely against a run
that never started.

```ts
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const session = new ChatSession(box.root, { backend, skipBootstrap: true });

backend.failNextStart = new Error("spawn EBADF");
await session.send("hello").catch(() => undefined);

const { readdir } = await import("node:fs/promises");
const stateDir = await readdir(`${box.root}/.callback-box`).catch(() => [] as string[]);

stateDir.filter((f) => f.includes("chat-active")).join(",")
=>
```

```ts cleanup
session.stop();
await box.cleanup();
```
