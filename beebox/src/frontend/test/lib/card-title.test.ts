// # The card header title
//
// `title:` wins; a landmark without one is headed by its place's
// `navigation.label`; a named entity (person, place) by its `name:`; otherwise
// the filename stands in. The card field renderer uses the same title to
// leave out a `name` row that repeats the header.

import { test } from "tap";
import "agent-doctest/tap";
import { cardTitle } from "../../src/lib/card-title.js";

void test("line 12", async (t) => {
  // doctest:L13
  t.check(cardTitle({ path: "_content/people/Mom.person.card", frontmatter: { name: "Dr. Rosa Quill" } }), "Dr. Rosa Quill");

  // doctest:L16
  t.check(cardTitle({ path: "_content/people/Mom.person.card", frontmatter: { title: "Mom", name: "Dr. Rosa Quill" } }), "Mom");

  // doctest:L19
  t.check(cardTitle({ path: "_content/people/Rosa_Quill.person.card", frontmatter: {} }), "Rosa Quill");
});

// A landmark card is the place page, so it is headed by the place's name, the
// label the place pill and the "Go to" buttons use. The 2026-10-09 walks saw
// "Box" and "Intro Chemistry" (filenames) above pages the rest of the app called
// by the box's name and "Chemistry".
void test("A landmark card is the place page, so it is headed by the place's name, the l...", async (t) => {
  // doctest:L29
  t.check(cardTitle({ path: "_content/Box.landmark.card", frontmatter: { navigation: { label: "Kitchen" } } }), "Kitchen");

  // doctest:L32
  t.check(cardTitle({ path: "_content/chem/Intro_Chemistry.landmark.card", frontmatter: { navigation: { label: "Chemistry", openers: [] } } }), "Chemistry");
});

// A landmark with no label (a destinations-only one) falls back to its filename.
void test("A landmark with no label (a destinations-only one) falls back to its filename.", async (t) => {
  // doctest:L39
  t.check(cardTitle({ path: "_content/inbox/Inbox.landmark.card", frontmatter: { navigation: { label: "  " } } }), "Inbox");
});
