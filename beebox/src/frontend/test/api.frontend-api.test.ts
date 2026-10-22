// # Frontend API helpers
//
// Smoke-tests for the URL-prefixing helper used by the frontend to talk to the
// backend through the dev router (or directly in prod). The helper is pure —
// no dependency on `import.meta.env`, so it can be tested here in the backend
// test runner without mocking Vite.
//
// The concrete worry: in prod, Vite builds with the default `base: "/"` and
// `BASE_URL` becomes `"/"`. The helper must be a no-op in that case so
// production API calls go to `/api/...` and not accidentally `/api/api/...` or
// `//api/...`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { joinBaseAndPath } from "../src/api";

// ## In prod (base = "/"), the helper is a no-op
void test("In prod (base = \"/\"), the helper is a no-op", async (t) => {
  t.check(joinBaseAndPath("/", "/api/boxes"), "/api/boxes");
});

// A path missing its leading slash gets one (defensive — shouldn't happen but
// shouldn't break either).
void test("A path missing its leading slash gets one (defensive — shouldn't happen but s...", async (t) => {
  t.check(joinBaseAndPath("/", "api/boxes"), "/api/boxes");
});

// ## Under the dev router (base = "/main/"), paths are prefixed
void test("Under the dev router (base = \"/main/\"), paths are prefixed", async (t) => {
  t.check(joinBaseAndPath("/main/", "/api/boxes"), "/main/api/boxes");
});

// ## Base without trailing slash is accepted
void test("Base without trailing slash is accepted", async (t) => {
  t.check(joinBaseAndPath("/main", "/api/boxes"), "/main/api/boxes");
});

// ## No double slash when path is already absolute
void test("No double slash when path is already absolute", async (t) => {
  t.check(joinBaseAndPath("/main/", "api/boxes"), "/main/api/boxes");
});
