// # Place resolution: loadPlaces + matching
//
// `loadPlaces` reads the box's `*.place.card` cards as match circles — unarchived,
// with both coordinates — skipping coordless/half-set drafts, archived
// places, and unparseable cards. `bbx location get` then names the matched place.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { loadPlaces } from "../../src/core/place-cards.js";
import { matchPlace } from "../../src/core/geo.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

const place = (name: string, extra: string) => `---\nname: ${name}\n${extra}---\nbody\n`;

// ## Loads unarchived, fully-coordinated places; skips drafts/archived/half-set
void test("Loads unarchived, fully-coordinated places; skips drafts/archived/half-set", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L18
  const box = await makeTmpBox();
  await box.write("places/Home.place.card", place("Home", "lat: 45.5231\nlng: -122.6765\nradius: 150\n"));
  await box.write("places/Draft.place.card", place("Draft", "address: somewhere\n"));        // coordless
  await box.write("places/Half.place.card", place("Half", "lat: 45.0\n"));                    // lat without lng
  await box.write("places/Old.place.card", "---\nname: Old\narchived: true\nlat: 45.5\nlng: -122.6\n---\nb\n");
  const places = await loadPlaces(box.root);
  t.check(places.map((p) => p.name).toSorted(), [
    "Home",
  ]);

  // doctest:L29
  const fix = { lat: 45.5231, lng: -122.6765, accuracy: 12 };
  const m = matchPlace(fix, places);
  t.check(m ? m.name : null, "Home");
});

// ## A missing radius falls back to the default
void test("A missing radius falls back to the default", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L42
  const box = await makeTmpBox();
  await box.write("places/Office.place.card", place("Office", "lat: 40.0\nlng: -74.0\n"));
  const places = await loadPlaces(box.root);
  t.check(places[0]?.radius, 100);
});

// ## A typo'd out-of-range coordinate is skipped (schema-enforced)
void test("A typo'd out-of-range coordinate is skipped (schema-enforced)", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L56
  const box = await makeTmpBox();
  await box.write("places/Good.place.card", place("Good", "lat: 1\nlng: 2\nradius: 50\n"));
  await box.write("places/Bad.place.card", place("Bad", "lat: 999\nlng: 2\nradius: 50\n"));
  const places = await loadPlaces(box.root);
  t.check(places.map((p) => p.name), [
    "Good",
  ]);
});

// ## One unparseable place card is skipped; the others still load
void test("One unparseable place card is skipped; the others still load", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L71
  const box = await makeTmpBox();
  await box.write("places/Good.place.card", place("Good", "lat: 1\nlng: 2\nradius: 50\n"));
  await box.write("places/Bad.place.card", "---\nname: [unterminated\n---\nbody\n");
  const places = await loadPlaces(box.root);
  t.check(places.map((p) => p.name), [
    "Good",
  ]);
});
