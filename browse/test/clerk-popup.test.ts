// # `browse clerk-popup`
//
// `clerk-popup` opens the Clerk's popup page by URL, so it needs the extension's
// id. Chrome derives an unpacked extension's id from its absolute path: the
// first 32 hex digits of the path's SHA-256, each spelled with the letters a–p.
// The formula was checked against the id a real Chrome profile recorded for a
// worktree's build (in its Secure Preferences); the path below is made up.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { unpackedExtensionId, frontTargetScript } from "../src/clerk-popup.js";

void test("line 13", async (t) => {
  t.check(unpackedExtensionId("/srv/beebox/beebox-clerk/dist-browse/chrome-mv3"), "aefhjangknhldlihokiojaajoegnlaoh");
});

// The script that fronts the target finds it by URL and refuses when two tabs
// share it. It embeds the URL as a JSON string, so a quote in the URL cannot end
// the string early.
void test("The script that fronts the target finds it by URL and refuses when two tabs s...", async (t) => {
  t.check(
    frontTargetScript('http://localhost/a"b').split("\n")[1]?.trim()
    ,
    "const matches = tabs.filter((tab) => tab.url === \"http://localhost/a\\\"b\");",
  );
});
