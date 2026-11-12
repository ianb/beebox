// # Strip types
//
// `src/shared/strip-types.ts`: which card types can sit in the conversation
// strip, and the shape check for the stored `strip` value. The server and the
// page share `stripViewFor`, so a card the command accepts is a card the page
// draws.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isBoxCardPath, isBuiltinStripType, stripCardPath, stripViewFor } from "../../src/shared/strip-types.js";

void test("tour is the built-in strip type", async (t) => {
  t.check([isBuiltinStripType("tour"), isBuiltinStripType("doc")], [true, false]);
});

void test("a box card path starts with /, ends with .card, and has no .. segment", async (t) => {
  t.check(
    ["/a/b.tour.card", "a/b.card", "/a/b.md", "/a/../b.card", "none", "dismissed"].map(isBoxCardPath),
    [true, false, false, false, false, false],
  );
});

void test("stripCardPath returns the path only for a card path", async (t) => {
  t.check(
    [stripCardPath("/a/b.tour.card"), stripCardPath("dismissed"), stripCardPath("none"), stripCardPath(undefined)],
    ["/a/b.tour.card", null, null, null],
  );
});

// An earlier-slug page-only view never shadows a later-slug strip view.
void test("stripViewFor picks the first strip view by slug, skipping page-only views", async (t) => {
  const pageOnly = { slug: "a-page", modes: ["page"], rendersCardTypes: ["gauge"] };
  const later = { slug: "z-strip", modes: ["page", "strip"], rendersCardTypes: ["gauge"] };
  const earlier = { slug: "m-strip", modes: ["strip"], rendersCardTypes: ["gauge"] };
  t.check(stripViewFor([later, pageOnly], "gauge"), later);
  t.check(stripViewFor([later, pageOnly, earlier], "gauge"), earlier);
  t.check(stripViewFor([pageOnly], "gauge"), null);
  t.check(stripViewFor([later], "other"), null);
});
