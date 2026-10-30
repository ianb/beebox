// # card-name: the canonical card filename grammar
//
// One grammar, shared by backend and frontend, for splitting a card filename
// into name + type. Two identity modes: **nominal** (`Name.<type>.card`) and
// **positional** (bare `<type>.card` — "the ‹type› of this directory",
// `name: null`). Job cards keep their dotted discovery convention.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { parseCardFileName, cardTypeFromName, cardDisplayName, titleFromFilename } from "../../src/shared/card-name.js";

// ## Nominal names split into name + type
void test("Nominal names split into name + type", async (t) => {
  t.check(parseCardFileName("Meeting_Tomorrow.email-thread.card"), {
    name: "Meeting_Tomorrow",
    type: "email-thread",
  });
});

// ## Positional names are all type, no name
void test("Positional names are all type, no name", async (t) => {
  t.check(parseCardFileName("nav.card"), {
    name: null,
    type: "nav",
  });
});

// ## Job cards resolve to their hyphenated schema type
//
// There is no positional job form: a two-segment name ending in `.job.card`
// is a nominal card of type `job`.
void test("There is no positional job form:", async (t) => {
  t.check(parseCardFileName("Foo.intake.job.card"), {
    name: "Foo",
    type: "intake-job",
  });

  t.check(parseCardFileName("intake.job.card"), {
    name: "intake",
    type: "job",
  });
});

// ## Non-card names don't parse
void test("Non-card names don't parse", async (t) => {
  t.check(parseCardFileName("notes.md"), null);

  t.check(parseCardFileName(".card"), null);
});

// ## `cardTypeFromName` tolerates paths and `?query` suffixes
void test("`cardTypeFromName` tolerates paths and `?query` suffixes", async (t) => {
  t.check(cardTypeFromName("_content/recipes/Bread.recipe.card"), "recipe");

  t.check(cardTypeFromName("_content/projects/nav.card?create"), "nav");

  t.check(cardTypeFromName("_content/notes/readme.md"), undefined);
});

// ## A card path reads as its name
//
// Nominal names read `_` and `-` runs as one space; a positional card reads as
// its type; the directory is ignored. `#` and `?` belong to the filename (a
// ref's fragment is the caller's to strip), so a hand-named card keeps them.
void test("A card path reads as its name", async (t) => {
  t.check(cardDisplayName("_content/inbox/Meeting_Notes.doc.card"), "Meeting Notes");
  t.check(cardDisplayName("/_content/inbox/Voice_2026-03-15.doc.card"), "Voice 2026 03 15");
  t.check(cardDisplayName("a__b.doc.card"), "a b");
  t.check(cardDisplayName("_content/nav.card"), "nav");
  t.check(cardDisplayName("Issue_#5.doc.card"), "Issue #5");
  t.check(cardDisplayName("_content/chat/Mar15.chat-thread.card#m12"), null);
});

// ## Dots inside a name stay; job cards drop the job kind
void test("Dots inside a name stay; job cards drop the job kind", async (t) => {
  t.check(cardDisplayName("Foo.v2.doc.card"), "Foo.v2");
  t.check(cardDisplayName("x.report.job.card"), "x");
});

// ## A path that is not a card has no card name
void test("A path that is not a card has no card name", async (t) => {
  t.check(cardDisplayName("photos/my_file.pdf"), null);
  t.check(cardDisplayName("notes.md"), null);
  t.check(cardDisplayName(""), null);
});

// ## Titles fall back to the file stem when the path is not a card
void test("Titles fall back to the file stem when the path is not a card", async (t) => {
  t.check(titleFromFilename("_content/Meeting_Notes.doc.card"), "Meeting Notes");
  t.check(titleFromFilename("Foo.v2.doc.card"), "Foo.v2");
  t.check(titleFromFilename("photos/photo-001.jpg"), "photo 001");
  t.check(titleFromFilename("my_file.v2.pdf"), "my file");
  t.check(titleFromFilename("README"), "README");
});
