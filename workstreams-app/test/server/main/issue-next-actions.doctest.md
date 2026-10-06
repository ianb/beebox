# Issue next-action store

Next actions are the developer's requests to the issue picker. They live in one
JSON file outside git, beside the main checkout, keyed by visibility and slug so
a request follows its issue across `closed/` and category moves.

```ts setup
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  NEXT_ACTIONS_MARKER, nextActionKey, nextActionsRoot, parseNextActionKey, readNextActions, writeNextAction,
} from "../../../src/server/main/issue-next-actions.js";

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "next-actions-"));
const now = () => new Date("2026-10-05T12:00:00Z");
```

## A missing store is empty; the first write creates and marks it

```ts
const root = path.join(scratch, "store");
const before = await readNextActions(root);
const written = await writeNextAction({
  root, key: nextActionKey("private", "2026-08-01-x"), now,
  request: { action: "fixed", message: " Landed in the sync rewrite " },
});
JSON.stringify({
  before: before.size,
  written,
  marker: (await fs.stat(path.join(root, NEXT_ACTIONS_MARKER))).isFile(),
  reread: Object.fromEntries(await readNextActions(root)),
})
=> {"before":0,"written":{"action":"fixed","message":"Landed in the sync rewrite","at":"2026-10-05T12:00:00.000Z"},"marker":true,"reread":{"private/2026-08-01-x":{"action":"fixed","message":"Landed in the sync rewrite","at":"2026-10-05T12:00:00.000Z"}}}
```

## A write replaces the request; an empty one removes it

Setting only an action drops a previous message: a request is replaced whole,
so a stale message never rides along with a new value.

```ts continue
const key = nextActionKey("private", "2026-08-01-x");
const replaced = await writeNextAction({ root, key, now, request: { action: "discuss", message: null } });
const removed = await writeNextAction({ root, key, request: { action: null, message: "   " } });
JSON.stringify({ replaced, removed, left: (await readNextActions(root)).size })
=> {"replaced":{"action":"discuss","at":"2026-10-05T12:00:00.000Z"},"removed":null,"left":0}
```

## The store refuses what it cannot own or read

An unmarked, non-empty directory is not adopted. A file that does not parse is
an error, never an empty map: that would hide the developer's requests. A key
that is not `<visibility>/<slug>` is refused before any write.

```ts continue
const stranger = path.join(scratch, "stranger");
await fs.mkdir(stranger);
await fs.writeFile(path.join(stranger, "notes.txt"), "someone else's\n");
const broken = path.join(scratch, "broken");
await fs.mkdir(broken);
await fs.writeFile(path.join(broken, "next-actions.json"), JSON.stringify({ version: 1, actions: { "public/x": { at: "now" } } }));
const outcome = async (run: () => Promise<unknown>) => run().then(() => "ok", (error: Error) => error.name);
JSON.stringify({
  unmarked: await outcome(() => writeNextAction({ root: stranger, key: "public/x", request: { action: "discuss", message: null } })),
  unparseable: await outcome(() => readNextActions(broken)),
  badKey: await outcome(() => writeNextAction({ root, key: "../x", request: { action: "discuss", message: null } })),
  parsed: parseNextActionKey("public/2026-01-01-y"),
})
=> {"unmarked":"UnmarkedNextActionStoreError","unparseable":"UnreadableNextActionStoreError","badKey":"InvalidNextActionKeyError","parsed":{"visibility":"public","slug":"2026-01-01-y"}}
```

## The root sits beside the main checkout unless overridden

```ts
const previous = process.env["BBX_ISSUE_ACTIONS_ROOT"];
delete process.env["BBX_ISSUE_ACTIONS_ROOT"];
const notGit = await nextActionsRoot(scratch);
process.env["BBX_ISSUE_ACTIONS_ROOT"] = "/tmp/pinned-actions";
const overridden = await nextActionsRoot(scratch);
if (previous === undefined) delete process.env["BBX_ISSUE_ACTIONS_ROOT"];
else process.env["BBX_ISSUE_ACTIONS_ROOT"] = previous;
JSON.stringify({ notGit, overridden })
=> {"notGit":null,"overridden":"/tmp/pinned-actions"}
```
