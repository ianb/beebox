// # location-store: load/save last-known user location
//
// `.beebox/location.json` holds one fix per box. `loadLocation`
// validates the full on-disk shape and degrades any absent, corrupt, or
// invalid file to `null` (reported as "unknown") rather than throwing — so a
// hand-edit or partial write can never crash a read or an agent turn.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { loadLocation, saveLocation, type StoredLocation } from "../../src/core/location-store.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

const FIX: StoredLocation = { lat: 45.5231, lng: -122.6765, accuracy: 20, capturedAt: "2026-06-29T12:00:00.000Z", source: "web" };

// ## Absent file → null
void test("Absent file → null", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  t.check(await loadLocation(box.root), null);

  // ## Round-trip save/load (creates `.beebox/`)

  await saveLocation(box.root, FIX);
  t.check(await loadLocation(box.root), {
    lat: 45.5231,
    lng: -122.6765,
    accuracy: 20,
    capturedAt: "2026-06-29T12:00:00.000Z",
    source: "web",
  });

  // ## Malformed JSON → null

  await box.write(".beebox/location.json", "{not json");
  t.check(await loadLocation(box.root), null);

  // ## Unparseable `capturedAt` → null (the NaN-age guard)

  await box.write(".beebox/location.json", JSON.stringify({ ...FIX, capturedAt: "nope" }));
  t.check(await loadLocation(box.root), null);

  // ## Wrong `source` → null

  await box.write(".beebox/location.json", JSON.stringify({ ...FIX, source: "ip" }));
  t.check(await loadLocation(box.root), null);

  // ## Out-of-range latitude → null

  await box.write(".beebox/location.json", JSON.stringify({ ...FIX, lat: 999 }));
  t.check(await loadLocation(box.root), null);
});
