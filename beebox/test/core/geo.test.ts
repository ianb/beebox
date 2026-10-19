// # geo: haversine distance + place matching
//
// Pure geo math behind location resolution. `haversineMeters` is great-circle
// distance; `matchPlace` returns the nearest place whose center is within its
// radius (strict — no accuracy inflation), or null.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { haversineMeters, matchPlace } from "../../src/core/geo.js";

const A = { name: "A", lat: 45, lng: -122, radius: 200 };
const B = { name: "B", lat: 45.001, lng: -122, radius: 5000 };
const BIG_A = { name: "A", lat: 45, lng: -122, radius: 5000 };

// ## haversine: one degree of latitude is ~111.2 km
void test("haversine: one degree of latitude is ~111.2 km", async (t) => {
  // doctest:L18
  const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  t.check(d, any(Number).above(111_000).below(111_400));
});

// ## haversine is zero for identical points
void test("haversine is zero for identical points", async (t) => {
  // doctest:L26
  t.check(haversineMeters({ lat: 45, lng: -122 }, { lat: 45, lng: -122 }), 0);
});

// ## match: a far-away fix matches nothing
void test("match: a far-away fix matches nothing", async (t) => {
  // doctest:L33
  t.check(matchPlace({ lat: 46, lng: -123 }, [A]), null);
});

// ## match: on overlap, the nearest center wins
//
// `BIG_A` (center exactly at the fix) and `B` (~111 m away) both contain the fix;
// the nearer center, A, wins.
void test("BIGA (center exactly at the fix) and B (~111 m away) both contain the fix; th...", async (t) => {
  // doctest:L43
  const m = matchPlace({ lat: 45, lng: -122 }, [B, BIG_A]);
  t.check(m, BIG_A);
});

// ## match: strict radius — a fix just outside the radius does not match
void test("match: strict radius — a fix just outside the radius does not match", async (t) => {
  // doctest:L51
  t.check(
    // ~111 m north of A's center, A's radius is 200 m → inside; shrink radius to 50 m → outside.
    matchPlace({ lat: 45.001, lng: -122 }, [{ name: "A", lat: 45, lng: -122, radius: 50 }]),
    null,
  );
});
