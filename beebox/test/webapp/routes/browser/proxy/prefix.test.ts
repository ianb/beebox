// # The prefix the dashboard's paths are rewritten under
//
// docs/plans/shared-browser.md, Track C. The box's part, `/<slug>/browser`,
// is always there; a dev router's outer segment comes from the
// `X-Forwarded-Prefix` header that Vite's proxy rule adds. The hub replaces
// the router's base-prefix header with its own `/<slug>` (dev smoke run,
// 2026-10-30: that header gave `/test1/test1/browser`), and the Referer is
// missing on a typed or reloaded URL (G2, 2026-10-30: the page came back
// unstyled).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { browserPrefix } from "../../../../../src/webapp/routes/browser/proxy/prefix.js";

void test("Production: no header, no outer prefix", (t) => {
  t.check(browserPrefix({ slug: "kitchen", forwardedPrefix: undefined }), "/kitchen/browser");
  t.end();
});

void test("Dev: the outer segment comes from the forwarded prefix", (t) => {
  t.check(browserPrefix({ slug: "test1", forwardedPrefix: "/shared-browser" }), "/shared-browser/test1/browser");
  t.check(browserPrefix({ slug: "test1", forwardedPrefix: ["/main", "/other"] }), "/main/test1/browser");
  t.end();
});

void test("A forwarded prefix that is not plain path segments adds nothing", (t) => {
  const bad = ["", "/", "main", "//evil.example", "/a/../b", "/a b", "/a/", "https://evil.example"];
  t.check(
    bad.map((forwardedPrefix) => browserPrefix({ slug: "test1", forwardedPrefix })),
    bad.map(() => "/test1/browser"),
  );
  t.end();
});
