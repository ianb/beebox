/**
 * Record card schema — generic extracted units from capture sessions.
 *
 * Records are domain-flexible: a home inventory item, an archived document,
 * a recipe, a contact — whatever discrete thing was captured. Fields are
 * intentionally loose; use only the ones that are salient. The card's
 * markdown body is the textual content of the record (a document body, a
 * letter, recipe instructions) — empty when the record represents
 * something with no textual content (e.g., a couch).
 */

import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { body, cardSchema, type InferCardFields } from "../exports/cards.js";
import { SourcesEntrySchema } from "../cards/sources-entry.js";
import { DateEntrySchema } from "../cards/date-entry.js";

/**
 * The shared date entry, except that `value` stays free text: records hold
 * dates transcribed from old documents, and some are not dates ISO 8601 can
 * state (`1970s`). The instructions ask for ISO 8601 wherever it can.
 */
const RecordDateEntry = DateEntrySchema.extend({ value: z.string() });

const PersonEntry = z.object({
  name: z.string(),
  ref: z.string().optional(),
  role: z.string().optional(),
  notes: z.string().optional(),
  note: z.string().optional(),
});

const LocationEntry = z.object({
  text: z.string().optional(),
  ref: z.string().optional(),
});

const MeasureEntry = z.object({
  value: z.string(),
  note: z.string().optional(),
});

export const RecordSchema = cardSchema("record", {
  brief: "One extracted item or document",
  description: "A discrete extracted unit (inventory item, archived document, contact) pulled from a capture session or other source",
  category: "authored",
  fields: {
    name: z.string(),
    reviewed: z.boolean().optional(),
    archived: z.boolean().optional(),
    description: z.string().optional(),
    sources: z.array(SourcesEntrySchema).optional(),
    dates: z.array(RecordDateEntry).optional(),
    persons: z.array(PersonEntry).optional(),
    location: LocationEntry.optional(),
    quantity: MeasureEntry.optional(),
    measurements: z.array(MeasureEntry).optional(),
    language: z.string().optional(),
    triage: z.string().optional(),
    notes: z.string().optional(),
    body: body(z.string()),
  },
  instructions: `# Record Cards

Records are generic extracted units — discrete things pulled from
capture sessions or other sources. A record might be a home inventory
item, an archived document, a recipe, a contact, or any other
identifiable thing.

## Frontmatter fields

- \`name:\` — Always present. A short identifying label for this
  record (e.g., "Brown Leather Couch", "Grandma's Cookie Recipe",
  "2019 Tax Return").
- \`description:\` — About the thing — context, what it is, its
  condition, why it matters. This describes the record; it doesn't
  contain the content itself.
- \`sources:\` — Array of \`{ref | href, pos?, retrieved?, usage?, note?}\` pointing
  at where this record was extracted from — usually a capture-session card
  elsewhere in the box, so a box-root-absolute \`ref\` (leading \`/\`) reads
  clearest here; a web page is an \`href\`. The optional \`pos\` pinpoints
  where in the source (a moment in a transcript, a page); \`retrieved\` is
  the date a web page was read; \`usage\` says how the material was used
  (\`verbatim\`, \`summary\`); the \`note\` explains why this source is
  relevant. Same attributes as the \`{% source %}\` tag.
- \`dates:\` — Array of \`{value, kind?, end?, note?}\`. \`value\` is
  ISO 8601 at the precision known: \`1974\`, \`1974-06\`,
  \`1974-06-02\`. Only a date ISO 8601 cannot state (\`1970s\`) is
  written as text. \`end\` (ISO 8601) makes a range; \`kind\` names
  which date it is (\`purchased\`, \`written\`); \`note\` gives context
  ("Year purchased", "Postmark only").
- \`persons:\` — Array of \`{name, ref?, role?, notes?, note?}\`.
  People relevant to this record. \`role\` is the person's role in
  this record (e.g. "Sender", "Recipient", "Manager"); \`notes\` or
  \`note\` is freeform context.
- \`location:\` — \`{text?, ref?}\`. Where the thing is, was, or
  relates to.
- \`quantity:\` — \`{value, note?}\` (a single value, not a list). **How
  much or how many of it there is** — the answer to "how many do I
  have": \`"3 items"\`, \`"roughly 15–20"\`, \`"10 ounces"\`, \`"4 sticks"\`.
  Natural language with number and unit together. Whenever you know a
  count or amount, put it here, not in prose — a count in
  \`description:\` can't be summed, sorted, or updated as a field edit.
- \`measurements:\` — Array of \`{value, note?}\`. Facts about the thing
  itself — how big, how heavy, what it cost: \`"2 pages"\`, \`"7 feet"\`,
  \`"45 pounds"\`, \`"1200 USD"\`. Same natural-language shape. The line
  between the two: \`quantity\` is how much you *have*; \`measurements\`
  describe the thing. ("10 ounces" of flour on hand is a quantity; the
  ladder weighing "45 pounds" is a measurement.)
- \`language:\` — Only include when notable.
- \`triage:\` — Only used when a triage procedure is active.
- \`notes:\` — Anything that doesn't fit elsewhere — observations,
  caveats, follow-up items.

## Body (markdown)

The actual textual content of the record — a document body, recipe
instructions, letter text, etc. Empty when the record represents
something with no textual content.

## Guidelines

Use only fields that are appropriate for the domain. A home inventory
item needs \`location\` and \`quantity\` but probably no body. A
document archive entry needs a body and \`dates\` but maybe no
\`measurements\`.

A new record is unreviewed. Set \`reviewed: true\` only when the boxholder
has verified it is accurate, and \`archived: true\` when the boxholder has
finalized it for long-term storage. Leave both absent otherwise.`,
  // A record is listed and found under its name.
  summarize: (card, base) => ({ ...base, title: card.name }),
});

export type RecordFields = InferCardFields<typeof RecordSchema>;

export function createRecordTemplate(options: {
  name: string;
  description?: string | undefined;
  content?: string | undefined;
  sources?: Array<{ ref: string; text?: string | undefined }> | undefined;
}): string {
  const fields: Record<string, unknown> = {
    name: options.name,
  };
  if (options.description !== undefined && options.description !== "") {
    fields["description"] = options.description;
  }
  if (options.sources !== undefined && options.sources.length > 0) {
    fields["sources"] = options.sources.map((s) => {
      const entry: Record<string, unknown> = { ref: s.ref };
      if (s.text !== undefined && s.text !== "") entry["note"] = s.text;
      return entry;
    });
  }
  const yamlText = stringifyYaml(fields);
  const bodyText = options.content === undefined ? "" : options.content;
  const bodyTail = bodyText === ""
    ? ""
    : `${bodyText}${bodyText.endsWith("\n") ? "" : "\n"}`;
  return `---\n${yamlText}---\n${bodyTail}`;
}
