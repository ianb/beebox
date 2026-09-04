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
import { SECTION, xref } from "./sections.js";
import { REF_PATH_RULE } from "./source.js";

export function aboutCardsSection(): string {
  const createExamples = getAllTemplates().map(
    (t) => `- \`bbx create <path> -t ${t.name}\` — ${t.description}`,
  );

  const intro = `## ${SECTION.ABOUT_CARDS}

Cards are the box's central unit — and the primary user-visible thing. What the
user sees in the browser, what a view renders, the thing every ref points at: it
is a card. ${SECTION.LAW_OF_CARDS} says everything worth keeping goes into one;
this is what one *is* and how to work with it.

### What a card is

A card is a **markdown file with required YAML frontmatter**, named in
\`Name.type.card\` form — for example \`Trip_Report.doc.card\`. The **type comes
from the filename** — the \`.doc.card\` / \`.recipe.card\` suffix — so the filename
is load-bearing. Cards are not XML; anything that says so is stale.

\`\`\`
---
contains: Dana's kitchen-remodel preferences and the contractor's quote.
---
The body is plain markdown.
\`\`\`

The box defines its own tags for card bodies, written in Markdoc's \`{% tag %}\`
syntax: \`{% quote %}\` for the user's verbatim words (see ${xref(SECTION.LAW_OF_QUOTING)})
and \`{% source %}\` for provenance and refs (see ${xref(SECTION.PROVENANCE)}).

### Frontmatter every card shares

Most frontmatter is defined by the card's own type (see ${xref(SECTION.CARD_TYPES)},
next), but a few belong to every card:

- **\`title:\`** — a human-readable display title (distinct from the filename).
  Optional on most types; a few require it.
- **\`contains:\`** — one sentence stating what can be found inside the card; the
  prime retrieval field for \`bbx search\` and listings. Write it when you create
  or substantially edit a card. Describe what is *in* the card, not what it *is*
  ("Maria's phone number and her kids' names," not "a person card"). When the
  info is concise let the sentence carry it ("Dentist moved to June 17"); never a
  list of parts; keep it under 200 characters. If you edit content and the
  sentence still holds, \`bbx contains update <card> --text "..."\` clears the
  staleness flag; \`bbx contains list --missing\` / \`--stale\` shows which cards
  still need one written or refreshed.
- **refs** — not a fixed field but a pattern: wherever frontmatter or a body tag
  points at another card (a \`ref:\` value, \`key-people[].ref\`, a \`{% source %}\`
  anchor), the path works the same way. ${REF_PATH_RULE}
  The same goes for a markdown link — in a card body, a plain \`.md\` dossier, or
  a response you hand back to whoever invoked you. When you name another card or
  file, link it with a human title rather than writing a bare filename:
  \`the dates are in [the beta launch plan](/_content/notes/Beta_Launch.doc.card)\`.
  The full \`ref\`/\`href\` semantics (tracking, \`bbx mv\` rewriting, external \`href\`)
  live in ${xref(SECTION.PROVENANCE)}.
- **Link-shaped fields use one vocabulary.** Internal targets use \`ref\`; external
  targets use \`href\`. Put either in an object whose sibling fields explain the
  relationship — for example \`sources: [{href, retrieved, usage}]\` — never an
  ad-hoc bare URL string array. These names rhyme with \`{% source %}\`; use
  date-only ISO (\`YYYY-MM-DD\`) for \`retrieved\`.
- **No Git-tracked metadata.** Don't put \`created\` / \`modified\` (or the like)
  in frontmatter — Git already tracks both authoritatively. Don't duplicate what
  the history already knows.

Many types also carry a \`status:\` field, but its allowed values are
type-specific (\`new\` / \`processed\`, \`draft\` / \`sent\`, \`active\` / \`archived\`,
…) — check the type's schema for the vocabulary that applies.

### Naming

The preferred (not required) convention is **\`First_Last\`** form: capitalized
words joined by underscores (\`Trip_Report\`, \`Maria_Gomez\`) — not dashes, not
lowercase slugs. No two cards in a directory may share a basename.

### Attachments

Files a card references — images, PDFs, sidecars — live in a sibling
\`<basename>.attach/\` directory, referenced from the body with the \`attach/\`
prefix:

\`\`\`
_content/notes/Trip_Report.doc.card
_content/notes/Trip_Report.attach/photo.jpg
\`\`\`

Then in the body: \`![the view from the cabin](attach/photo.jpg)\`. Create the
\`.attach/\` directory yourself when you add the first attachment — it's just a
sibling directory, no special command.

### Creating and manipulating cards

Prefer \`bbx create\` with a template over authoring frontmatter by hand — the
template gets the shape right, and the filename drives type detection:`;

  const outro = `
For array or structured frontmatter values, use **JSON** (\`options='["Red","Blue"]'\`)
— JSON is the default for anything machine-set. **Two-step pattern:** for a
complex card, \`bbx create\` a minimal one, then edit it to fill in the details.

**Move and delete box content with \`bbx mv\` / \`bbx rm\`, never \`git mv\` / \`mv\` or
\`git rm\` / \`rm\`** — a card, a directory, or a plain \`.md\` dossier. \`bbx mv\`
rewrites every inbound reference (frontmatter refs, body tags, inline markdown
links) and \`bbx rm\` routes deletes to trash; the raw tools relocate the files but
leave those references dangling.

### Validation

Cards validate on load. After you edit a card, validation runs automatically and
any problem comes back as a **warning** — it doesn't block the edit, but fix it
promptly (a commit that includes an invalid card is rejected). You rarely call
\`bbx validate\` yourself; only to re-check a specific card while debugging. The
warnings you'll see:

- **invalid \`<type>\` frontmatter** — a required field is missing, a value has the
  wrong type, or an unknown key crept in. Make the frontmatter match the type.
- **reference failed to resolve / broken internal link** — a \`ref\` or markdown
  link points at a card that doesn't exist (common after a hand-move — use
  \`bbx mv\`, which rewrites refs).
- **retired \`view:\` scheme** — drop the prefix and reference the plain box path:
  \`[the trip report](/_content/notes/Trip_Report.doc.card)\` to link, \`![the trip
  report](/_content/notes/Trip_Report.doc.card)\` to embed.
- **duplicate basename** — two cards in one directory share a name; rename one.
- **\`contains:\` too long** — keep it under 200 characters.

The full catalogue of card types is in ${xref(SECTION.CARD_TYPES)}, next.`;

  return [intro, ...createExamples, outro].join("\n");
}

const CARD_CATEGORY_GROUPS = [
  {
    category: "authored",
    heading: "**Types you create and edit** — the working vocabulary:",
  },
  {
    category: "synced",
    heading:
      "**Synced & captured** — created by connectors and the capture UI; you read and edit them, but rarely create one by hand:",
  },
  {
    category: "system",
    heading:
      "**System bookkeeping** — created and consumed by the machinery; you don't author these:",
  },
] as const;

export function cardTypesSection(allCardSchemas: CardSchema[]): string {
  const lines: string[] = [
    `## ${SECTION.CARD_TYPES}`,
    "",
    "Each type with handling instructions has a full reference at `_content/docs/generated/card-<type>.md` — read it before working with a card of that type.",
    "",
  ];
  for (const group of CARD_CATEGORY_GROUPS) {
    const schemas = allCardSchemas.filter((s) => s.category === group.category);
    if (schemas.length === 0) continue;
    lines.push(group.heading);
    lines.push("");
    for (const schema of schemas) {
      const desc = schema.description === undefined ? "" : ` — ${schema.description}`;
      lines.push(`- **${schema.type}**${desc}`);
    }
    lines.push("");
  }
  lines.push("When the user wants a collection of repeated items with distinct typed fields or validation, define a new card type instead of using generic memos or records. New card types can be defined in `src/schemas/` at the box root using `cardSchema()` (YAML frontmatter + markdown body) + Zod — see `src/schemas/CLAUDE.md` for how. NOT `_config/schemas/` — a schema left there is invisible to the loader. Rules Zod field types can't express (cross-field constraints, body-structure checks) go in the schema's `validate` hook, not a Zod `.refine()`. Run `bbx init` after adding a schema to generate rules and docs.");
  return lines.join("\n");
}

export function questionsSection(): string {
  return `## ${SECTION.QUESTIONS}

A question card borrows authority you don't have — to decide, or to know
something as fact rather than guess. Where you are decides the mechanism:

- **In chat, just ask** — a synchronous conversation is not a question-card
  situation; the user is right there. Never create a question card for
  something you can ask in your reply.
- **In a job, triage, procedure, or wakeup**, creating a question card is a
  *good default* when you know where the answer's learning should land — not
  a fallback for when you failed. Set \`learning: {sink, ref?, proposal}\`
  declaring the belief you're testing and where it lands (\`guide\`,
  \`briefing\`, or \`personality\`; sink \`briefing\` must target the root
  briefing card). When the boxholder answers, the follow-up job records the
  confirmed (or denied) belief in that sink as a \`source: user-stated\` fact
  — the strongest evidence tier, since the boxholder said it directly. If a
  job hits ambiguity it can't resolve, finish by asking — don't guess past
  it.

Before asking, check \`_bookkeeping/questions/\` — including \`answered\`, \`dismissed\`,
and \`expired\` cards, not just \`pending\` ones. An existing answer is a
\`user-stated\` fact; don't re-ask it. A dismissal or expiry means the
boxholder didn't care to answer that — raise the bar before asking again, but
note neither closes the question: both stay answerable later (expiry only
demotes visibility from the active view; it's not a rejection).

Always set \`directive:\` — what to do with the answer; the system creates a
follow-up job carrying it once the user answers. Set \`expires-after:\` for a
time-sensitive question that should age out sooner than the default. See
\`_content/docs/generated/card-question.md\` for templates and field reference.`;
}
