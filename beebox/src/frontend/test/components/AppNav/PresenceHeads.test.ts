// # Which heads the app bar draws
//
// `headsToShow` draws a report only while its subscription is live and only
// for the chat the person is in now: a reconnecting socket's last list may
// name people who have left, and a report from the chat they just switched
// away from belongs to that chat.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { headsToShow } from "../../../src/components/AppNav/PresenceHeads.js";

const tomas = { email: "tomas@example.com", name: "Tomas Marlowe" };
const report = { sessionId: "chat-a", people: [tomas] };

void test("a live report for the chat the person is in shows its people", (t) => {
  t.check(headsToShow({ live: true, inChat: "chat-a", report }), [tomas]);
  t.end();
});

void test("nothing while reconnecting, after leaving, or for another chat's report", (t) => {
  t.check(
    [
      headsToShow({ live: false, inChat: "chat-a", report }),
      headsToShow({ live: true, inChat: null, report }),
      headsToShow({ live: true, inChat: "chat-b", report }),
      headsToShow({ live: true, inChat: "chat-a", report: null }),
    ],
    [[], [], [], []],
  );
  t.end();
});
