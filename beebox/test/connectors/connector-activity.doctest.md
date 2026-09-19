# Connector activity record

Every connector sync goes through `syncConnector`, which records what the sync
did in the box-local day it ran. The record is what lets the box tell a
connector that stopped producing apart from a quiet week.

```ts setup
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import {
  syncConnector,
  loadConnectorActivity,
  countNewItems,
  addDays,
  ACTIVITY_RETENTION_DAYS,
  ConnectorActivityInvalidError,
} from "../../src/connectors/activity.js";
import { transientStatePath } from "../../src/connectors/transient-state.js";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/** A connector whose next sync returns (or throws) what the test queues. */
function scripted(name, outcomes) {
  return {
    name,
    produces: [],
    inboxPaths: [],
    async sync() {
      const next = outcomes.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
}
const ok = (created, updated = []) => ({ success: true, created, updated });
```

## A new item is a new top-level card

Gmail's `created` lists new message files too, including replies added to
threads the box already tracks. Those live in the thread card's `.attach/`
scope, so only the thread card counts as a new item. Counting raw `created`
would let replies on tracked threads hide a connector that stopped importing
new threads.

```ts
countNewItems([
  "_content/inbox/email/Hello.email-thread.card",
  "_content/inbox/email/Hello.attach/msg-001.email-message.card",
  "_content/inbox/email/Hello.attach/msg-001.attach/photo.jpg",
  "_content/inbox/email/Old.attach/msg-007.email-message.card",
])
=> 1
```

## Each attempt lands in its box-local day

```ts
const box = await makeTmpBox();
const gmail = scripted("gmail", [
  ok(["_content/inbox/email/A.email-thread.card", "_content/inbox/email/A.attach/msg-001.email-message.card"]),
  ok(["_content/inbox/email/B.attach/msg-002.email-message.card"], ["_content/inbox/email/B.email-thread.card"]),
  { success: true, created: [], updated: [], skipped: { reason: "not-configured", detail: "no grant" } },
  { success: true, created: [], updated: [], error: "Draft upload failed for 1 card: x" },
  new Error("network down"),
]);
const now = new Date("2026-09-18T15:00:00Z");
for (let i = 0; i < 4; i++) await syncConnector(gmail, { boxRoot: box.root, now });
const thrown = await syncConnector(gmail, { boxRoot: box.root, now }).catch((e) => e.message);
thrown
=> network down

const file = await loadConnectorActivity(box.root);
JSON.stringify(Object.keys(file.connectors.gmail.days))
=> ["2026-09-18"]

const day = file.connectors.gmail.days["2026-09-18"];
`runs=${day.runs} ok=${day.ok} newItems=${day.newItems} created=${day.created} updated=${day.updated} errored=${day.errored} skipped=${day.skipped}`
=> runs=5 ok=2 newItems=1 created=3 updated=1 errored=2 skipped=1

day.lastError
=> network down
```

The thrown sync is counted as a run: a day where every sync throws must read as
an all-error day, not as a day with no runs.

## Old days are pruned

```ts continue
const later = new Date("2026-11-30T15:00:00Z");
await syncConnector(scripted("gmail", [ok([])]), { boxRoot: box.root, now: later });
const pruned = await loadConnectorActivity(box.root);
JSON.stringify(Object.keys(pruned.connectors.gmail.days))
=> ["2026-11-30"]

addDays("2026-11-30", -(ACTIVITY_RETENTION_DAYS - 1)) > "2026-09-18"
=> true
```

```ts cleanup
await box.cleanup();
```

## A damaged record is reported, and the sync still returns

A record that fails its schema is not reset: that would also drop an open
episode's dismissal. Reading it throws; recording into it logs and leaves the
sync's own result intact.

```ts
const box = await makeTmpBox();
const statePath = transientStatePath(box.root, "connector-activity");
await mkdir(dirname(statePath), { recursive: true });
await writeFile(statePath, JSON.stringify({ version: 1, connectors: { gmail: { days: { "2026-09-18": { runs: -1 } } } } }));

const readError = await loadConnectorActivity(box.root).catch((e) => e);
readError instanceof ConnectorActivityInvalidError
=> true

const logged: string[] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
let result;
try {
  result = await syncConnector(scripted("gmail", [ok(["_content/inbox/email/C.email-thread.card"])]), {
    boxRoot: box.root,
    now: new Date("2026-09-18T15:00:00Z"),
  });
} finally {
  console.error = originalError;
}

`${result.created.length} | ${logged.length} | ${logged[0]?.includes("could not record gmail sync")}`
=> 1 | 1 | true
```

```ts cleanup
await box.cleanup();
```
