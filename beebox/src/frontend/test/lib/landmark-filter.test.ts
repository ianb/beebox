// # Filtering the Landmarks page
//
// "Find a landmark" in the app bar opens the Landmarks page, which has a filter
// field above the hierarchy. `filterLandmarks` (`lib/landmark-filter.ts`)
// keeps the `landmarks.list` rows whose label or directory contains the text,
// plus each match's ancestor landmarks, so a match still shows where it sits.
// Order and depth are `list`'s own.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { filterLandmarks } from "../../src/lib/landmark-filter.js";

// `landmarks.list` order: root first, then by directory; depth counts ancestor landmarks.
const rows = [
  { dir: "", label: "Kitchen", depth: 0 },
  { dir: "garden", label: "Garden", depth: 0 },
  { dir: "garden/beds", label: "Raised beds", depth: 1 },
  { dir: "garden/beds/tomatoes", label: "Tomatoes", depth: 2 },
  { dir: "garden-tools", label: "Tools", depth: 0 },
  { dir: "travel", label: "Trip planning", depth: 0 },
];

// | Text | Kept | Why |
// |---|---|---|
// | empty or spaces | every row | the page shows the whole hierarchy |
// | `tomato` | Garden, Raised beds, Tomatoes | a deep match keeps its ancestors |
// | `BEDS` | Garden, Raised beds, Tomatoes | case is ignored; `beds` is also in the child's directory |
// | `trip` | Trip planning | a top-level match has no ancestors to add |
// | `garden` | Garden, Raised beds, Tomatoes, Tools | directories match too; `garden-tools` is not under `garden` |
// | `kitchen` | Kitchen | the root matches by its own label |
// | `zebra` | nothing | |
void test("| Text | Kept | Why | |---|---|---| | empty or spaces | every row | the page...", async (t) => {
  // doctest:L35
  t.check(filterLandmarks(rows, "  "), rows);

  t.check(filterLandmarks(rows, ""), rows);

  // doctest:L41
  t.check(filterLandmarks(rows, "tomato"), [
    { dir: "garden", label: "Garden", depth: 0 },
    { dir: "garden/beds", label: "Raised beds", depth: 1 },
    { dir: "garden/beds/tomatoes", label: "Tomatoes", depth: 2 },
  ]);

  // doctest:L46
  t.check(filterLandmarks(rows, "BEDS"), [
    { dir: "garden", label: "Garden", depth: 0 },
    { dir: "garden/beds", label: "Raised beds", depth: 1 },
    { dir: "garden/beds/tomatoes", label: "Tomatoes", depth: 2 },
  ]);

  // doctest:L51
  t.check(filterLandmarks(rows, "trip"), [{ dir: "travel", label: "Trip planning", depth: 0 }]);

  // doctest:L54
  t.check(filterLandmarks(rows, "garden"), [
    { dir: "garden", label: "Garden", depth: 0 },
    { dir: "garden/beds", label: "Raised beds", depth: 1 },
    { dir: "garden/beds/tomatoes", label: "Tomatoes", depth: 2 },
    { dir: "garden-tools", label: "Tools", depth: 0 },
  ]);

  // doctest:L60
  t.check(filterLandmarks(rows, "kitchen"), [{ dir: "", label: "Kitchen", depth: 0 }]);

  // doctest:L63
  t.check(filterLandmarks(rows, "zebra"), []);
});

// The root landmark pins to the top but is no one's parent (`depth` stays 0
// under it), so a match below it does not bring the root along:
void test("The root landmark pins to the top but is no one's parent (depth stays 0 under...", async (t) => {
  // doctest:L71
  t.check(filterLandmarks(rows, "tools").map((row) => row.dir), [
    "garden-tools",
  ]);
});
