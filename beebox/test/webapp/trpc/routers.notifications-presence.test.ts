// # notifications and presence routers
//
// `notifications.recent` and `notifications.get` read the notification log for
// the Admin "Recent" list and the `chat:new` banner. `notifications.send` and
// `notifications.channels` are `bbx notify`'s server side: a box-spawned shell has
// no APNs or VAPID keys, so it asks the server, which has them. `presence.heartbeat` is the
// open tab's report that a person is using it; the server keeps
// `.beebox/presence.json` current from those heartbeats, and `livePresence` (what
// `notifyBoxholder` reads) sees the count.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { any, isoDate, str } from "@ianbicking/tap-check/check";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { trpcContext } from "../../helpers/trpc-context.js";
import { appRouter } from "../../../src/webapp/trpc/routers.js";
import { notifyBoxholder } from "../../../src/core/notify-boxholder.js";
import { livePresence } from "../../../src/core/notification/presence.js";
import { boxSlug } from "../../../src/lib/box-slug.js";
import { addSubscription } from "../../../src/core/push-subscriptions.js";
import { pairFakePushDevice } from "../../../src/core/mobile/pairing.js";
import { createFakePush } from "../../../src/services/push.js";
import { createFakeApns } from "../../../src/services/apns.js";
import type { TrpcContext } from "../../../src/webapp/trpc/context.js";
import { TRPCError } from "@trpc/server";

const storeDir = path.join(os.tmpdir(), `bbx-notifications-router-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = storeDir;
for (const name of ["BBX_VAPID_PUBLIC_KEY", "BBX_VAPID_PRIVATE_KEY", "BBX_NOTIFY_FAKE", "BBX_PUSH_FAKE", "BBX_APNS_KEY_PATH", "BBX_APNS_KEY_ID", "BBX_APNS_TEAM_ID", "BBX_APNS_BUNDLE_ID"]) delete process.env[name];

const box = await makeTmpBox({ git: true });

function caller(over: Partial<TrpcContext>) {
  const ctx: TrpcContext = trpcContext({
    boxRoot: box.root,
    boxSlug: "alpha",
    isAuthenticatedOwner: true,
    ...over,
  });
  return appRouter.createCaller(ctx);
}

async function attempt(fn: () => Promise<unknown>) {
  try {
    return await fn();
  } catch (e) {
    return `THREW:${e instanceof TRPCError ? e.code : String(e)}`;
  }
}

// ## recent: intents with their deliveries, newest first
//
// The box has no channel configured, so each channel is logged `no-audience`.
void test("The box has no channel configured, so each channel is logged no-audience.", async (t) => {
  const first = await notifyBoxholder(box.root, {
    intent: { title: "Field trip form due", body: "Sign by Friday.", target: { kind: "dashboard" }, loudness: "loud", source: "test" },
  });
  const second = await notifyBoxholder(box.root, {
    intent: { title: "Talk about the trip?", body: "", target: { kind: "chat-new" }, loudness: "quiet", source: "test" },
  });
  const recent = await caller({}).notifications.recent({ days: 3 });
  const skipped = (notificationId: string, channel: "apns" | "web-push") => ({
    kind: "delivery" as const,
    at: isoDate(),
    notificationId,
    channel,
    status: "skipped" as const,
    detail: "no-audience",
  });
  t.check(recent, [
    {
      intent: {
        kind: "intent",
        at: isoDate(),
        id: second.id,
        title: "Talk about the trip?",
        body: "",
        target: "chat:new",
        loudness: "quiet",
        source: "test",
      },
      deliveries: [skipped(second.id, "apns"), skipped(second.id, "web-push")],
    },
    {
      intent: {
        kind: "intent",
        at: isoDate(),
        id: first.id,
        title: "Field trip form due",
        body: "Sign by Friday.",
        target: "dashboard",
        loudness: "loud",
        source: "test",
      },
      deliveries: [skipped(first.id, "apns"), skipped(first.id, "web-push")],
    },
  ]);

  // ## get: one intent by id; null for an unknown id
  //
  // A `chat:new` tap carries the id, and the chat page shows the intent. An id the
  // log no longer has (rotated away) is null, not an error.

  const got = await caller({}).notifications.get({ id: second.id });
  t.check(got, {
    intent: {
      kind: "intent",
      at: isoDate(),
      id: second.id,
      title: "Talk about the trip?",
      body: "",
      target: "chat:new",
      loudness: "quiet",
      source: "test",
    },
    deliveries: [skipped(second.id, "apns"), skipped(second.id, "web-push")],
  });

  t.check(await caller({}).notifications.get({ id: "no-such-id" }), null);

  // ## Both routers need an authenticated request

  t.check(await attempt(() => caller({ authed: false }).notifications.recent({})), "THREW:UNAUTHORIZED");

  t.check(await attempt(() => caller({ authed: false }).presence.heartbeat({ sessionId: "tab-aaaaaaaa" })), "THREW:UNAUTHORIZED");

  // ## heartbeat: each tab counts once, and the file reflects it

  await caller({}).presence.heartbeat({ sessionId: "tab-aaaaaaaa" });
  await caller({}).presence.heartbeat({ sessionId: "tab-bbbbbbbb" });
  await caller({}).presence.heartbeat({ sessionId: "tab-aaaaaaaa" });
  t.check(await livePresence(box.root), {
    activeWeb: 2,
  });

  // A malformed session id is rejected:

  t.check(await attempt(() => caller({}).presence.heartbeat({ sessionId: "x" })), "THREW:BAD_REQUEST");
});

// ## send and channels: the box's agent or its owner, on the server's services
void test("send and channels: the box's agent or its owner, on the server's services", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await fs.rm(storeDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // The server's channel services arrive through the context's `services.notify`
  // (production leaves it unset and builds them from the server's keys). This box
  // now has a paired phone and a subscribed browser, and the server holds fakes for
  // both.

  await pairFakePushDevice(box.root, { label: "test phone" });
  await addSubscription({
    boxSlug: await boxSlug(box.root),
    subscription: { endpoint: "https://push.example/phone", keys: { p256dh: "p", auth: "a" } },
    now: new Date(),
  });
  const notify = { apns: createFakeApns(), push: createFakePush() };
  const agent = caller({ actor: "agent", user: null, isOwner: false, isAuthenticatedOwner: false, services: { notify } });

  t.check(await agent.notifications.channels(), {
    reach: {
      apns: true,
      webPush: true,
    },
    configured: {
      apns: true,
      webPush: true,
    },
  });

  // A send runs `notifyBoxholder` in the server process, so the delivery goes out
  // on the server's services and lands in the log like any other:

  const sent = await agent.notifications.send({
    intent: { title: "Pick up Sam", body: "At 3.", target: "chat:new", loudness: "loud", source: "bbx notify" },
  });
  const slug = await boxSlug(box.root);
  t.check(
    { sent, apns: notify.apns.sent, push: notify.push.sent },
    {
      sent: {
        id: sent.id,
        deliveries: [
          { channel: "apns", status: "sent" },
          { channel: "web-push", status: "sent" },
        ],
        shown: true,
      },
      apns: [
        {
          token: str`fake-${any(String)}`,
          environment: "sandbox",
          payload: {
            aps: {
              alert: { title: "Pick up Sam", body: "At 3." },
              "interruption-level": "active",
              badge: 1,
              sound: "default",
            },
            target: "chat:new",
            loudness: "loud",
            notificationId: sent.id,
            box: slug,
          },
          headers: { "apns-push-type": "alert", "apns-topic": "app.beebox.fake" },
        },
      ],
      push: [
        {
          endpoint: "https://push.example/phone",
          payload: {
            icon: `${slug}/icon-192.png`,
            title: "Pick up Sam",
            body: "At 3.",
            url: `/${slug}/chat?new=1&notification=${sent.id}`,
            tag: undefined,
            silent: false,
          },
        },
      ],
    },
  );

  t.check(await caller({}).notifications.get({ id: sent.id }), {
    intent: {
      kind: "intent",
      at: isoDate(),
      id: sent.id,
      title: "Pick up Sam",
      body: "At 3.",
      target: "chat:new",
      loudness: "loud",
      source: "bbx notify",
    },
    deliveries: [
      { kind: "delivery", at: isoDate(), notificationId: sent.id, channel: "apns", status: "sent" },
      { kind: "delivery", at: isoDate(), notificationId: sent.id, channel: "web-push", status: "sent" },
    ],
  });

  // `channel` restricts the send to one channel, as `bbx notify --channel` does:

  const one = await agent.notifications.send({
    intent: { title: "Only the phone", body: "", target: "dashboard", loudness: "loud", source: "bbx notify" },
    channel: "apns",
  });
  // A send restricted to one channel is a test of that channel, so the open app does not count as having shown it.
  t.check(one, { id: any(String), deliveries: [{ channel: "apns", status: "sent" }], shown: false });

  // The signed-in owner may send too. A member who is not the owner, a paired
  // device acting for nobody, and an open-access request are refused: reaching the
  // boxholder's phone is the box's voice. An unauthenticated request never gets
  // that far.

  const intent = { title: "x", body: "", target: "dashboard", loudness: "loud", source: "test" } as const;
  t.check(await caller({ services: { notify } }).notifications.send({ intent }), {
    id: any(String),
    deliveries: [
      { channel: "apns", status: "sent" },
      { channel: "web-push", status: "sent" },
    ],
    shown: true,
  });

  t.check(
    [
      await attempt(() => caller({ user: { email: "member@example.org", name: "Member" }, isOwner: false, isAuthenticatedOwner: false }).notifications.send({ intent })),
      await attempt(() => caller({ actor: "device", isOwner: false, isAuthenticatedOwner: false }).notifications.channels()),
      await attempt(() => caller({ actor: "open", isAuthenticatedOwner: false }).notifications.send({ intent })),
      await attempt(() => caller({ actor: "none", authed: false, isOwner: false, isAuthenticatedOwner: false }).notifications.send({ intent })),
      await attempt(() => caller({ actor: "none", authed: false, isOwner: false, isAuthenticatedOwner: false }).notifications.channels()),
    ],
    ["THREW:FORBIDDEN", "THREW:FORBIDDEN", "THREW:FORBIDDEN", "THREW:UNAUTHORIZED", "THREW:UNAUTHORIZED"],
  );

  // A target the log could not hold is refused at the boundary, before anything is
  // logged or sent:

  t.check(await attempt(() => agent.notifications.send({ intent: { ...intent, target: "card:../outside.card" } })), "THREW:BAD_REQUEST");
});
