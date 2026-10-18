// # Place label (app-bar pill fallback)
//
// `placeLabel` (`lib/place-label.ts`) maps a router pathname to the place the
// `PlacePill` names: a display label plus the box-relative directory the place
// sits in. It's the fallback the bar uses on every page that doesn't publish a
// richer context of its own.
//
// `dir` is tri-state, exactly like the chat context chip's: `null` means "this
// route has no directory", `""` means "the box root", and a string is a real
// subdirectory. A non-null `dir` is what gets handed to `landmarks.forDir`.

import { test } from "tap";
import "agent-doctest/tap";
import { dirBasename, placeLabel } from "../../src/lib/place-label.js";

// ## The box root is Home; a literal `/chat` route is still Chat
//
// `/` redirects to `/chat` (Track A) and both render the same page, but the pill
// names the bare box root "Home" (docs/glossary.md) while a literal `/chat`
// route keeps "Chat".
void test("/ redirects to /chat (Track A) and both render the same page, but the pill na...", async (t) => {
  // doctest:L23
  t.check(placeLabel({ pathname: "/test1", boxSlug: "test1" }), {
    label: "Home",
    dir: null,
  });

  // doctest:L26
  t.check(placeLabel({ pathname: "/test1/", boxSlug: "test1" }), {
    label: "Home",
    dir: null,
  });

  // doctest:L29
  t.check(placeLabel({ pathname: "/test1/chat", boxSlug: "test1" }), {
    label: "Chat",
    dir: null,
  });
});

// ## Sub-paths of a static route keep the section's label
//
// `/history/<hash>` is still History.
void test("/history/<hash> is still History.", async (t) => {
  // doctest:L38
  t.check(placeLabel({ pathname: "/test1/history/a1b2c3", boxSlug: "test1" }).label, "History");
});

// ## Browse names the path, and carries the dir
//
// A directory path is itself the dir. The label uses the boxholder display
// form — a `_content` path shows bare, no leading area prefix
// (`display-path.ts`).
void test("A directory path is itself the dir.", async (t) => {
  // doctest:L49
  t.check(placeLabel({ pathname: "/test1/browse/_content/recipes", boxSlug: "test1" }), {
    label: "Browse: recipes",
    dir: "_content/recipes",
  });
});

// A trailing segment with a `.` reads as a file, so the dir is its parent — the
// landmark lookup wants the enclosing directory, not the card.
void test("A trailing segment with a . reads as a file, so the dir is its parent — the l...", async (t) => {
  // doctest:L57
  t.check(placeLabel({ pathname: "/test1/browse/_content/recipes/Bread.card", boxSlug: "test1" }), {
    label: "Browse: recipes/Bread.card",
    dir: "_content/recipes",
  });
});

// A machinery-area path shows the area's friendly label instead of the
// underscore name.
void test("A machinery-area path shows the area's friendly label instead of the undersco...", async (t) => {
  // doctest:L65
  t.check(placeLabel({ pathname: "/test1/browse/_bookkeeping/jobs", boxSlug: "test1" }), {
    label: "Browse: Bookkeeping:jobs",
    dir: "_bookkeeping/jobs",
  });
});

// Browsing the box root has no path portion, and its dir is the root (`""`, not
// `null`) — the root can itself hold a landmark.
void test("Browsing the box root has no path portion, and its dir is the root (\"\", not n...", async (t) => {
  // doctest:L73
  t.check(placeLabel({ pathname: "/test1/browse", boxSlug: "test1" }), {
    label: "Browse",
    dir: "",
  });
});

// ## Card routes name the kind and resolve their enclosing dir
//
// Both `/card/$` and `/views/$` render one card; the card's own title is the page
// heading, so the pill names the kind and spends its dir on the landmark lookup.
void test("Both /card/$ and /views/$ render one card; the card's own title is the page h...", async (t) => {
  // doctest:L83
  t.check(placeLabel({ pathname: "/test1/card/_content/recipes/Bread.card", boxSlug: "test1" }), {
    label: "Card",
    dir: "_content/recipes",
  });

  // doctest:L86
  t.check(placeLabel({ pathname: "/test1/views/_content/plate.todo-view.card", boxSlug: "test1" }), {
    label: "Card",
    dir: "_content",
  });
});

// ## Anything unmapped falls back to the landing
//
// An unknown route (the router redirects these to the box root anyway) names the
// landing rather than inventing a label.
void test("An unknown route (the router redirects these to the box root anyway) names th...", async (t) => {
  // doctest:L96
  t.check(placeLabel({ pathname: "/test1/nonesuch", boxSlug: "test1" }), {
    label: "Chat",
    dir: null,
  });
});

// ## The folder half names the last directory, without `.attach`
//
// The pill's folder half shows the landmark directory's last segment. A course
// landmark lives in its card's attach folder, so that segment would read as a
// filename; the `.attach` suffix is dropped.
void test("The pill's folder half shows the landmark directory's last segment.", async (t) => {
  // doctest:L107
  t.check(
    [
      dirBasename(""),
      dirBasename("projects/porch-rebuild"),
      dirBasename("courses/Intro_Chemistry.attach"),
      dirBasename("notes/.attach"),
    ],
    [
    "/",
    "porch-rebuild",
    "Intro_Chemistry",
    ".attach",
  ],
  );
});
