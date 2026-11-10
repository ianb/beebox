// # Which chat a notification link opens
//
// A `chat:new` notification links `chat?new=1&notification=<id>`, and a
// `chat:new:<place>` notification adds `&contextDir=<place>`. The chat route
// turns that into a fresh conversation (`session=new`) in the place. A
// `place:<dir>` notification links `chat?place=<dir>&notification=<id>`: the
// place's latest chat, or a fresh one there when it has none. The place was
// checked when the notification was sent, but it can be removed before the
// tap; then a fresh chat opens at the box root, still showing the
// notification.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { notificationChatSearch, type PlaceLookups } from "../../src/lib/chat-route-search.js";

const latest = new Map<string, string | null>([["_content/journal", "s-journal"], ["_content/porch", null]]);
const lookups: PlaceLookups = {
  isPlace: async (dir) => latest.has(dir),
  latestChat: async (dir) => latest.get(dir) ?? null,
};
const offline = async (): Promise<never> => { throw new Error("offline"); };

function collectWarnings(t: Test): string[] {
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (message: string) => { warnings.push(message); };
  t.teardown(() => { console.warn = warn; });
  return warnings;
}

void test("A new-chat link: a place that is there gets the chat; one that is gone or unreadable falls back to the root.", async (t) => {
  const warnings = collectWarnings(t);
  t.check(await notificationChatSearch({ new: "1", notification: "n1" }, lookups), { notification: "n1", session: "new" });
  t.check(await notificationChatSearch({ new: "1", notification: "n1", contextDir: "_content/journal" }, lookups), { notification: "n1", session: "new", contextDir: "_content/journal" });
  t.check(await notificationChatSearch({ new: "1", notification: "n1", contextDir: "_content/gone" }, lookups), { notification: "n1", session: "new" });
  t.check(await notificationChatSearch({ new: "1", notification: "n1", contextDir: "_content/journal" }, { ...lookups, isPlace: offline }), { notification: "n1", session: "new" });
  // Each fallback says why on the console:
  t.check(warnings, [
    "[notifications] the place \"_content/gone\" is gone; opening the chat at the box root",
    "[notifications] could not check the place \"_content/journal\"; opening the chat at the box root",
  ]);
});

void test("A place link opens the place's latest chat, or a new chat there when it has none.", async (t) => {
  const warnings = collectWarnings(t);
  t.check(await notificationChatSearch({ place: "_content/journal", notification: "n2" }, lookups), { notification: "n2", session: "s-journal" });
  t.check(await notificationChatSearch({ place: "_content/porch", notification: "n2" }, lookups), { notification: "n2", session: "new", contextDir: "_content/porch" });
  // A failed latest-chat lookup still lands in the place, in a new chat:
  t.check(await notificationChatSearch({ place: "_content/journal", notification: "n2" }, { ...lookups, latestChat: offline }), { notification: "n2", session: "new", contextDir: "_content/journal" });
  // A gone place falls back to a new chat at the root, like a new-chat link:
  t.check(await notificationChatSearch({ place: "_content/gone", notification: "n2" }, lookups), { notification: "n2", session: "new" });
  t.check(warnings, [
    "[notifications] could not find the latest chat in \"_content/journal\"; opening a new chat there",
    "[notifications] the place \"_content/gone\" is gone; opening the chat at the box root",
  ]);
});

void test("Any other chat link is left alone.", async (t) => {
  t.check(await notificationChatSearch({ session: "s1" }, lookups), null);
  t.check(await notificationChatSearch({}, lookups), null);
});
