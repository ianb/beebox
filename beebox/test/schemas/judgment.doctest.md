# Judgment cards

A judgment card is an authored Jev prompt: named questions in frontmatter, the
instructions in the body, no state (`src/schemas/judgment.ts`). Each question's
`criteria` takes the Decisions API shape for its type, and one refinement per
type names the shape it needs. See docs/plans/notifications.md (Track D).

```ts setup
import { JudgmentSchema, judgmentQuestions } from "../../src/schemas/judgment.js";
import { parseCardText } from "../../src/core/card-io.js";
import { createCardSchemaMap } from "../../src/schemas/registry.js";

const issues = (fields) => {
  const parsed = JudgmentSchema.frontmatterSchema.safeParse({ type: "judgment", ...fields });
  return parsed.success ? "valid" : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
};

function parseError(text, schemas) {
  try {
    parseCardText(text, { source: "empty.judgment.card", schemas });
    return "parsed";
  } catch (e) {
    return e.message;
  }
}
```

## The three question types

A `noul` is a yes/no with `{ true, false }`; a `choice` maps options to
descriptions; a `score` lists levels, lowest first. `instructions` is optional
per question.

```ts
issues({ questions: { trip: { type: "noul", criteria: { true: "The school wrote about the trip.", false: "Nothing about the trip." } } } })
=> valid

issues({ questions: { reply: { type: "choice", instructions: "Read the whole email.", criteria: { expects: "Asks for an answer.", none: "Asks nothing.", unclear: "Cannot tell." } } } })
=> valid

issues({ questions: { urgency: { type: "score", instructions: ["One.", "Two."], criteria: ["Can wait a month.", "This week.", "Today."] } } })
=> valid
```

## A criteria of the wrong shape fails with the rule

```ts
issues({ questions: { trip: { type: "noul", criteria: { yes: "Trip.", no: "No trip." } } } })
=> questions.trip.criteria: a noul question's criteria is {true: <what yes means>, false: <what no means>}

issues({ questions: { reply: { type: "choice", criteria: { expects: "Asks for an answer." } } } })
=> questions.reply.criteria: a choice question's criteria maps each option to its description, with at least two options

issues({ questions: { urgency: { type: "score", criteria: { low: "Later." } } } })
=> questions.urgency.criteria: a score question's criteria is a list of level descriptions, lowest first, with at least two levels

issues({ questions: {} })
=> questions: a judgment needs at least one question
```

## A card on disk, as `bbx judge` reads it

YAML reads the unquoted `true:` and `false:` keys as the strings the wire
wants, the body is the instructions, and `situation` is a card ref. An empty
body fails: the body is where the card says what the state is.

```ts
const schemas = await createCardSchemaMap(undefined);
const card = parseCardText(`---
questions:
  trip:
    type: noul
    criteria:
      true: "At least one email is from the school about the spring field trip."
      false: "None is; a newsletter that mentions the school does not count."
situation:
  ref: /_content/about/family.memo.card
---
You are looking at the email cards that arrived since the last check.
`, { source: "field-trip.judgment.card", schemas });
JSON.stringify(judgmentQuestions(card.fields))
=> {"trip":{"type":"noul","instructions":[],"criteria":{"true":"At least one email is from the school about the spring field trip.","false":"None is; a newsletter that mentions the school does not count."}}}

card.fields.situation.ref
=> /_content/about/family.memo.card

parseError("---\nquestions:\n  trip:\n    type: noul\n    criteria: { true: a, false: b }\n---\n\n", schemas)
=> «*»the body is the instructions Jev receives: say what the state is«*»
```
