// # Health box-growth decisions are owner-only
//
// Acknowledgement accepts only the observed change. A separate mutation stores
// durable expectations for currently warning rates. Both suppress operational
// warnings and therefore require the owner.

import { test } from "tap";
import "agent-doctest/tap";
import { any, isoDate } from "agent-doctest/check";
import * as fs from "node:fs/promises";
import { appRouter } from "../../../../../src/webapp/trpc/routers.js";
import type { TrpcContext } from "../../../../../src/webapp/trpc/context.js";
import {
  boxGrowthStatePath,
  measureBoxGrowthIfDue,
  readBoxGrowthState,
} from "../../../../../src/core/box-growth/health.js";
import { makeTmpBox } from "../../../../helpers/test-helpers.js";
import { trpcContext } from "../../../../helpers/trpc-context.js";

function caller(boxRoot: string, isOwner: boolean) {
  const ctx: TrpcContext = trpcContext({
    boxRoot,
    user: { email: "owner@example.com", name: "Owner" },
    isOwner,
    isAuthenticatedOwner: isOwner,
  });
  return appRouter.createCaller(ctx);
}

const box = await makeTmpBox({ git: true });
const measured = await measureBoxGrowthIfDue(box.root, {
  now: new Date("2026-08-05T10:00:00.000Z"),
});
if (measured.status !== "measured") throw new Error("expected initial measurement");
if (measured.state.status !== "measured") throw new Error("expected a measured state");
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
};
await fs.writeFile(boxGrowthStatePath(box.root), `${JSON.stringify(warningState, null, 2)}\n`);

// ## A non-owner cannot acknowledge or change expectations
void test("A non-owner cannot acknowledge or change expectations", async (t) => {
  // doctest:L53
  const deniedAcknowledge = await caller(box.root, false).health.acknowledgeBoxGrowth().then(
    () => "allowed",
    (error) => error.code,
  );
  const deniedExpectation = await caller(box.root, false).health.expectBoxGrowthRates().then(
    () => "allowed",
    (error) => error.code,
  );
  t.check([deniedAcknowledge, deniedExpectation], ["FORBIDDEN", "FORBIDDEN"]);
  // State is unchanged after the rejected call.
  const afterDenied = await readBoxGrowthState(box.root);
  if (afterDenied.status !== "measured") throw new Error("expected measured state");
  t.check(afterDenied.previous.measuredAt, "2026-08-05T10:00:00.000Z");
});

// ## Acknowledgement preserves rate sensitivity
void test("Acknowledgement preserves rate sensitivity", async (t) => {
  // doctest:L73
  const result = await caller(box.root, true).health.acknowledgeBoxGrowth();
  const accepted = await readBoxGrowthState(box.root);
  if (accepted.status !== "measured") throw new Error("expected measured state");
  // The whole state is a large generated snapshot of the tmp box (git hash, byte sizes),
  // so the checks cover the fields the acknowledgement changes.
  t.check(result, { success: true });
  t.check({ directories: accepted.previous.counts.directories, lastNotice: accepted.lastNotice, rateExpectations: accepted.rateExpectations }, {
    directories: 20000,
    lastNotice: null,
    rateExpectations: [],
  });
});

// ## Expecting current rates stores durable headroom
void test("Expecting current rates stores durable headroom", async (t) => {
  // doctest:L90
  await fs.writeFile(boxGrowthStatePath(box.root), `${JSON.stringify(warningState, null, 2)}\n`);
  const expectedResult = await caller(box.root, true).health.expectBoxGrowthRates();
  const expected = await readBoxGrowthState(box.root);
  if (expected.status !== "measured") throw new Error("expected measured state");
  t.check(expectedResult, { success: true });
  t.check({ directories: expected.previous.counts.directories, rateExpectations: expected.rateExpectations }, {
    directories: 20000,
    // The threshold derives from the tmp box's directory count, which the box template sets.
    rateExpectations: [{ kind: "rate-directories", path: null, thresholdPerHour: any(Number).positive(), setAt: isoDate() }],
  });
});
