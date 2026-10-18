// # push.subscribe / disable / vapidPublicKey
//
// The `push` tRPC router records a browser subscription in the server-level store
// under the request's box slug (`subscribe`), removes it from that box
// (`disable`), and exposes the VAPID public key for the frontend
// (`vapidPublicKey`). The store is keyed by endpoint, so the same browser
// subscribing under two boxes is stored once with both opt-ins.

import { test } from "tap";
import "agent-doctest/tap";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { endpointsForBox } from "../../../../src/core/push-subscriptions.js";

const fixtureBox = await makeTmpBox({ git: true });

const storeDir = path.join(os.tmpdir(), `bbx-push-router-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = storeDir;
delete process.env.BBX_VAPID_PUBLIC_KEY;

function caller(boxSlug: string) {
  const ctx: TrpcContext = trpcContext({ boxRoot: fixtureBox.root, boxSlug, isAuthenticatedOwner: true });
  return appRouter.createCaller(ctx);
}

const SUB = { endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } };

// ## subscribe records the endpoint under the box; idempotent on re-subscribe
void test("subscribe records the endpoint under the box; idempotent on re-subscribe", async (t) => {
  t.teardown(async () => {
    try {
      await fixtureBox.cleanup();
      await fs.rm(storeDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L35
  await caller("alpha").push.subscribe(SUB);
  await caller("alpha").push.subscribe(SUB);
  await t.checkText((await endpointsForBox("alpha")).length, "1");

  // ## Same endpoint under a second box is stored once with both opt-ins

  // doctest:L44
  await caller("beta").push.subscribe(SUB);
  const a = await endpointsForBox("alpha");
  const b = await endpointsForBox("beta");
  t.check([a.length, b.length, a[0]?.endpoint === b[0]?.endpoint], [
    1,
    1,
    true,
  ]);

  // ## disable removes it from one box only

  // doctest:L54
  await caller("alpha").push.disable({ endpoint: SUB.endpoint });
  t.check([(await endpointsForBox("alpha")).length, (await endpointsForBox("beta")).length], [
    0,
    1,
  ]);

  // ## vapidPublicKey reports null when the server has no VAPID key

  // doctest:L62
  t.check(await caller("alpha").push.vapidPublicKey(), {
    publicKey: null,
  });
});
