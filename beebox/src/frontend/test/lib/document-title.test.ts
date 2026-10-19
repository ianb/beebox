// # Document title composition
//
// `composeDocumentTitle` (`lib/document-title.ts`) joins the two halves of a
// browser tab's title. The page half comes first because browsers truncate tabs
// to roughly twenty characters, and the page is what distinguishes two tabs on
// the same box.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { composeDocumentTitle } from "../../src/lib/document-title.js";

// ## Page and box, in that order
//
// The app's name is not in the title. The favicon already identifies the app,
// and a third segment would never survive truncation.
void test("The app's name is not in the title.", async (t) => {
  // doctest:L18
  t.check(composeDocumentTitle({ page: "Grocery planning", box: "Notes" }), "Grocery planning — Notes");
});

// ## Outside a box, the app name takes the second slot
//
// `/auth/login` and `/auth/setup` have no box to name, so this is the only place
// `Bee Box` appears in a title.
void test("/auth/login and /auth/setup have no box to name, so this is the only place Be...", async (t) => {
  // doctest:L28
  t.check(composeDocumentTitle({ page: "Sign in", box: null }), "Sign in — Bee Box");
});

// ## A route that names nothing leaves the box alone
//
// Layouts and redirect-only routes declare `title: null`. Their title is just
// the box — and with no box either (the box-selection landing at `/`), the app
// name is all that is left.
void test("Layouts and redirect-only routes declare title:", async (t) => {
  // doctest:L39
  t.check(composeDocumentTitle({ page: null, box: "Notes" }), "Notes");

  // doctest:L42
  t.check(composeDocumentTitle({ page: null, box: null }), "Bee Box");
});

// ## Blank and absent are the same thing
//
// A page publishing an empty or whitespace-only title is publishing nothing —
// it falls back the same way a null does, rather than titling a tab with a
// dangling separator.
void test("A page publishing an empty or whitespace-only title is publishing nothing — i...", async (t) => {
  // doctest:L53
  t.check(
    [
      composeDocumentTitle({ page: "   ", box: "Notes" }),
      composeDocumentTitle({ page: "Settings", box: "" }),
      composeDocumentTitle({ page: undefined, box: undefined }),
    ].join(" | "),
    "Notes | Settings — Bee Box | Bee Box",
  );
});

// ## Surrounding whitespace is trimmed
//
// A card title read from frontmatter can carry it.
void test("A card title read from frontmatter can carry it.", async (t) => {
  // doctest:L66
  t.check(composeDocumentTitle({ page: "  Roast chicken  ", box: " Kitchen " }), "Roast chicken — Kitchen");
});
