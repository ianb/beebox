# Codex repair scans: kept off the place menu, remembered across restarts

A Codex chat's existence and date come from Codex's thread index. When a husk
names a thread the index lacks, the listing can ask Codex for a repair scan,
which reads every Codex session on the host: about 20 s on a dev machine.
Two rules keep that scan off the paths a user waits on:

- The app bar's place menu never asks for it. It only counts recent chats.
- The ids a scan looked for are recorded in the box's runtime state, so a
  later server process does not scan for them again. The record used to be
  held in memory, so every restart paid for the scan once more.

This runs the real Codex app-server against the test suite's isolated Codex
home, which has never seen the husk's thread, so the index lacks it.

```ts setup
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { makeTmpBox } from "../../../../helpers/doctest-helpers.js";
import { appRouter } from "../../../../../src/webapp/trpc/routers.js";
import { loadDeadHusks, listSessionEntries } from "../../../../../src/core/chat/session/list/core.js";
import { localOrigin } from "../../../../../src/core/chat/session/origin.js";

const CODEX_CHAT = "33333333-3333-4333-8333-333333333333";
const RECORD = ".beebox/codex-repair-attempted.json";

function caller(boxRoot) {
  const ctx = {
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
  };
  return appRouter.createCaller(ctx);
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

const box = await makeTmpBox();
await mkdir(box.path("_content/chat/web"), { recursive: true });
const here = await localOrigin();
await writeFile(
  box.path("_content/chat/web/2026-10-05_33333333.chat.card"),
  `---\nsession: ${CODEX_CHAT}\nengine: codex\norigin: ${here.id}\norigin-name: ${here.name}\n---\n`,
);
```

The place menu lists without a repair scan. A scan always writes the record,
so no record means no scan ran:

```ts
(await caller(box.root).chat.placeMenu()).rootFreshCount
=> 0

await exists(box.path(RECORD))
=> false
```

A listing that shows dead chats, like the chats picker, does scan, because
it must not call a chat dead that the index merely lacks. The scan does not
find this thread, so the husk is dead, and its id is now on disk:

```ts continue
JSON.stringify((await loadDeadHusks(box.root)).map((husk) => husk.sessionId))
=> ["33333333-3333-4333-8333-333333333333"]

JSON.parse(await readFile(box.path(RECORD), "utf-8"))
=> {"ids":["33333333-3333-4333-8333-333333333333"]}
```

The record holds only ids that still have husks. Once the chat's husk is
gone, the next scan drops its id, so the file never outgrows the box's
chats:

```ts continue
const OTHER_CHAT = "44444444-4444-4444-8444-444444444444";
await writeFile(
  box.path("_content/chat/web/2026-10-05_33333333.chat.card"),
  `---\nsession: ${OTHER_CHAT}\nengine: codex\norigin: ${here.id}\norigin-name: ${here.name}\n---\n`,
);
(await listSessionEntries(box.root)).length
=> 0

JSON.parse(await readFile(box.path(RECORD), "utf-8"))
=> {"ids":["44444444-4444-4444-8444-444444444444"]}
```
