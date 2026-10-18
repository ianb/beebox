// # bbx location mark: stamp the current fix into a place card
//
// `markPlace` reads the live fix and writes lat/lng/radius into an existing place
// card. A coordless card gets center + default radius; an existing place only
// grows with `--expand`. The raw-YAML mutate preserves the body and any other
// frontmatter keys.

import { test } from "tap";
import "agent-doctest/tap";
import { symlink, mkdir } from "node:fs/promises";
import { applyMark, markPlace, type MarkResult } from "../../src/core/place-mark.js";
import { saveLocation, type StoredLocation } from "../../src/core/location-store.js";
import { loadPlaces } from "../../src/core/place-cards.js";
import { matchPlace } from "../../src/core/geo.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const FIX = { lat: 45.5231, lng: -122.6765, accuracy: 18 };
const stored = (fix: { lat: number; lng: number; accuracy: number }, capturedAt: string): StoredLocation => ({ ...fix, capturedAt, source: "web" });

/** The success arm of a mark result. */
function marked(res: MarkResult): Extract<MarkResult, { ok: true }> {
  if (!res.ok) throw new Error(`mark failed: ${res.error}`);
  return res;
}
const CARD = "---\nname: Home\nfavorite: true\n---\nMy home — important because it's the default context.\n";

// ## applyMark stamps coords while preserving body + unknown keys
void test("applyMark stamps coords while preserving body + unknown keys", async (t) => {
  // doctest:L30
  const out = applyMark(CARD, { fix: FIX, expand: false });
  t.check(out.outcome, "set");

  // doctest:L34
  await t.checkText(out.text?.includes("favorite: true") && out.text.includes("My home — important because it's the default context."), "true");

  // doctest:L37
  await t.checkText(out.text?.includes("lat: 45.5231") && out.text.includes("lng: -122.6765") && /radius: \d+/.test(out.text), "true");
});

// ## A frontmatter comment on an untouched key survives the mutate
void test("A frontmatter comment on an untouched key survives the mutate", async (t) => {
  // doctest:L44
  const commented = "---\nname: Home  # the main house\naddress: 1 Main St\n---\nbody\n";
  t.check(applyMark(commented, { fix: FIX, expand: false }).text?.includes("# the main house"), true);
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
  t.check({ ok: res.ok, changed: marked(res).changed, marked: marked(res).message.startsWith("Marked Home") }, {
    ok: true,
    changed: true,
    marked: true,
  });

  // doctest:L59
  const saved = await box.read("places/Home.place.card");
  await t.checkText(saved.includes("lat: 45.5231") && saved.includes("favorite: true"), "true");
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
  t.check({ changed: marked(res).changed, covers: marked(res).message.includes("already covers") }, {
    changed: false,
    covers: true,
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
  t.check({ changed: marked(res).changed, outside: marked(res).message.includes("--expand") }, {
    changed: false,
    outside: true,
  });

  // doctest:L95
  await t.checkText((await box.read("places/Home.place.card")) === small, "true");

  // doctest:L100
  const res2 = await markPlace({ boxRoot: box.root, cardPath: "places/Home.place.card", expand: true, now: new Date("2026-06-29T12:01:00.000Z") });
  t.check({ changed: marked(res2).changed, expanded: marked(res2).message.startsWith("Expanded Home") }, {
    changed: true,
    expanded: true,
  });

  // The grown radius actually contains the fix (ceil, not round), so `get` now matches it:

  // doctest:L108
  const places = await loadPlaces(box.root);
  const m = matchPlace({ lat: 45.536, lng: -122.6765 }, places);
  t.check(m ? m.name : null, "Home");
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
  t.check({ ok: res.ok, outside: res.ok ? "" : res.error.includes("outside the box") }, {
    ok: false,
    outside: true,
  });
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
  t.check({ ok: res.ok, share: res.ok ? "" : res.error.includes("share location") }, {
    ok: false,
    share: true,
  });
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
  t.check({ ok: res.ok, outside: res.ok ? "" : res.error.includes("outside the box") }, {
    ok: false,
    outside: true,
  });
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
  t.check({ ok: res.ok, stale: marked(res).message.includes("[stale]") }, {
    ok: true,
    stale: true,
  });
});
