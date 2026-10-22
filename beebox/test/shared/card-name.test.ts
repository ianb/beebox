// # card-name: the canonical card filename grammar
//
// One grammar, shared by backend and frontend, for splitting a card filename
// into name + type. Two identity modes: **nominal** (`Name.<type>.card`) and
// **positional** (bare `<type>.card` — "the ‹type› of this directory",
// `name: null`). Job cards keep their dotted discovery convention.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { parseCardFileName, cardTypeFromName } from "../../src/shared/card-name.js";

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
