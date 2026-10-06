# Quick chat record ids cannot name a path

A quick chat record lives at `.beebox/quick-chat/<id>.json`, so the id the
caller sends becomes part of a file path. Every procedure that takes an id
accepts only a UUID: a path string is refused before any file is read or
written. The behavior of each procedure is in `quick-chat.submit.doctest.md`.

```ts setup
import { readdir } from "node:fs/promises";
import { quickChatRouter } from "../../../../src/webapp/trpc/routers/quick-chat.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";

function caller(boxRoot) {
  return quickChatRouter.createCaller({ boxRoot, boxSlug: "test", authed: true, services: { jev: undefined },
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} } });
}
async function code(run) {
  try { await run(); return "unexpected success"; }
  catch (error) { return error.code; }
}
```

```ts
const box = await makeTmpBox();
const api = caller(box.root);
[
  await code(() => api.submit({ id: "../escape", message: "Keep this" })),
  await code(() => api.choose({ id: "../../_config/box", candidateId: "c0" })),
  await code(() => api.discard({ id: "open/../x" })),
]
=> ["BAD_REQUEST", "BAD_REQUEST", "BAD_REQUEST"]

(await readdir(box.root, { recursive: true })).filter((entry) => entry.includes("quick-chat"))
=> []
```

```ts cleanup
await box.cleanup();
```
