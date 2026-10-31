// # What the box tells Settings about this phone and this browser
//
// `pairing.thisDevice` answers from the credential on the request, so one phone
// never reads another's state. `push.isSubscribed` is the box's answer to "is
// this browser on": the browser keeps its subscription after a disable, so its
// own answer goes stale.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { z } from "zod";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { trpcContext } from "../../helpers/trpc-context.js";
import { appRouter } from "../../../src/webapp/trpc/routers.js";
import { createMobilePairingTicket, redeemMobilePairingTicket, registerDevicePush } from "../../../src/core/mobile/pairing.js";

const storeDir = path.join(os.tmpdir(), `bbx-push-this-device-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = storeDir;

const box = await makeTmpBox({ git: true });

async function pair(deviceLabel: string): Promise<string> {
  const ticket = createMobilePairingTicket(box.root, { createdBy: "diana@example.com" });
  const device = await redeemMobilePairingTicket(box.root, { pairingToken: ticket.token, deviceLabel });
  if (!device) throw new Error("the ticket did not redeem");
  return device.deviceId;
}

const caller = (mobileDeviceId: string | null) =>
  appRouter.createCaller(trpcContext({ boxRoot: box.root, boxSlug: "alpha", mobileDeviceId }));

// ## Each phone reads its own state; a browser has no device
void test("thisDevice answers for the device on the request", async (t) => {
  const registered = await pair("registered phone");
  const unregistered = await pair("unregistered phone");
  await registerDevicePush(box.root, { deviceId: registered, token: "abc123", environment: "sandbox" });
  const summary = async (id: string | null) => {
    const { device } = await caller(id).pairing.thisDevice();
    return device === null ? null : { label: device.label, environment: device.push?.environment ?? null, leaksToken: JSON.stringify(device).includes("abc123") };
  };
  t.check(await summary(registered), { label: "registered phone", environment: "sandbox", leaksToken: false });
  t.check(await summary(unregistered), { label: "unregistered phone", environment: null, leaksToken: false });
  t.check(await summary(null), null);
});

// ## "On" follows the box, through subscribe and disable
void test("isSubscribed and subscriberCount follow this box's list", async (t) => {
  const endpoint = "https://push.example/one";
  const push = caller(null).push;
  const state = async () => ({ ...(await push.isSubscribed({ endpoint })), ...(await push.subscriberCount()) });
  t.check(await state(), { subscribed: false, count: 0 });
  await push.subscribe({ endpoint, keys: { p256dh: "p", auth: "a" } });
  t.check(await state(), { subscribed: true, count: 1 });
  // Another box's list is separate.
  const other = appRouter.createCaller(trpcContext({ boxRoot: box.root, boxSlug: "beta", mobileDeviceId: null })).push;
  t.check(await other.isSubscribed({ endpoint }), { subscribed: false });
  await push.disable({ endpoint });
  t.check(await state(), { subscribed: false, count: 0 });
});

// ## Admin's test send is a valid notification for the signed-in owner
void test("the test send's intent passes the send route and reports its deliveries", async (t) => {
  const owner = appRouter.createCaller(trpcContext({ boxRoot: box.root, boxSlug: "alpha", isAuthenticatedOwner: true }));
  const { deliveries } = await owner.notifications.send({
    intent: { title: "Test notification", body: "Sent from Admin.", target: "admin:notifications", loudness: "loud", source: "admin-test" },
  });
  t.check(deliveries.map((d) => d.channel).toSorted(), ["apns", "web-push"]);
});

// ## A browser records who turned it on; a phone already does (`createdBy`)
void test("subscribe records the signed-in person", async (t) => {
  const endpoint = "https://push.example/person";
  const signedIn = appRouter.createCaller(trpcContext({
    boxRoot: box.root, boxSlug: "alpha", user: { email: "tomas@example.com", name: "Tomas" },
  }));
  await signedIn.push.subscribe({ endpoint, keys: { p256dh: "p", auth: "a" } });
  const store = z.record(z.string(), z.looseObject({ subscribedBy: z.string().optional() }))
    .parse(JSON.parse(await fs.readFile(path.join(storeDir, "push-subscriptions.json"), "utf-8")));
  t.check(store[endpoint]?.subscribedBy, "tomas@example.com");
  await signedIn.push.disable({ endpoint });
});
