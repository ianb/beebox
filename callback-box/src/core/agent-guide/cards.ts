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
  prime retrieval field for \`cb search\` and listings. Write it when you create
  or substantially edit a card. Describe what is *in* the card, not what it *is*
  ("Maria's phone number and her kids' names," not "a person card"). When the
  info is concise let the sentence carry it ("Dentist moved to June 17"); never a
  list of parts; keep it under 200 characters. If you edit content and the
  sentence still holds, \`cb contains update <card> --text "..."\` clears the
  staleness flag; \`cb contains list --missing\` / \`--stale\` shows which cards
  still need one written or refreshed.
- **\`ref\`** — a pointer to another card. A leading \`/\` resolves from the **box
  root**; a bare path resolves relative to the current card; avoid \`../../\`. The
  full \`ref\`/\`href\` semantics (tracking, \`cb mv\` rewriting, external \`href\`)
  live in ${xref(SECTION.PROVENANCE)}.
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
store/notes/Trip_Report.doc.card
store/notes/Trip_Report.attach/photo.jpg
\`\`\`

Then in the body: \`![the view from the cabin](attach/photo.jpg)\`. Create the
\`.attach/\` directory yourself when you add the first attachment — it's just a
sibling directory, no special command.

### Creating and manipulating cards

Prefer \`cb create\` with a template over authoring frontmatter by hand — the
template gets the shape right, and the filename drives type detection:`;

  const outro = `
For array or structured frontmatter values, use **JSON** (\`options='["Red","Blue"]'\`)
— JSON is the default for anything machine-set. **Two-step pattern:** for a
complex card, \`cb create\` a minimal one, then edit it to fill in the details.

**Move and delete box content with \`cb mv\` / \`cb rm\`, never \`git mv\` / \`mv\` or
\`git rm\` / \`rm\`** — a card, a directory, or a plain \`.md\` dossier. \`cb mv\`
rewrites every inbound reference (frontmatter refs, body tags, inline markdown
links) and \`cb rm\` routes deletes to trash; the raw tools relocate the files but
leave those references dangling.

### Validation

Cards validate on load. After you edit a card, validation runs automatically and
any problem comes back as a **warning** — it doesn't block the edit, but fix it
promptly (a commit that includes an invalid card is rejected). You rarely call
\`cb validate\` yourself; only to re-check a specific card while debugging. The
warnings you'll see:

- **invalid \`<type>\` frontmatter** — a required field is missing, a value has the
  wrong type, or an unknown key crept in. Make the frontmatter match the type.
- **reference failed to resolve / broken internal link** — a \`ref\` or markdown
  link points at a card that doesn't exist (common after a hand-move — use
  \`cb mv\`, which rewrites refs).
- **retired \`view:\` scheme** — drop the prefix and reference the plain box path:
  \`[label](store/x.card)\` to link, \`![label](store/x.card)\` to embed.
- **duplicate basename** — two cards in one directory share a name; rename one.
- **\`contains:\` too long** — keep it under 200 characters.

The full catalogue of card types is in ${xref(SECTION.CARD_TYPES)}, next.`;

  return [...intro.split("\n"), ...createExamples, ...outro.split("\n")];
}

export function cardTypesSection(allCardSchemas: CardSchema[]): string[] {
  const lines: string[] = [
    `## ${SECTION.CARD_TYPES}`,
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
    `## ${SECTION.QUESTIONS}`,
    "",
    "Create question cards in `box/questions/` to ask the user.",
    "Set `answered-by` to your agent name so the answer routes back to you.",
    "Always include a `<directive>` element describing what you'll do with the answer — when the user answers, the system creates a follow-up job using this directive.",
    "See `docs/generated/card-question.md` for templates.",
    "",
  ];
}
