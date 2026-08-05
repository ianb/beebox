# Health box-growth acceptance is owner-only

The dashboard acknowledgement accepts the latest measured size as the new
baseline. It is an owner mutation because it suppresses an operational warning.

```ts setup
import * as fs from "node:fs/promises";
import { appRouter } from "../../src/webapp/trpc/router.js";
import {
  boxGrowthStatePath,
  measureBoxGrowthIfDue,
  readBoxGrowthState,
} from "../../src/core/box-growth/health.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

function caller(boxRoot, isOwner) {
  return appRouter.createCaller({
    boxRoot,
    boxSlug: "test",
    eventBus: {
      emit: () => 0,
      emitTransient: () => {},
      readSince: () => [],
      subscribe: () => ({ unsubscribe: () => {} }),
      prune: () => 0,
      close: () => {},
    },
    services: {},
    user: { email: "owner@example.com", name: "Owner" },
    authed: true,
    isOwner,
  });
}

const box = await makeTmpBox({ git: true });
const measured = await measureBoxGrowthIfDue(box.root, {
  now: new Date("2026-08-05T10:00:00.000Z"),
});
if (measured.status !== "measured") throw new Error("expected initial measurement");
const warningState = {
  ...measured.state,
  current: {
    ...measured.state.current,
    counts: { ...measured.state.current.counts, directories: 20_000 },
  },
  acknowledgedAt: null,
};
await fs.writeFile(boxGrowthStatePath(box.root), `${JSON.stringify(warningState, null, 2)}\n`);
```

## A non-owner cannot accept the baseline

```ts
const denied = await caller(box.root, false).health.acceptBoxGrowth().then(
  () => "allowed",
  (error) => error.code,
);
print(denied);
// State is unchanged after the rejected call.
const afterDenied = await readBoxGrowthState(box.root);
print(afterDenied.status === "measured" ? afterDenied.acknowledgedAt : "missing");
=>
FORBIDDEN
null
```

## The owner accepts exactly the current measurement

```ts
const result = await caller(box.root, true).health.acceptBoxGrowth();
const accepted = await readBoxGrowthState(box.root);
print(result.success);
if (accepted.status !== "measured") throw new Error("expected measured state");
print(accepted.accepted.counts.directories);
print(accepted.previous.counts.directories);
print(accepted.acknowledgedAt !== null);
=>
true
20000
20000
true
```
