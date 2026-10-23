// # The card header title
//
// `title:` wins; a landmark without one is headed by its place's
// `navigation.label`; a named entity (person, place) by its `name:`; otherwise
// the filename stands in. The card field renderer uses the same title to
// leave out a `name` row that repeats the header.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { cardTitle } from "../../src/lib/card-title.js";

void test("line 12", async (t) => {
  t.check(cardTitle({ path: "_content/people/Mom.person.card", frontmatter: { name: "Dr. Rosa Quill" } }), "Dr. Rosa Quill");

  t.check(cardTitle({ path: "_content/people/Mom.person.card", frontmatter: { title: "Mom", name: "Dr. Rosa Quill" } }), "Mom");

  t.check(cardTitle({ path: "_content/people/Rosa_Quill.person.card", frontmatter: {} }), "Rosa Quill");
});

// A landmark card is the place page, so it is headed by the place's name, the
// label the place pill and the "Go to" buttons use. The 2026-10-09 walks saw
// "Box" and "Intro Chemistry" (filenames) above pages the rest of the app called
// by the box's name and "Chemistry".
void test("A landmark card is the place page, so it is headed by the place's name, the l...", async (t) => {
  t.check(cardTitle({ path: "_content/Box.landmark.card", frontmatter: { navigation: { label: "Kitchen" } } }), "Kitchen");

  t.check(cardTitle({ path: "_content/chem/Intro_Chemistry.landmark.card", frontmatter: { navigation: { label: "Chemistry", openers: [] } } }), "Chemistry");
});

// A landmark with no label (a destinations-only one) falls back to its filename.
void test("A landmark with no label (a destinations-only one) falls back to its filename.", async (t) => {
  t.check(cardTitle({ path: "_content/inbox/Inbox.landmark.card", frontmatter: { navigation: { label: "  " } } }), "Inbox");
});

// A blank `title:` does not head the card; the next rule applies. A name with
// dots in it keeps them, and a job card drops its kind.
void test("A blank title is skipped, dotted names keep their dots, job cards drop the kind", async (t) => {
  t.check(cardTitle({ path: "_content/people/Rosa_Quill.person.card", frontmatter: { title: "  " } }), "Rosa Quill");
  t.check(cardTitle({ path: "_content/Foo.v2.doc.card", frontmatter: {} }), "Foo.v2");
  t.check(cardTitle({ path: "_content/x.report.job.card", frontmatter: {} }), "x");
});
