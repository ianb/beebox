// # Readable card fields
//
// The generic field renderer shows a card's fields as a person reads them, not
// as the file stores them (`docs/implemented-plans/readable-card-fields.md`). These two
// rules decide it; the Source view keeps the keys and shapes as written.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { compactValue, fieldLabel, withoutHeaderName } from "../../src/lib/readable-fields.js";

// ## Labels
//
// A key becomes a label: split on `-` and `_`, first letter capitalized. The
// rest stays as written, so an abbreviation reads "Ssn"; a better field name or
// a custom view fixes that.
void test("A key becomes a label:", async (t) => {
  // doctest:L18
  t.check(fieldLabel("back-by"), "Back by");

  // doctest:L21
  t.check(fieldLabel("location"), "Location");

  // doctest:L24
  t.check(fieldLabel("due_date"), "Due date");

  // doctest:L27
  t.check(fieldLabel("ssn"), "Ssn");
});

// ## Identity shapes read as a name
//
// An object with a `name` (or `label`, or `title`) names a thing. Its `ref` is
// the link to that thing's card, and `role`, `note`, `notes` are the aside, in
// that order.
void test("An object with a name (or label, or title) names a thing.", async (t) => {
  // doctest:L38
  t.check(compactValue({ name: "Idris", ref: "../people/Idris_Okafor.person.card", role: "lender" }), {
    text: "Idris",
    ref: "../people/Idris_Okafor.person.card",
    aside: "lender",
  });

  // doctest:L41
  t.check(compactValue({ name: "Idris" }), {
    text: "Idris",
  });

  // doctest:L44
  t.check(compactValue({ label: "Kitchen", note: "upstairs" }), {
    text: "Kitchen",
    aside: "upstairs",
  });

  // doctest:L47
  t.check(compactValue({ name: "Idris", role: "lender", notes: "returns on Fridays" }), {
    text: "Idris",
    aside: "lender, returns on Fridays",
  });
});

// ## Plain value shapes read as their text
//
// An object with `text` or `value`, and optionally `note`/`notes`, reads as
// the text with the note as the aside.
void test("An object with text or value, and optionally note/notes, reads as the text wi...", async (t) => {
  // doctest:L57
  t.check(compactValue({ value: "1 stove", note: "missing lid" }), {
    text: "1 stove",
    aside: "missing lid",
  });

  // doctest:L60
  t.check(compactValue({ text: "With Idris" }), {
    text: "With Idris",
  });
});

// ## Anything else keeps its rows
//
// A `ref` beside `text` can be evidence (a guide observation cites where it
// came from), so it is not turned into a link on the text: the object keeps
// its own rows.
void test("A ref beside text can be evidence (a guide observation cites where it came fr...", async (t) => {
  // doctest:L71
  t.check(compactValue({ text: "Water pools by the door", ref: "../notes/Rain.note.card" }), null);
});

// An extra key would be hidden by a compact value, so the object keeps its
// rows. So does an identity shape with a key it does not know (a guide action's
// `when`), a non-string part, or two candidate texts.
void test("An extra key would be hidden by a compact value, so the object keeps its rows.", async (t) => {
  // doctest:L80
  t.check(compactValue({ value: "3", unit: "spools" }), null);

  // doctest:L83
  t.check(compactValue({ name: "Water the ferns", when: "Saturday" }), null);

  // doctest:L86
  t.check(compactValue({ value: 3 }), null);

  // doctest:L89
  t.check(compactValue({ name: "Idris", title: "Dr." }), null);

  // doctest:L92
  t.check(compactValue({ ref: "../people/Idris_Okafor.person.card" }), null);
});

// ## The row that repeats the header
//
// A `name` row whose value is the card's header title is dropped before the
// fields are framed, so a card with nothing else to show gets no empty field
// section. A `name` that differs from the header stays.
void test("A name row whose value is the card's header title is dropped before the field...", async (t) => {
  // doctest:L103
  t.check(withoutHeaderName({ name: "Camp stove", location: { text: "With Idris" } }, "Camp stove"), {
    location: {
      text: "With Idris",
    },
  });

  // doctest:L106
  t.check(withoutHeaderName({ name: "Camp stove" }, "Stove"), {
    name: "Camp stove",
  });
});
