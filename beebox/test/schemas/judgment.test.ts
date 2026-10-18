// # Judgment cards
//
// A judgment card is an authored Jev prompt: named questions in frontmatter, the
// instructions in the body, no state (`src/schemas/judgment/schema.ts`). Each question's
// `criteria` takes the Decisions API shape for its type, and one refinement per
// type names the shape it needs. See docs/implemented-plans/notifications.md (Track D).

import { test } from "tap";
import "agent-doctest/tap";
import { any, str } from "agent-doctest/check";
import { JudgmentSchema, judgmentQuestions } from "../../src/schemas/judgment/schema.js";
import { cardFields, parseCardText } from "../../src/core/card-io.js";
import { createCardSchemaMap } from "../../src/schemas.js";

const issues = (fields: Record<string, unknown>) => {
  const parsed = JudgmentSchema.frontmatterSchema.safeParse({ type: "judgment", ...fields });
  return parsed.success ? "valid" : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
};

function parseError(text: string, schemas: Awaited<ReturnType<typeof createCardSchemaMap>>) {
  try {
    parseCardText(text, { source: "empty.judgment.card", schemas });
    return "parsed";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// ## The three question types
//
// A `noul` is a yes/no with `{ true, false }`; a `choice` maps options to
// descriptions; a `score` lists levels, lowest first. `instructions` is optional
// per question.
void test("A noul is a yes/no with { true, false }; a choice maps options to description...", async (t) => {
  // doctest:L35
  t.check(issues({ questions: { trip: { type: "noul", criteria: { true: "The school wrote about the trip.", false: "Nothing about the trip." } } } }), "valid");

  // doctest:L38
  t.check(issues({ questions: { reply: { type: "choice", instructions: "Read the whole email.", criteria: { expects: "Asks for an answer.", none: "Asks nothing.", unclear: "Cannot tell." } } } }), "valid");

  // doctest:L41
  t.check(issues({ questions: { urgency: { type: "score", instructions: ["One.", "Two."], criteria: ["Can wait a month.", "This week.", "Today."] } } }), "valid");
});

// ## A criteria of the wrong shape fails with the rule
void test("A criteria of the wrong shape fails with the rule", async (t) => {
  // doctest:L48
  t.check(issues({ questions: { trip: { type: "noul", criteria: { yes: "Trip.", no: "No trip." } } } }), "questions.trip.criteria: a noul question's criteria is {true: <what yes means>, false: <what no means>}");

  // doctest:L51
  t.check(issues({ questions: { reply: { type: "choice", criteria: { expects: "Asks for an answer." } } } }), "questions.reply.criteria: a choice question's criteria maps each option to its description, with at least two options");

  // doctest:L54
  t.check(issues({ questions: { urgency: { type: "score", criteria: { low: "Later." } } } }), "questions.urgency.criteria: a score question's criteria is a list of level descriptions, lowest first, with at least two levels");

  // doctest:L57
  t.check(issues({ questions: {} }), "questions: a judgment needs at least one question");
});

// ## A card on disk, as `bbx judge` reads it
//
// YAML reads the unquoted `true:` and `false:` keys as the strings the wire
// wants, the body is the instructions, and `situation` is a card ref. An empty
// body fails: the body is where the card says what the state is.
void test("YAML reads the unquoted true: and false: keys as the strings the wire wants,...", async (t) => {
  // doctest:L68
  const schemas = await createCardSchemaMap(undefined);
  const card = parseCardText(`---
questions:
  trip:
    type: noul
    criteria:
      true: "At least one email is from the school about the spring field trip."
      false: "None is; a newsletter that mentions the school does not count."
situation:
  ref: /_content/about/family.doc.card
---
You are looking at the email cards that arrived since the last check.
`, { source: "field-trip.judgment.card", schemas });
  const fields = cardFields(card, JudgmentSchema);
  t.check(judgmentQuestions(fields), {
    trip: {
      type: "noul",
      instructions: [],
      criteria: {
        true: "At least one email is from the school about the spring field trip.",
        false: "None is; a newsletter that mentions the school does not count.",
      },
    },
  });

  // doctest:L85
  t.check(fields.situation?.ref, "/_content/about/family.doc.card");

  // doctest:L88
  t.check(parseError("---\nquestions:\n  trip:\n    type: noul\n    criteria: { true: a, false: b }\n---\n\n", schemas), str`${any(String)}the body is the instructions Jev receives: say what the state is${any(String)}`);
});
