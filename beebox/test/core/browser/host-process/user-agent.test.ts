// The box browser's user agent: headless Chromium's string without the
// `Headless` prefix, so Cloudflare's Turnstile does not fail it outright.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { majorVersionOf, windowedUserAgent } from "../../../../src/core/browser/host-process/user-agent.js";

void test("a chrome --version line gives the major version; anything else gives null", (t) => {
  t.check(
    {
      testing: majorVersionOf("Google Chrome for Testing 157.0.8103.38\n"),
      chromium: majorVersionOf("Chromium 158.0.8200.1 snap"),
      noVersion: majorVersionOf("chrome: command not found"),
    },
    { testing: "157", chromium: "158", noVersion: null },
  );
  t.end();
});

void test("the user agent names the real platform and no Headless prefix", (t) => {
  t.check(
    {
      linux: windowedUserAgent("157", { platform: "linux", arch: "x64" }),
      linuxArm: windowedUserAgent("157", { platform: "linux", arch: "arm64" }),
      mac: windowedUserAgent("157", { platform: "darwin", arch: "arm64" }),
    },
    {
      linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36",
      linuxArm: "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36",
      mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36",
    },
  );
  t.end();
});
