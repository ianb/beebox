// # routedSender: finalize's sweeps send through the box server
//
// `bbx finalize` runs as a tooling child that holds the box environment
// (`BBX_SERVER_URL`, `BBX_BOX_NAME`, `BBX_AGENT_TOKEN`) and none of the channel
// keys. `routedSender` sends through the server's `notifications.send` when all
// three are set, and in this process when one is missing. See docs/plans/on-demand-job-triggers.md, Track A.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { routedSender } from "../../../src/cli/lib/notify-route.js";
import { boxSlug } from "../../../src/lib/box-slug.js";
import { addSubscription } from "../../../src/core/push-subscriptions.js";
import { createFakePush } from "../../../src/services/push.js";
import { createFakeApns } from "../../../src/services/apns.js";
import { pairFakePushDevice } from "../../../src/core/mobile/pairing.js";
import { getOrCreateAgentToken } from "../../../src/core/agent/token.js";
import { parseTarget } from "../../../src/core/notification/target.js";
import { makeTestServer, TEST_SLUG } from "../../helpers/test-route-server.js";

const storeDir = path.join(os.tmpdir(), `bbx-notify-route-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = storeDir;
const ENV = ["BBX_SERVER_URL", "BBX_BOX_NAME", "BBX_AGENT_TOKEN"] as const;
for (const name of [...ENV, "BBX_VAPID_PUBLIC_KEY", "BBX_VAPID_PRIVATE_KEY", "BBX_NOTIFY_FAKE", "BBX_PUSH_FAKE", "BBX_APNS_KEY_PATH", "BBX_PUBLIC_URL", "PUBLIC_URL"]) delete process.env[name];

const INTENT = { title: "Reminder", body: "A question is waiting", target: parseTarget("dashboard"), loudness: "quiet", source: "question-nudge" } as const;

void test("With the box environment the server sends; without it, this process does", async (t) => {
  const serverApns = createFakeApns();
  const serverPush = createFakePush();
  const server = await makeTestServer({ openAccess: false, services: { notify: { apns: serverApns, push: serverPush } } });
  t.teardown(async () => {
    for (const name of ENV) delete process.env[name];
    await server.cleanup();
    await fs.rm(storeDir, { recursive: true, force: true });
  });
  await pairFakePushDevice(server.boxRoot, { label: "test phone" });
  await addSubscription({
    boxSlug: await boxSlug(server.boxRoot),
    subscription: { endpoint: "https://push.example/phone", keys: { p256dh: "p", auth: "a" } },
    now: new Date(),
  });
  process.env.BBX_SERVER_URL = await server.server.listen({ port: 0, host: "127.0.0.1" });
  process.env.BBX_BOX_NAME = TEST_SLUG;
  process.env.BBX_AGENT_TOKEN = getOrCreateAgentToken(server.boxRoot);

  // This process's own services stay untouched: the server's fakes take the send.
  const localPush = createFakePush();
  const routed = routedSender(server.boxRoot, { push: localPush });
  const sent = await routed.send({ intent: INTENT });
  t.check(
    { deliveries: sent.deliveries, server: [serverApns.sent.length, serverPush.sent.length], local: localPush.sent },
    {
      deliveries: [{ channel: "apns", status: "sent" }, { channel: "web-push", status: "sent" }],
      server: [1, 1],
      local: [],
    },
  );

  // With one variable missing it sends in this process, with its own services:
  // the local fake push takes it, and the paired phone has no APNs key here.
  delete process.env.BBX_AGENT_TOKEN;
  const local = await routedSender(server.boxRoot, { push: localPush }).send({ intent: INTENT });
  t.check(
    { deliveries: local.deliveries, server: [serverApns.sent.length, serverPush.sent.length], local: localPush.sent.length },
    {
      deliveries: [{ channel: "apns", status: "skipped", detail: "unconfigured" }, { channel: "web-push", status: "sent" }],
      server: [1, 1],
      local: 1,
    },
  );
});
