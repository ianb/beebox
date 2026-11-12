// The beat a tour shows in the strip follows the card's `current` until the
// person clicks a title; when `current` moves, the click lapses and the new
// current beat shows. A `current` that names no beat selects the first.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { selectedBeatIndex, tourCurrent } from "../../../src/components/TourCard/beat-selection.js";

const beats = [
  { title: "Welcome", markdown: "Hello." },
  { title: "Cards", markdown: "A card." },
  { title: "Wrap up", markdown: "Done." },
];

void test("selection follows current, a pick, and a moved current", async (t) => {
  t.check({
    followsCurrent: selectedBeatIndex({ beats, current: "Cards", picked: null }),
    pickWins: selectedBeatIndex({ beats, current: "Cards", picked: { title: "Wrap up", current: "Cards" } }),
    currentMovedPickLapses: selectedBeatIndex({ beats, current: "Wrap up", picked: { title: "Welcome", current: "Cards" } }),
    pickOfVanishedBeat: selectedBeatIndex({ beats, current: "Cards", picked: { title: "Gone", current: "Cards" } }),
    unknownCurrent: selectedBeatIndex({ beats, current: "Nowhere", picked: null }),
    noCurrent: selectedBeatIndex({ beats, current: undefined, picked: null }),
    pickWithNoCurrent: selectedBeatIndex({ beats, current: undefined, picked: { title: "Cards", current: undefined } }),
    noBeats: selectedBeatIndex({ beats: [], current: "Cards", picked: null }),
  }, {
    followsCurrent: 1,
    pickWins: 2,
    currentMovedPickLapses: 2,
    pickOfVanishedBeat: 1,
    unknownCurrent: 0,
    noCurrent: 0,
    pickWithNoCurrent: 1,
    noBeats: null,
  });
});

void test("current is read only when it is a string", async (t) => {
  t.check([tourCurrent({ current: "Cards" }), tourCurrent({ current: 3 }), tourCurrent({}), tourCurrent(undefined)], ["Cards", undefined, undefined, undefined]);
});
