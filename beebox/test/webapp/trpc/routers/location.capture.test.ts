// # location.capture: store a Geolocation fix from the web frontend
//
// The `location.capture` tRPC mutation validates the posted coordinates, stamps
// `capturedAt`/`source`, and writes the box's last-known fix. Out-of-range input
// is rejected by Zod and nothing is written.

import { test } from "tap";
import "agent-doctest/tap";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { loadLocation } from "../../../../src/core/location-store.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import assert from "node:assert/strict";

// Minimal tRPC context — capture only reads ctx.boxRoot.
function caller(boxRoot: string) {
  const ctx: TrpcContext = trpcContext({ boxRoot });
  return appRouter.createCaller(ctx);
}

// ## Valid capture stores a readable fix, stamped web + capturedAt
void test("Valid capture stores a readable fix, stamped web + capturedAt", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L25
  const box = await makeTmpBox({ git: true });
  await caller(box.root).location.capture({ lat: 45.5, lng: -122.6, accuracy: 15 });
  const stored = await loadLocation(box.root);
  assert.ok(stored);
  t.check({ lat: stored.lat, lng: stored.lng, accuracy: stored.accuracy, source: stored.source }, {
    lat: 45.5,
    lng: -122.6,
    accuracy: 15,
    source: "web",
  });

  // doctest:L32
  t.check(typeof stored.capturedAt, "string");
});

// ## Out-of-range input is rejected; nothing is written
void test("Out-of-range input is rejected; nothing is written", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L43
  const box = await makeTmpBox({ git: true });
  const rejected = await caller(box.root).location.capture({ lat: 999, lng: 0, accuracy: 10 }).then(() => false, () => true);
  t.check(rejected, true);

  // doctest:L48
  t.check(await loadLocation(box.root), null);
});
