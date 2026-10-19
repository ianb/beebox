// # bbx location mark: stamp the current fix into a place card
//
// `markPlace` reads the live fix and writes lat/lng/radius into an existing place
// card. A coordless card gets center + default radius; an existing place only
// grows with `--expand`. The raw-YAML mutate preserves the body and any other
// frontmatter keys.

import { test } from "tap";
import "agent-doctest/tap";
import { symlink, mkdir } from "node:fs/promises";
import { applyMark, markPlace } from "../../src/core/place-mark.js";
import { saveLocation, type StoredLocation } from "../../src/core/location-store.js";
import { loadPlaces } from "../../src/core/place-cards.js";
import { matchPlace } from "../../src/core/geo.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

const FIX = { lat: 45.5231, lng: -122.6765, accuracy: 18 };
const stored = (fix: { lat: number; lng: number; accuracy: number }, capturedAt: string): StoredLocation => ({ ...fix, capturedAt, source: "web" });

const CARD = "---\nname: Home\nfavorite: true\n---\nMy home — important because it's the default context.\n";

// ## applyMark stamps coords while preserving body + unknown keys
void test("applyMark stamps coords while preserving body + unknown keys", async (t) => {
  // doctest:L30
  const out = applyMark(CARD, { fix: FIX, expand: false });
  t.check(out, {
    text: `---
name: Home
favorite: true
lat: 45.5231
lng: -122.6765
radius: 50
---
My home — important because it's the default context.
`,
    outcome: "set",
    name: "Home",
    lat: 45.5231,
    lng: -122.6765,
    radius: 50,
    distance: null,
  });
});

// ## A frontmatter comment on an untouched key survives the mutate
void test("A frontmatter comment on an untouched key survives the mutate", async (t) => {
  // doctest:L44
  const commented = "---\nname: Home  # the main house\naddress: 1 Main St\n---\nbody\n";
  t.check(applyMark(commented, { fix: FIX, expand: false }), {
    text: `---
name: Home # the main house
address: 1 Main St
lat: 45.5231
lng: -122.6765
radius: 50
---
body
`,
    outcome: "set",
    name: "Home",
    lat: 45.5231,
    lng: -122.6765,
    radius: 50,
    distance: null,
  });
});

// ## First mark on a coordless card writes coords (markPlace, fresh fix)
void test("First mark on a coordless card writes coords (markPlace, fresh fix)", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L52
  const box = await makeTmpBox();
  await box.write("places/Home.place.card", CARD);
  await saveLocation(box.root, stored(FIX, "2026-06-29T12:00:00.000Z"));
  const res = await markPlace({ boxRoot: box.root, cardPath: "places/Home.place.card", expand: false, now: new Date("2026-06-29T12:04:00.000Z") });
  t.check(res, { ok: true, changed: true, message: "Marked Home at 45.5231,-122.6765 (radius 50m, from a fix captured 4 minutes ago)." });

  // doctest:L59
  const saved = await box.read("places/Home.place.card");
  await t.checkText(saved, `---
name: Home
favorite: true
lat: 45.5231
lng: -122.6765
radius: 50
---
My home — important because it's the default context.`);
});

// ## A fix inside the radius is a no-op
void test("A fix inside the radius is a no-op", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L71
  const box = await makeTmpBox();
  await box.write("places/Home.place.card", "---\nname: Home\nlat: 45.5231\nlng: -122.6765\nradius: 200\n---\nbody\n");
  await saveLocation(box.root, stored(FIX, "2026-06-29T12:00:00.000Z"));
  const res = await markPlace({ boxRoot: box.root, cardPath: "places/Home.place.card", expand: false, now: new Date("2026-06-29T12:01:00.000Z") });
  t.check(res, {
    ok: true,
    changed: false,
    message: "Home already covers this fix (0m from center, radius 200m; from a fix captured 1 minute ago). No change.",
  });
});

// ## A fix outside the radius does not expand without --expand
void test("A fix outside the radius does not expand without --expand", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L86
  const box = await makeTmpBox();
  const small = "---\nname: Home\nlat: 45.5231\nlng: -122.6765\nradius: 50\n---\nbody\n";
  await box.write("places/Home.place.card", small);
  // ~1.5km away
  await saveLocation(box.root, stored({ lat: 45.536, lng: -122.6765, accuracy: 18 }, "2026-06-29T12:00:00.000Z"));
  const res = await markPlace({ boxRoot: box.root, cardPath: "places/Home.place.card", expand: false, now: new Date("2026-06-29T12:01:00.000Z") });
  t.check(res, {
    ok: true,
    changed: false,
    message:
      "Fix is 1434m from Home's center, outside its 50m radius — not updated (from a fix captured 1 minute ago). Re-run with --expand to grow the radius to include it.",
  });

  // doctest:L95
  t.check(await box.read("places/Home.place.card"), small);

  // doctest:L100
  const res2 = await markPlace({ boxRoot: box.root, cardPath: "places/Home.place.card", expand: true, now: new Date("2026-06-29T12:01:00.000Z") });
  t.check(res2, {
    ok: true,
    changed: true,
    message: "Expanded Home to radius 1435m to include the fix 1434m away (from a fix captured 1 minute ago).",
  });

  // The grown radius actually contains the fix (ceil, not round), so `get` now matches it:

  // doctest:L108
  const places = await loadPlaces(box.root);
  const m = matchPlace({ lat: 45.536, lng: -122.6765 }, places);
  t.check(m, { name: "Home", lat: 45.5231, lng: -122.6765, radius: 1435 });
});

// ## A symlink resolving outside the box is refused (privacy boundary)
void test("A symlink resolving outside the box is refused (privacy boundary)", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await external.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L121
  const box = await makeTmpBox();
  const external = await makeTmpBox();
  await external.write("target.place.card", CARD);
  await saveLocation(box.root, stored(FIX, "2026-06-29T12:00:00.000Z"));
  await mkdir(box.path("places"), { recursive: true });
  await symlink(external.path("target.place.card"), box.path("places/Evil.place.card"));
  const res = await markPlace({ boxRoot: box.root, cardPath: "places/Evil.place.card", expand: false, now: new Date() });
  t.check(res, { ok: false, error: "Refusing to mark a card that resolves outside the box: places/Evil.place.card" });
});

// ## No current fix → clear error
void test("No current fix → clear error", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L140
  const box = await makeTmpBox();
  await box.write("places/Home.place.card", CARD);
  const res = await markPlace({ boxRoot: box.root, cardPath: "places/Home.place.card", expand: false, now: new Date() });
  t.check(res, { ok: false, error: "No current location — share location from the web UI first." });
});

// ## A path outside the box is refused
void test("A path outside the box is refused", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L154
  const box = await makeTmpBox();
  await saveLocation(box.root, stored(FIX, "2026-06-29T12:00:00.000Z"));
  const res = await markPlace({ boxRoot: box.root, cardPath: "/etc/evil.place.card", expand: false, now: new Date() });
  t.check(res, { ok: false, error: "Refusing to mark a card outside the box: /etc/evil.place.card" });
});

// ## A stale fix proceeds and the message flags the age
void test("A stale fix proceeds and the message flags the age", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L168
  const box = await makeTmpBox();
  await box.write("places/Home.place.card", CARD);
  await saveLocation(box.root, stored(FIX, "2020-01-01T00:00:00.000Z"));
  const res = await markPlace({ boxRoot: box.root, cardPath: "places/Home.place.card", expand: false, now: new Date("2026-06-29T12:00:00.000Z") });
  t.check(res, { ok: true, changed: true, message: "Marked Home at 45.5231,-122.6765 (radius 50m, from a fix captured 339 weeks ago [stale])." });
});
