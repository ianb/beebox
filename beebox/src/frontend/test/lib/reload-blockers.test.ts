// # What a reload would lose
//
// Modules register probes; the reload decision reads them all at once.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { activeReloadBlockers, registerReloadBlocker } from "../../src/lib/reload-blockers.js";

void test("only probes that answer true block, each reason once, until they unregister", (t) => {
  let draft = "";
  const offComposer = registerReloadBlocker("composer", () => draft.trim() !== "");
  const offUpload = registerReloadBlocker("upload", () => true);
  const offUpload2 = registerReloadBlocker("upload", () => true);
  t.check(activeReloadBlockers(), ["upload"]);
  draft = "half a thought";
  t.check(activeReloadBlockers(), ["composer", "upload"]);
  offUpload();
  t.check(activeReloadBlockers(), ["composer", "upload"]);
  offUpload2();
  offComposer();
  t.check(activeReloadBlockers(), []);
  t.end();
});

void test("a probe that throws blocks: an unknown answer must not reload the page", (t) => {
  const off = registerReloadBlocker("streaming", () => {
    throw new Error("actor stopped");
  });
  const warn = t.capture(console, "warn");
  t.check(activeReloadBlockers(), ["streaming"]);
  t.check(warn().map((call) => call.args[0]), ['[build] reload probe "streaming" failed; treating it as blocking']);
  off();
  t.end();
});
