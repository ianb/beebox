// # location-share: storage key, parse boundary, refresh policy
//
// Pure helpers behind the composer's "Share location" opt-in. The
// browser-API functions (`captureCurrentPosition`, `isGeolocationAvailable`)
// aren't exercised here — they need a DOM; these are the DOM-free parts.

import { test } from "tap";
import "agent-doctest/tap";
import {
  locationShareKey,
  parseLocationShareState,
  serializeLocationShareState,
  shouldRefresh,
  LOCATION_REFRESH_INTERVAL_MS,
} from "../../src/lib/location-share.ts";

// ## Key is scoped by box; missing slug falls back to a default
void test("Key is scoped by box; missing slug falls back to a default", async (t) => {
  // doctest:L20
  t.check(locationShareKey("test1"), "bbx-location-share:test1");

  // doctest:L23
  t.check(locationShareKey(undefined), "bbx-location-share:default");
});

// ## Parse defaults to disabled for absent / malformed / invalid
void test("Parse defaults to disabled for absent / malformed / invalid", async (t) => {
  // doctest:L30
  t.check(parseLocationShareState(null), {
    enabled: false,
    lastCapturedAt: null,
  });

  // doctest:L33
  t.check(parseLocationShareState("{not json"), {
    enabled: false,
    lastCapturedAt: null,
  });

  // doctest:L36
  t.check(parseLocationShareState(JSON.stringify({ enabled: "yes" })), {
    enabled: false,
    lastCapturedAt: null,
  });
});

// ## Parse round-trips a valid state
void test("Parse round-trips a valid state", async (t) => {
  // doctest:L43
  const state = { enabled: true, lastCapturedAt: 1_700_000_000_000 };
  t.check(parseLocationShareState(serializeLocationShareState(state)), {
    enabled: true,
    lastCapturedAt: 1700000000000,
  });
});

// ## shouldRefresh: only when opted in, and stale (or never captured)
void test("shouldRefresh: only when opted in, and stale (or never captured)", async (t) => {
  // doctest:L51
  t.check(shouldRefresh({ enabled: false, lastCapturedAt: null }, 1_000_000), false);

  // doctest:L54
  t.check(shouldRefresh({ enabled: true, lastCapturedAt: null }, 1_000_000), true);

  // doctest:L57
  t.check(shouldRefresh({ enabled: true, lastCapturedAt: 1_000_000 }, 1_000_000 + LOCATION_REFRESH_INTERVAL_MS - 1), false);

  // doctest:L60
  t.check(shouldRefresh({ enabled: true, lastCapturedAt: 1_000_000 }, 1_000_000 + LOCATION_REFRESH_INTERVAL_MS + 1), true);
});
