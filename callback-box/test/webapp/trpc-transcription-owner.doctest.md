# Repointing the transcription backend is owner-only

`setService` / `setHqService` decide which provider's key future transcriptions
spend. Under `publicProcedure` any box-auth'd caller — a shared browser session,
a paired device, a box agent holding the loopback token — could repoint the box
onto a different backend; they are `ownerProcedure` now (secret-custody plan,
Decision 6). Reading `config` stays public: the chat UI shows the current
service to everyone who can see the chat.

```ts setup
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transcriptionRouter } from "../../src/webapp/trpc/routers/transcription.js";

/** A caller with the gate booleans denied by default; override per case. */
function caller(boxRoot, over) {
  return transcriptionRouter.createCaller({
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
    user: null,
    authed: false,
    isOwner: false,
    ...over,
  });
}

async function attempt(fn) {
  try {
    return await fn();
  } catch (e) {
    return `THREW:${e.code}`;
  }
}
```

## An authenticated non-owner is refused, and nothing is written

```ts
const boxRoot = await mkdtemp(join(tmpdir(), "cb-transcription-owner-"));

print(await attempt(() => caller(boxRoot, { authed: true }).setService({ service: "deepgram" })));
print(await attempt(() => caller(boxRoot, { authed: true }).setHqService({ hqService: "voxtral" })));
const stillDefault = await caller(boxRoot, { authed: true }).config();
print(JSON.stringify(stillDefault));
=>
THREW:FORBIDDEN
THREW:FORBIDDEN
{"service":"voxtral","hqService":"whisper"}
```

## The owner repoints it, and the change lands on disk

```ts continue
print(JSON.stringify(await caller(boxRoot, { isOwner: true }).setService({ service: "deepgram" })));
print(JSON.stringify(await caller(boxRoot, { isOwner: true }).setHqService({ hqService: "voxtral-diarized" })));
print((await readFile(join(boxRoot, "config/transcription.json"), "utf-8")).trim());
=>
{"service":"deepgram"}
{"hqService":"voxtral-diarized"}
{
  "service": "deepgram",
  "hqService": "voxtral-diarized"
}
```

```ts cleanup
await rm(boxRoot, { recursive: true, force: true });
```
