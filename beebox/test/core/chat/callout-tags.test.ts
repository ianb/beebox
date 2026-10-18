// # Callouts at turn end
//
// A `<callout>` marks content the person must read. At turn end the server
// parses a turn's callouts (`parseCalloutTags`) and sends one notification for
// them (`notifyTurnCallouts`): titled by the first callout's `context`, carrying
// its body, as loud as the loudest `loudness` any callout asked for (else `dot`),
// targeting the chat session. See docs/implemented-plans/notifications.md (Track E).

import { test } from "tap";
import "agent-doctest/tap";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { boxSlug } from "../../../src/lib/box-slug.js";
import { makeTmpBox, type TmpBox } from "../../helpers/doctest-helpers.js";
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

/** The newest logged intent and its deliveries. */
async function lastLogged(box: TmpBox) {
  const n = (await readRecent(box.root, { days: 1 })).at(-1);
  if (n === undefined) return "nothing logged";
  const { title, body, target, loudness, tag, source } = n.intent;
  const deliveries = n.deliveries.map((d) => `${d.channel} ${d.status}${d.detail ? `: ${d.detail}` : ""}`);
  return [`${loudness} | ${title} | ${target} | tag ${tag === SESSION} | ${source === `chat:${SESSION}`}`, body, ...deliveries].join("\n");
}

// ## Parsing
//
// A callout needs a `context` and a body, as the frontend's `parseCallouts`
// requires; one missing either is not a callout and sends nothing. `loudness` is
// optional; an unknown `loudness` is ignored (with a warning), and the body is
// trimmed:
void test("A callout needs a context and a body, as the frontend's parseCallouts require...", async (t) => {
  // doctest:L46
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

  // doctest:L72
  await t.checkText(parseCalloutTags("No tags here, and <speech>not a callout</speech>.").length, "0");
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
  // doctest:L79
  const box = await makeTmpBox({ git: true });
  await addSubscription({ boxSlug: await boxSlug(box.root), subscription: SUB, now: new Date() });
  const push = createFakePush();

  // doctest:L83
  t.check(await notifyTurnCallouts(box.root, { text: "All filed.", sessionId: SESSION, services: { push } }), null);

  // doctest:L86
  t.check(await lastLogged(box), "nothing logged");

  // doctest:L89
  t.check(await notifyTurnCallouts(box.root, { text: "<callout loudness=\"loud\">No context.</callout>", sessionId: SESSION, services: { push } }), null);

  // ## A `quiet` callout with nobody present is pushed
  //
  // The loudest callout sets the loudness; the first one titles (by its
  // `context`) and carries the notification.

  // doctest:L99
  const text = `<callout context="the field trip" loudness="quiet">The school moved the field trip to Thursday.
Forms are due Wednesday.</callout> and <callout context="later">second</callout>`;
  await notifyTurnCallouts(box.root, { text, sessionId: SESSION, services: { push } });
  await t.checkText(await lastLogged(box), `quiet | the field trip | chat:5f0c2a9e-1111-4c1d-9e2b-000000000001 | tag true | true
The school moved the field trip to Thursday.
Forms are due Wednesday.
apns skipped: no-audience
web-push sent`);

  // doctest:L110
  await t.checkText(push.sent[0]?.payload.url === `/${await boxSlug(box.root)}/chat?session=${SESSION}`, "true");

  // ## With someone present, a callout is not pushed, however loud
  //
  // The callout is on screen in the open app, so each channel logs
  // `skipped: present`, for a `quiet` callout and for a `loud` one alike.

  // doctest:L120
  await writePresence(box.root, { activeWeb: 1, now: new Date() });
  await notifyTurnCallouts(box.root, { text: "<callout context=\"you asked\" loudness=\"quiet\">Booked.</callout>", sessionId: SESSION, services: { push } });
  await t.checkText(await lastLogged(box), `quiet | you asked | chat:5f0c2a9e-1111-4c1d-9e2b-000000000001 | tag true | true
Booked.
apns skipped: present
web-push skipped: present`);

  // doctest:L129
  await t.checkText(push.sent.length, "1");

  // Two callouts, one `loud`: still on screen, still not pushed.

  // doctest:L136
  const two = "<callout context=\"first\">Filed.</callout><callout context=\"the form\" loudness=\"loud\">Due Friday.</callout>";
  await notifyTurnCallouts(box.root, { text: two, sessionId: SESSION, services: { push } });
  await t.checkText(await lastLogged(box), `loud | first | chat:5f0c2a9e-1111-4c1d-9e2b-000000000001 | tag true | true
Filed.
apns skipped: present
web-push skipped: present`);

  // doctest:L145
  await t.checkText(push.sent.length, "1");

  // A callout with no `loudness` is a `dot`: a badge on paired phones only, sent
  // whatever the presence.

  // doctest:L153
  await notifyTurnCallouts(box.root, { text: "<callout context=\"note\">Filed the receipt.</callout>", sessionId: SESSION, services: { push } });
  t.check((await lastLogged(box)).split("\n")[0]?.startsWith("dot | note"), true);

  // With nobody present, the same `loud` pair is pushed.

  // doctest:L161
  await writePresence(box.root, { activeWeb: 0, now: new Date() });
  await notifyTurnCallouts(box.root, { text: two, sessionId: SESSION, services: { push } });
  t.check((await lastLogged(box)).split("\n").filter((l) => l.startsWith("web-push")).join(","), "web-push sent");

  // doctest:L166
  await t.checkText(push.sent.length, "2");
});
