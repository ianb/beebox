/**
 * Cards: the canonical "about cards" surface (what a card is, the shared
 * frontmatter envelope, naming, attachments, creating/manipulating), the
 * generated card-type catalogue, and the question-card workflow.
 *
 * `aboutCardsSection` is a leading section in the guide (right after THE LAWS —
 * THE LAW OF CARDS points at it). It is the single home for card concepts other
 * sections used to re-teach; they should cross-reference it instead.
 */

import type { CardSchema } from "../../cards/index.js";
import { getAllTemplates } from "../../schemas/templates.js";
import { SECTION } from "./sections.js";

export function aboutCardsSection(): string[] {
  const createExamples = getAllTemplates().map(
    (t) => `- \`cb create <path> -t ${t.name}\` — ${t.description}`,
  );

  const intro = `## ${SECTION.ABOUT_CARDS}

Cards are the box's central unit — and the primary user-visible thing. What the
user sees in the browser, what a view renders, the thing every ref points at: it
is a card. ${SECTION.LAW_OF_CARDS} says everything worth keeping goes into one;
this is what one *is* and how to work with it.

### What a card is

A card is a **markdown file with required YAML frontmatter**, named
\`Name.type.card\`. The **type comes from the filename** — the \`.recipe.card\` /
\`.person.card\` suffix — never from a \`type:\` field in the frontmatter (there
isn't one). Cards are not XML; anything that says so is stale.

\`\`\`
---
contains: Dana's kitchen-remodel preferences and the contractor's quote.
---
The body is plain markdown. Standard Markdoc tags work here — \`{% quote %}\` for
the user's verbatim words, \`{% source %}\` for provenance — the same as anywhere.
\`\`\`

### Frontmatter every card shares

Most frontmatter is defined by the card's own type (see Card Types, next), but a
few fields are common to all:

- **\`contains:\`** — one sentence stating what can be found inside the card. It
  is the prime retrieval field for \`cb search\` and listings; write it whenever
  you create or substantially edit a card. Describe what is *in* the card, not
  what it *is*: "Maria's phone number and her kids' names," not "a person card."
- **\`ref\`** — a pointer to another card: \`{ref: "..."}\` in frontmatter, or a
  body link to a card path. A leading \`/\` resolves from the **box root** (the
  usual form); a bare path resolves relative to the current card; avoid \`../../\`,
  it is fragile. \`cb validate\` warns when a ref stops resolving and \`cb mv\`
  rewrites refs when a target moves.
- **No Git-tracked metadata.** Don't put \`created\` / \`modified\` (or the like)
  in frontmatter — Git already tracks both authoritatively. Don't duplicate what
  the history already knows.

### Naming

The preferred (not required) convention is **\`First_Last\`** form: capitalized
words joined by underscores (\`Trip_Report\`, \`Maria_Gomez\`) — not dashes, not
lowercase slugs. No two cards in a directory may share a basename.

### Attachments

Files a card references — images, PDFs, sidecars — live in a sibling
\`<basename>.attach/\` directory, referenced from the body with the \`attach/\`
prefix:

\`\`\`
store/notes/Trip_Report.doc.card
store/notes/Trip_Report.attach/photo.jpg
\`\`\`

Then in the body: \`![the view from the cabin](attach/photo.jpg)\`.

### Creating and manipulating cards

Prefer \`cb create\` with a template over authoring frontmatter by hand — the
template gets the shape right, and the filename drives type detection:`;

  const outro = `
For array or structured frontmatter values, use **JSON** (\`options='["Red","Blue"]'\`)
— JSON is the default for anything machine-set. **Two-step pattern:** for a
complex card, \`cb create\` a minimal one, then edit it to fill in the details.

**Move and delete cards with \`cb mv\` / \`cb rm\`, never \`git mv\` / \`mv\` or
\`git rm\` / \`rm\`.** The \`cb\` versions rewrite refs to the card and route deletes
to trash; the raw tools silently break both.

\`cb validate\` runs implicitly on every edit — you don't need to call it after a
change. Reach for it explicitly only when debugging a validation error surfaced
elsewhere.

The full catalogue of card types is in **Card Types**, next.`;

  return [...intro.split("\n"), ...createExamples, ...outro.split("\n")];
}

export function cardTypesSection(allCardSchemas: CardSchema[]): string[] {
  const lines: string[] = [
    "## Card Types",
    "",
  ];
  for (const schema of allCardSchemas) {
    const hasDoc = schema.instructions ? ` — see \`docs/generated/card-${schema.type}.md\`` : "";
    lines.push(`- **${schema.type}**${hasDoc}`);
  }
  lines.push("");
  lines.push("New card types can be defined in `config/schemas/` using `cardSchema()` (YAML frontmatter + markdown body) + Zod — see `config/schemas/CLAUDE.md` for how. Run `cb init` after adding a schema to generate rules and docs.");
  lines.push("");
  return lines;
}

export function questionsSection(): string[] {
  return [
    "## Questions",
    "",
    "Create question cards in `box/questions/` to ask the user.",
    "Set `answered-by` to your agent name so the answer routes back to you.",
    "Always include a `<directive>` element describing what you'll do with the answer — when the user answers, the system creates a follow-up job using this directive.",
    "See `docs/generated/card-question.md` for templates.",
    "",
  ];
}
