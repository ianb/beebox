# scheduler.setEnabled / scheduler.trigger

`scheduler.setEnabled` toggles a schedule card's `enabled` flag (adding
`enabled: false` to disable, deleting the key to re-enable) and commits the one
card. The read-modify-write is wrapped in `withCardLock` so overlapping toggles
on the same card serialize
(`issues/closed/bugs/2026-07-04-webapp-mutation-concurrency.md`).
`scheduler.trigger` runs a schedule on demand; the precondition failures it
throws are covered here (running a real script is exercised elsewhere).

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { getLog } from "../../src/lib/git.js";
import { parse as parseYaml } from "yaml";

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

// Read a schedule card's frontmatter as an object.
async function frontmatter(box, name) {
  const text = await box.read(`_config/schedules/${name}.scheduled-script.card`);
  const inner = text.replace(/^---\n/, "").replace(/---\n?$/, "");
  return parseYaml(inner);
}

const SCHED = `---
cron: "0 6 * * *"
description: Morning digest
runs: "true"
---
`;
```

## Disable then re-enable: the flag flips and each change commits

Disabling writes `enabled: false` and commits with the webapp trailers;
re-enabling removes the key again. Sibling fields (`cron`, `runs`) survive both
rewrites.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_config/schedules/digest.scheduled-script.card", SCHED);
box.commitAll("seed");
const c = caller(box.root);

const off = await c.scheduler.setEnabled({ name: "digest", enabled: false });
JSON.stringify(off)
=> {"enabled":false}
```

```ts continue
const fmOff = await frontmatter(box, "digest");
// enabled explicitly false; sibling fields untouched.
JSON.stringify([fmOff.enabled, fmOff.cron, fmOff.runs])
=> [false,"0 6 * * *","true"]
```

```ts continue
const head = (await getLog(box.root, 1))[0];
head.subject
=> Disable schedule: digest

JSON.stringify(head.trailers)
=> {"Source":"webapp","Endpoint":"scheduler.setEnabled"}
```

```ts continue
const on = await c.scheduler.setEnabled({ name: "digest", enabled: true });
JSON.stringify(on)
=> {"enabled":true}

// Re-enabling drops the key entirely (absence == enabled).
"enabled" in (await frontmatter(box, "digest"))
=> false

(await getLog(box.root, 1))[0].subject
=> Enable schedule: digest
```

```ts cleanup
await box.cleanup();
```

## Idempotent no-op: re-enabling an already-enabled schedule doesn't commit

A second `setEnabled(true)` on an already-enabled card produces byte-identical
frontmatter. `stageAndCommitPaths` tolerates the nothing-to-commit case: the
call still returns the state, but HEAD doesn't move. (The first enable can
re-serialize the seed's YAML into canonical form and commit that; the second is
the true no-op.)

```ts
const box = await makeTmpBox({ git: true });
await box.write("_config/schedules/digest.scheduled-script.card", SCHED);
box.commitAll("seed");
const c = caller(box.root);

// First enable settles the card into its canonical serialized form.
await c.scheduler.setEnabled({ name: "digest", enabled: true });
const before = (await getLog(box.root, 1))[0].hash;

// Second enable changes nothing on disk — no new commit.
const res = await c.scheduler.setEnabled({ name: "digest", enabled: true });
const after = (await getLog(box.root, 1))[0].hash;

JSON.stringify(res)
=> {"enabled":true}

before === after
=> true
```

```ts cleanup
await box.cleanup();
```

## setEnabled failure paths: missing schedule, empty name

```ts
const box = await makeTmpBox({ git: true });
const c = caller(box.root);

// No such schedule card.
await code(c.scheduler.setEnabled({ name: "ghost", enabled: false }))
=> NOT_FOUND

// Empty name rejected by input validation.
await code(c.scheduler.setEnabled({ name: "", enabled: false }))
=> BAD_REQUEST
```

```ts cleanup
await box.cleanup();
```

## trigger precondition failures: disabled and missing schedules

A disabled schedule can't be triggered (`BAD_REQUEST`); a missing one is
`NOT_FOUND`. Both throw before any script runs.

```ts
const box = await makeTmpBox({ git: true });
await box.write(
  "_config/schedules/off.scheduled-script.card",
  `---\nenabled: false\nruns: "true"\n---\n`,
);
box.commitAll("seed");
const c = caller(box.root);

const disabled = await c.scheduler.trigger({ name: "off" }).then(() => "none", (e) => `${e.code}:${e.message}`);
disabled
=> BAD_REQUEST:Schedule "off" is disabled

await code(c.scheduler.trigger({ name: "ghost" }))
=> NOT_FOUND
```

```ts cleanup
await box.cleanup();
```

## Concurrency: overlapping enable + disable serialize

Enable and disable launched together against the same card. `withCardLock`
serializes the two read-modify-writes, so each completes its full
read→write→commit atomically: both commits land (one `Enable`, one `Disable`),
and the on-disk `enabled` state matches whichever committed last. Unlocked, the
two writes and commits could interleave and leave disk disagreeing with the
recorded history.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_config/schedules/race.scheduled-script.card", SCHED);
box.commitAll("seed");
const c = caller(box.root);

const [ra, rb] = await Promise.all([
  c.scheduler.setEnabled({ name: "race", enabled: false }),
  c.scheduler.setEnabled({ name: "race", enabled: true }),
]);
// Both calls resolved without a concurrent-write crash.
JSON.stringify([ra, rb])
=> [{"enabled":false},{"enabled":true}]
```

```ts continue
// Both RMWs ran to completion: an Enable and a Disable commit both landed.
const subjects = (await getLog(box.root, 2)).map((l) => l.subject).sort();
JSON.stringify(subjects)
=> ["Disable schedule: race","Enable schedule: race"]
```

```ts continue
// Serialization invariant, whichever call won: the on-disk enabled state
// agrees with the newest commit's action. If the newest commit enabled the
// schedule the key is absent; if it disabled, the key is false. A mismatch
// would mean one call's write and another's commit interleaved.
const newest = (await getLog(box.root, 1))[0].subject;
const fm = await frontmatter(box, "race");
const diskEnabled = !("enabled" in fm);
const newestEnabled = newest.startsWith("Enable");
newestEnabled === diskEnabled
=> true
```

```ts cleanup
await box.cleanup();
```
