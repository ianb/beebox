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
import { body, cardSchema, type CardSchema } from "../cards/index.js";

export const RecordStatus = z.enum(["draft", "reviewed", "archived"]);
export type RecordStatus = z.infer<typeof RecordStatus>;

const SourceEntry = z.object({
  ref: z.string(),
  time: z.string().optional(),
  note: z.string().optional(),
});

const DateEntry = z.object({
  value: z.string(),
  note: z.string().optional(),
});

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

export const RecordSchema: CardSchema = cardSchema("record", {
  description: "A discrete extracted unit (inventory item, archived document, contact) pulled from a capture session or other source",
  category: "authored",
  fields: {
    status: RecordStatus.default("draft"),
    name: z.string(),
    description: z.string().optional(),
    sources: z.array(SourceEntry).optional(),
    dates: z.array(DateEntry).optional(),
    persons: z.array(PersonEntry).optional(),
    location: LocationEntry.optional(),
    measures: z.array(MeasureEntry).optional(),
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
- \`sources:\` — Array of \`{ref, time?, note?}\`. References to where
  this record was extracted from. Use **absolute paths** for refs
  (starting with /, e.g.
  \`/box/inbox/capture-.../session.capture-session.card\`). The
  optional \`time\` pinpoints a moment in a transcript. The \`note\`
  explains why this source is relevant.
- \`dates:\` — Array of \`{value, note?}\`. Parseable date strings
  with context ("Year purchased", "Date of letter").
- \`persons:\` — Array of \`{name, ref?, role?, notes?, note?}\`.
  People relevant to this record. \`role\` is the person's role in
  this record (e.g. "Sender", "Recipient", "Manager"); \`notes\` or
  \`note\` is freeform context.
- \`location:\` — \`{text?, ref?}\`. Where the thing is, was, or
  relates to.
- \`measures:\` — Array of \`{value, note?}\`. Natural language with
  number and unit together: \`"2 pages"\`, \`"7 feet"\`, \`"1200 USD"\`.
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
item needs \`location\` and \`measures\` but probably no body. A
document archive entry needs a body and \`dates\` but maybe no
\`measures\`.

Status lifecycle:
- \`draft\` — Freshly extracted, may need human review.
- \`reviewed\` — Human has verified the record is accurate.
- \`archived\` — Record is finalized and stored long-term.`,
});

export interface RecordFields {
  type: "record";
  status: RecordStatus;
  name: string;
  description?: string;
  sources?: Array<{ ref: string; time?: string; note?: string }>;
  dates?: Array<{ value: string; note?: string }>;
  persons?: Array<{ name: string; ref?: string; role?: string; notes?: string; note?: string }>;
  location?: { text?: string; ref?: string };
  measures?: Array<{ value: string; note?: string }>;
  language?: string;
  triage?: string;
  notes?: string;
  body: string;
}

export function createRecordTemplate(options: {
  name: string;
  description?: string | undefined;
  content?: string | undefined;
  sources?: Array<{ ref: string; text?: string | undefined }> | undefined;
}): string {
  const fields: Record<string, unknown> = {
    status: "draft",
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
