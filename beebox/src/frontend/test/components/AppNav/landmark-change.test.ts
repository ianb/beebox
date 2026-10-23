// # Which place a file change can retitle
//
// The place pill refetches `landmarks.identity` for the directory of a changed
// `*.landmark.card`, and for no other file, so the bar stays cheap.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { landmarkDirOfChange } from "../../../src/components/AppNav/landmark-change.js";

void test("A changed landmark card names its directory; any other file names none.", async (t) => {
  t.check(
    [
      "Home.landmark.card",
      "/Home.landmark.card",
      "_content/projects/Porch/Porch.landmark.card",
      "_content/projects/Porch/Plan.doc.card",
      "notes.landmark.card.bak",
    ].map(landmarkDirOfChange),
    ["", "", "_content/projects/Porch", null, null],
  );
});
