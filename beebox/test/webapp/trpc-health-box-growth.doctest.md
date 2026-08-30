# Health box-growth decisions are owner-only

Acknowledgement accepts only the observed change. A separate mutation stores
durable expectations for currently warning rates. Both suppress operational
warnings and therefore require the owner.

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
  previous: {
    ...measured.state.current,
    measuredAt: "2026-08-05T10:00:00.000Z",
  },
  current: {
    ...measured.state.current,
    measuredAt: "2026-08-05T11:00:00.000Z",
    counts: { ...measured.state.current.counts, directories: 20_000 },
  },
  acknowledgedAt: null,
};
await fs.writeFile(boxGrowthStatePath(box.root), `${JSON.stringify(warningState, null, 2)}\n`);
```

## A non-owner cannot acknowledge or change expectations

```ts
const deniedAcknowledge = await caller(box.root, false).health.acknowledgeBoxGrowth().then(
  () => "allowed",
  (error) => error.code,
);
const deniedExpectation = await caller(box.root, false).health.expectBoxGrowthRates().then(
  () => "allowed",
  (error) => error.code,
);
print(`${deniedAcknowledge}:${deniedExpectation}`);
// State is unchanged after the rejected call.
const afterDenied = await readBoxGrowthState(box.root);
print(afterDenied.status === "measured" ? afterDenied.acknowledgedAt : "missing");
=>
FORBIDDEN:FORBIDDEN
null
```

## Acknowledgement preserves rate sensitivity

```ts
const result = await caller(box.root, true).health.acknowledgeBoxGrowth();
const accepted = await readBoxGrowthState(box.root);
print(result.success);
if (accepted.status !== "measured") throw new Error("expected measured state");
print(accepted.accepted.counts.directories);
print(accepted.previous.counts.directories);
print(accepted.acknowledgedAt !== null);
print(accepted.rateExpectations.length);
=>
true
20000
20000
true
0
```

## Expecting current rates stores durable headroom

```ts
await fs.writeFile(boxGrowthStatePath(box.root), `${JSON.stringify(warningState, null, 2)}\n`);
const expectedResult = await caller(box.root, true).health.expectBoxGrowthRates();
const expected = await readBoxGrowthState(box.root);
print(expectedResult.success);
if (expected.status !== "measured") throw new Error("expected measured state");
print(expected.rateExpectations.some((item) => item.kind === "rate-directories"));
print(expected.rateExpectations.some((item) => item.kind === "rate-connector-directories"));
print(expected.acknowledgedAt !== null);
=>
true
true
false
true
```
