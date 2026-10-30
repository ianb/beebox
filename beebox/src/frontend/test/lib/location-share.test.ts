// # location-share: storage key, parse boundary, refresh policy
//
// Pure helpers behind the composer's "Share location" opt-in. The
// browser-API functions (`captureCurrentPosition`, `isGeolocationAvailable`)
// aren't exercised here — they need a DOM; these are the DOM-free parts.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  locationShareKey,
  locationShareKeyFor,
  parseLocationShareState,
  serializeLocationShareState,
  shouldRefresh,
  LOCATION_REFRESH_INTERVAL_MS,
} from "../../src/lib/location-share.ts";

// ## Key is scoped by box; missing slug falls back to a default
void test("Key is scoped by box; missing slug falls back to a default", async (t) => {
  t.check(locationShareKey("test1"), "bbx-location-share:test1");

  t.check(locationShareKey(undefined), "bbx-location-share:default");
});

// ## Behind the dev router the scope names the instance
//
// Slug alone let two checkouts' `test1` share a toggle. An empty scope (all of
// production) leaves the key byte-identical to the one written before.
void test("A dev scope replaces the slug; an empty scope keeps the old key", async (t) => {
  t.check(
    [locationShareKeyFor({ boxSlug: "test1", scope: "" }), locationShareKeyFor({ boxSlug: "test1", scope: "main/test1" }), locationShareKeyFor({ boxSlug: undefined, scope: "worktree-foo/test1" })],
    ["bbx-location-share:test1", "bbx-location-share:main/test1", "bbx-location-share:worktree-foo/test1"],
  );
});

// ## Parse defaults to disabled for absent / malformed / invalid
void test("Parse defaults to disabled for absent / malformed / invalid", async (t) => {
  t.check(parseLocationShareState(null), {
    enabled: false,
    lastCapturedAt: null,
  });

  t.check(parseLocationShareState("{not json"), {
    enabled: false,
    lastCapturedAt: null,
  });

  t.check(parseLocationShareState(JSON.stringify({ enabled: "yes" })), {
    enabled: false,
    lastCapturedAt: null,
  });
});

// ## Parse round-trips a valid state
void test("Parse round-trips a valid state", async (t) => {
  const state = { enabled: true, lastCapturedAt: 1_700_000_000_000 };
  t.check(parseLocationShareState(serializeLocationShareState(state)), {
    enabled: true,
    lastCapturedAt: 1700000000000,
  });
});

// ## shouldRefresh: only when opted in, and stale (or never captured)
void test("shouldRefresh: only when opted in, and stale (or never captured)", async (t) => {
  t.check(shouldRefresh({ enabled: false, lastCapturedAt: null }, 1_000_000), false);

  t.check(shouldRefresh({ enabled: true, lastCapturedAt: null }, 1_000_000), true);

  t.check(shouldRefresh({ enabled: true, lastCapturedAt: 1_000_000 }, 1_000_000 + LOCATION_REFRESH_INTERVAL_MS - 1), false);

  t.check(shouldRefresh({ enabled: true, lastCapturedAt: 1_000_000 }, 1_000_000 + LOCATION_REFRESH_INTERVAL_MS + 1), true);
});
