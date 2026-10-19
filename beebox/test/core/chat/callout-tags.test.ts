// # Callouts at turn end
//
// A `<callout>` marks content the person must read. At turn end the server
// parses a turn's callouts (`parseCalloutTags`) and sends one notification for
// them (`notifyTurnCallouts`): titled by the first callout's `context`, carrying
// its body, as loud as the loudest `loudness` any callout asked for (else `dot`),
// targeting the chat session. See docs/implemented-plans/notifications.md (Track E).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, capture, isoDate, type Pattern } from "@ianbicking/tap-check/check";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { boxSlug } from "../../../src/lib/box-slug.js";
import { makeTmpBox, type TmpBox } from "../../helpers/test-helpers.js";
import { parseCalloutTags, notifyTurnCallouts } from "../../../src/core/chat/callout-tags.js";
import { addSubscription } from "../../../src/core/push-subscriptions.js";
import { createFakePush } from "../../../src/services/push.js";
import { readRecent } from "../../../src/core/notification/log.js";
import { writePresence } from "../../../src/core/notification/presence.js";

const storeDir = path.join(os.tmpdir(), `bbx-callouts-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = storeDir;
for (const name of ["BBX_NOTIFY_FAKE", "BBX_PUSH_FAKE"]) delete process.env[name];

const SESSION = "5f0c2a9e-1111-4c1d-9e2b-000000000001";
const SUB = { endpoint: "https://push.example/callouts", keys: { p256dh: "p", auth: "a" } };

/** The newest logged intent and its deliveries, or undefined when nothing was logged. */
async function lastLogged(box: TmpBox) {
  const n = (await readRecent(box.root, { days: 1 })).at(-1);
  if (n === undefined) return;
  const { title, body, target, loudness, tag, source } = n.intent;
  return { intent: { loudness, title, target, tag, source, body }, deliveries: n.deliveries };
}

const TARGET = `chat:${SESSION}`;

/** The logged intent for a callout notification of this chat. */
const intent = (fields: { loudness: "quiet" | "loud" | "dot"; title: string; body: string }) => ({
  ...fields,
  target: TARGET,
  tag: SESSION,
  source: TARGET,
});

/** One channel's logged delivery of a notification. */
const delivery = (d: {
  id: Pattern<string>;
  channel: "apns" | "web-push";
  status: "sent" | "skipped";
  detail?: "no-audience" | "present";
}) => ({
  kind: "delivery" as const,
  at: isoDate(),
  notificationId: d.id,
  channel: d.channel,
  status: d.status,
  ...(d.detail === undefined ? {} : { detail: d.detail }),
});

// ## Parsing
//
// A callout needs a `context` and a body, as the frontend's `parseCallouts`
// requires; one missing either is not a callout and sends nothing. `loudness` is
// optional; an unknown `loudness` is ignored (with a warning), and the body is
// trimmed:
void test("A callout needs a context and a body, as the frontend's parseCallouts require...", async (t) => {
  t.check(
    parseCalloutTags(`Done.
<callout context="you asked about Saturday">
Saturday: sunny, high of 72.
</callout>
<callout loudness="loud">No context, so not a callout.</callout>
<callout context="empty" loudness="loud">  </callout>
<callout context="the form" loudness="loud">The form is due Friday.</callout>
<callout context="odd" loudness="shout">Odd one.</callout>`),
    [
    {
      context: "you asked about Saturday",
      loudness: null,
      body: "Saturday: sunny, high of 72.",
    },
    {
      context: "the form",
      loudness: "loud",
      body: "The form is due Friday.",
    },
    {
      context: "odd",
      loudness: null,
      body: "Odd one.",
    },
  ],
  );

  t.check(parseCalloutTags("No tags here, and <speech>not a callout</speech>."), []);
});

// ## A turn without callouts sends nothing
void test("A turn without callouts sends nothing", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await fs.rm(storeDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await addSubscription({ boxSlug: await boxSlug(box.root), subscription: SUB, now: new Date() });
  const push = createFakePush();
  const slug = await boxSlug(box.root);

  t.check(await notifyTurnCallouts(box.root, { text: "All filed.", sessionId: SESSION, services: { push } }), null);

  t.check(await lastLogged(box), undefined);

  t.check(await notifyTurnCallouts(box.root, { text: "<callout loudness=\"loud\">No context.</callout>", sessionId: SESSION, services: { push } }), null);

  // ## A `quiet` callout with nobody present is pushed
  //
  // The loudest callout sets the loudness; the first one titles (by its
  // `context`) and carries the notification.

  const text = `<callout context="the field trip" loudness="quiet">The school moved the field trip to Thursday.
Forms are due Wednesday.</callout> and <callout context="later">second</callout>`;
  await notifyTurnCallouts(box.root, { text, sessionId: SESSION, services: { push } });
  const fieldTrip = capture(any(String));
  t.check(await lastLogged(box), {
    intent: intent({ loudness: "quiet", title: "the field trip", body: "The school moved the field trip to Thursday.\nForms are due Wednesday." }),
    deliveries: [delivery({ id: fieldTrip, channel: "apns", status: "skipped", detail: "no-audience" }), delivery({ id: fieldTrip, channel: "web-push", status: "sent" })],
  });

  t.check(push.sent, [{
    endpoint: SUB.endpoint,
    payload: {
      icon: `${slug}/icon-192.png`,
      title: "the field trip",
      body: "The school moved the field trip to Thursday.\nForms are due Wednesday.",
      url: `/${slug}/chat?session=${SESSION}`,
      tag: SESSION,
      silent: true,
    },
  }]);

  // ## With someone present, a callout is not pushed, however loud
  //
  // The callout is on screen in the open app, so each channel logs
  // `skipped: present`, for a `quiet` callout and for a `loud` one alike.

  await writePresence(box.root, { activeWeb: 1, now: new Date() });
  await notifyTurnCallouts(box.root, { text: "<callout context=\"you asked\" loudness=\"quiet\">Booked.</callout>", sessionId: SESSION, services: { push } });
  const booked = capture(any(String));
  t.check(await lastLogged(box), {
    intent: intent({ loudness: "quiet", title: "you asked", body: "Booked." }),
    deliveries: [delivery({ id: booked, channel: "apns", status: "skipped", detail: "present" }), delivery({ id: booked, channel: "web-push", status: "skipped", detail: "present" })],
  });

  t.check(push.sent, [{
    endpoint: SUB.endpoint,
    payload: {
      icon: `${slug}/icon-192.png`,
      title: "the field trip",
      body: "The school moved the field trip to Thursday.\nForms are due Wednesday.",
      url: `/${slug}/chat?session=${SESSION}`,
      tag: SESSION,
      silent: true,
    },
  }]);

  // Two callouts, one `loud`: still on screen, still not pushed.

  const two = "<callout context=\"first\">Filed.</callout><callout context=\"the form\" loudness=\"loud\">Due Friday.</callout>";
  await notifyTurnCallouts(box.root, { text: two, sessionId: SESSION, services: { push } });
  const filed = capture(any(String));
  t.check(await lastLogged(box), {
    intent: intent({ loudness: "loud", title: "first", body: "Filed." }),
    deliveries: [delivery({ id: filed, channel: "apns", status: "skipped", detail: "present" }), delivery({ id: filed, channel: "web-push", status: "skipped", detail: "present" })],
  });

  t.check(push.sent, [{
    endpoint: SUB.endpoint,
    payload: {
      icon: `${slug}/icon-192.png`,
      title: "the field trip",
      body: "The school moved the field trip to Thursday.\nForms are due Wednesday.",
      url: `/${slug}/chat?session=${SESSION}`,
      tag: SESSION,
      silent: true,
    },
  }]);

  // A callout with no `loudness` is a `dot`: a badge on paired phones only, sent
  // whatever the presence.

  await notifyTurnCallouts(box.root, { text: "<callout context=\"note\">Filed the receipt.</callout>", sessionId: SESSION, services: { push } });
  const dot = capture(any(String));
  t.check(await lastLogged(box), {
    intent: intent({ loudness: "dot", title: "note", body: "Filed the receipt." }),
    deliveries: [delivery({ id: dot, channel: "apns", status: "skipped", detail: "no-audience" })],
  });

  // With nobody present, the same `loud` pair is pushed.

  await writePresence(box.root, { activeWeb: 0, now: new Date() });
  await notifyTurnCallouts(box.root, { text: two, sessionId: SESSION, services: { push } });
  const pushed = capture(any(String));
  t.check(await lastLogged(box), {
    intent: intent({ loudness: "loud", title: "first", body: "Filed." }),
    deliveries: [delivery({ id: pushed, channel: "apns", status: "skipped", detail: "no-audience" }), delivery({ id: pushed, channel: "web-push", status: "sent" })],
  });

  t.check(push.sent, [{
    endpoint: SUB.endpoint,
    payload: {
      icon: `${slug}/icon-192.png`,
      title: "the field trip",
      body: "The school moved the field trip to Thursday.\nForms are due Wednesday.",
      url: `/${slug}/chat?session=${SESSION}`,
      tag: SESSION,
      silent: true,
    },
  }, {
    endpoint: SUB.endpoint,
    payload: {
      icon: `${slug}/icon-192.png`,
      title: "first",
      body: "Filed.",
      url: `/${slug}/chat?session=${SESSION}`,
      tag: SESSION,
      silent: false,
    },
  }]);
});
