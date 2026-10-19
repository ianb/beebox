// # A card's `prominence` (`shared/prominence.ts`)
//
// `prominence` is who a card is for, and whether the box should surface it to a
// reader looking around — not access: every card, at every level, is readable
// and addressable. It is a global field with a closed three-value vocabulary
// and an absent default; absent means the card type's default level
// (`defaultProminence` on `CardSchema`), computed once when a schema is
// declared.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { GLOBAL_CARD_FIELDS } from "../../src/cards/schema.js";
import { Prominence, effectiveLevel } from "../../src/shared/prominence.js";
import { DocSchema } from "../../src/schemas/doc.js";
import { QuestionFollowupJobSchema } from "../../src/schemas/question-followup-job.js";
import { LandmarkSchema } from "../../src/schemas/landmark.js";

// ## It is a global field
void test("It is a global field", async (t) => {
  t.check(Object.keys(GLOBAL_CARD_FIELDS).join(","), "title,contains,contains-evidence,todos,symbol,prominence,theme");
});

// ## A fourth value rejects, naming the three it accepts
//
// A wrong value is a hard error at parse time — the closed enum on a global
// field, like every other enum field in the tree — and the message names what
// it does accept, so the author can fix it without hunting for the vocabulary.
void test("A wrong value is a hard error at parse time — the closed enum on a global fie...", async (t) => {
  const result = Prominence.safeParse("headline");
  t.check(result.success, false);

  t.check(result.error?.issues[0]?.message, str`${any(String)}"entry-point"|"primary"|"background"`);
});

// ## Type defaults: `defaultProminence` on `CardSchema`
//
// A `category: "system"` schema (cards the box writes for its own use, like a
// follow-up job) defaults to `background` with nothing declared per schema — the
// category is the declaration.
void test("A category:", async (t) => {
  t.check(QuestionFollowupJobSchema.category, "system");

  t.check(QuestionFollowupJobSchema.defaultProminence, "background");

  // An ordinary authored schema defaults to `ordinary`.

  t.check(DocSchema.category, "authored");

  t.check(DocSchema.defaultProminence, "ordinary");

  // The landmark schema is `authored`, not `system` — but it declares its own
  // type default, because a landmark is the directory's identity rather than one
  // of its cards: Browse folds it into the folder header, and opening it shows the
  // place page.

  t.check(LandmarkSchema.category, "authored");

  t.check(LandmarkSchema.defaultProminence, "background");
});

// ## `effectiveLevel`: a declared value always wins over the type default
void test("`effectiveLevel`: a declared value always wins over the type default", async (t) => {
  t.check(effectiveLevel({ declared: "primary", typeDefault: QuestionFollowupJobSchema.defaultProminence }), "primary");

  t.check(effectiveLevel({ declared: undefined, typeDefault: QuestionFollowupJobSchema.defaultProminence }), "background");
});
