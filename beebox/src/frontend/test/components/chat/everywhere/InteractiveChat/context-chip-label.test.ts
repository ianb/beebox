// # Context chip face label
//
// `contextChipLabel` (`components/chat/context-chip-label.ts`) chooses the
// context chip's face text from the landmark query result plus the chat's
// bound directory. `dir` is a tri-state: `null` (no context at all) and `""`
// (context IS the box root) are distinct and must not collapse to the same
// label.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { contextChipLabel } from "../../../../../src/components/chat/everywhere/InteractiveChat/context-chip-label.js";

// ## Landmark label wins when present
//
// A landmark label wins even over a root dir — it's a more specific name than
// "Box root".
void test("A landmark label wins even over a root dir — it's a more specific name than \"...", async (t) => {
  // doctest:L19
  t.check(contextChipLabel({ landmarkLabel: "Home", dir: "" }), "Home");
});

// ## No landmark label: basename of a nested dir
void test("No landmark label: basename of a nested dir", async (t) => {
  // doctest:L26
  t.check(contextChipLabel({ landmarkLabel: null, dir: "_content/recipes" }), "recipes");
});

// ## Empty landmark label: treated as absent, not returned
//
// A label-less landmark card (e.g. a destinations-only landmark) must not
// blank the face — `""` falls through the same way `null` does.
void test("A label-less landmark card (e.g.", async (t) => {
  // doctest:L36
  t.check(contextChipLabel({ landmarkLabel: "", dir: "_content/recipes" }), "recipes");
});

// ## No landmark label, root dir: "Box root", not "Files"
//
// The empty string is a real value meaning box root — it must not fall
// through to the no-context label.
void test("The empty string is a real value meaning box root — it must not fall through...", async (t) => {
  // doctest:L46
  t.check(contextChipLabel({ landmarkLabel: null, dir: "" }), "Box root");
});

// ## No context at all: "Files"
void test("No context at all: \"Files\"", async (t) => {
  // doctest:L53
  t.check(contextChipLabel({ landmarkLabel: null, dir: null }), "Files");
});
