// # Where a notification's new chat opens
//
// A `chat:new` notification links `chat?new=1&notification=<id>`, and a
// `chat:new:<place>` notification adds `&contextDir=<place>`. The chat route
// turns that into a fresh conversation (`session=new`) in the place. The place
// was checked when the notification was sent, but it can be removed before the
// tap; then the chat opens at the box root, still showing the notification.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { notificationChatSearch } from "../../src/lib/chat-route-search.js";

const places = new Set(["_content/journal"]);
const exists = async (dir: string) => places.has(dir);
const warnings: string[] = [];

void test("A place that is there gets the chat; one that is gone or unreadable falls back to the root.", async (t) => {
  const warn = console.warn;
  console.warn = (message: string) => { warnings.push(message); };
  t.teardown(() => { console.warn = warn; });
  t.check(await notificationChatSearch({ notification: "n1" }, exists), { notification: "n1", session: "new" });
  t.check(await notificationChatSearch({ notification: "n1", contextDir: "_content/journal" }, exists), { notification: "n1", session: "new", contextDir: "_content/journal" });
  t.check(await notificationChatSearch({ notification: "n1", contextDir: "_content/gone" }, exists), { notification: "n1", session: "new" });
  t.check(await notificationChatSearch({ notification: "n1", contextDir: "_content/journal" }, async () => { throw new Error("offline"); }), { notification: "n1", session: "new" });
  // Each fallback says why on the console:
  t.check(warnings, [
    "[notifications] the place \"_content/gone\" is gone; opening the chat at the box root",
    "[notifications] could not check the place \"_content/journal\"; opening the chat at the box root",
  ]);
});
