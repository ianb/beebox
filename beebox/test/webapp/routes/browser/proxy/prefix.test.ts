// # The prefix the dashboard's paths are rewritten under
//
// docs/plans/shared-browser.md, Track C. The box's part, `/<slug>/browser`,
// is always there; a dev router's outer segment comes from the same-origin
// Referer, because the hub replaces the router's base-prefix header with its
// own `/<slug>` (found in the dev smoke run, 2026-10-30: the header gave
// `/test1/test1/browser`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { browserPrefix } from "../../../../../src/webapp/routes/browser/proxy/prefix.js";

void test("Production: no outer prefix, whatever the Referer", (t) => {
  t.check(browserPrefix({ slug: "kitchen", referer: undefined }), "/kitchen/browser");
  t.check(browserPrefix({ slug: "kitchen", referer: "https://box.example.com/kitchen/chat" }), "/kitchen/browser");
  t.end();
});

void test("Dev: the outer segment comes from the page the request came from", (t) => {
  // Opening the page from the app's menu.
  t.check(browserPrefix({ slug: "test1", referer: "http://localhost:3210/shared-browser/test1/chat" }), "/shared-browser/test1/browser");
  // A request the dashboard itself makes.
  t.check(browserPrefix({ slug: "test1", referer: "http://localhost:3210/shared-browser/test1/browser/" }), "/shared-browser/test1/browser");
  t.end();
});

void test("A Referer that is not plain path segments adds nothing", (t) => {
  t.check(browserPrefix({ slug: "test1", referer: "not a url" }), "/test1/browser");
  t.check(browserPrefix({ slug: "test1", referer: "http://localhost:3210/a/../test1/chat" }), "/test1/browser");
  t.check(browserPrefix({ slug: "test1", referer: "http://localhost:3210/a%20b/test1/chat" }), "/test1/browser");
  t.end();
});
