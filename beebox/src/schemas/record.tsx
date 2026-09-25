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
import { body, cardSchema, type InferCardFields } from "../cards/index.js";

const RecordStatusSchema = z.enum(["draft", "reviewed", "archived"]);
export type RecordStatus = z.infer<typeof RecordStatusSchema>;

/**
 * Where a record's claim came from. A source is either an in-box card
 * (`ref:`) or a page on the web (`href:`) — the same exclusive pair the
 * `{% source %}` tag takes, so the two vocabularies agree. Before `href`
 * existed, a web source was written as a URL in `ref:`, which the ref walk
 * then reported as a missing file.
 */
const SourceEntry = z
  .object({
    ref: z.string().optional(),
    href: z.string().optional(),
    time: z.string().optional(),
    note: z.string().optional(),
  })
  .superRefine((entry, ctx) => {
    const hasRef = entry.ref !== undefined && entry.ref !== "";
    const hasHref = entry.href !== undefined && entry.href !== "";
    if (hasRef && hasHref) {
      ctx.addIssue({ code: "custom", message: "a `sources` entry takes exactly one of `ref` or `href`, not both" });
    } else if (!hasRef && !hasHref) {
      ctx.addIssue({ code: "custom", message: "a `sources` entry requires exactly one of `ref` or `href`" });
    }
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

export const RecordSchema = cardSchema("record", {
  description: "A discrete extracted unit (inventory item, archived document, contact) pulled from a capture session or other source",
  category: "authored",
  fields: {
    status: RecordStatusSchema.default("draft"),
    name: z.string(),
    description: z.string().optional(),
    sources: z.array(SourceEntry).optional(),
    dates: z.array(DateEntry).optional(),
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
- \`sources:\` — Array of \`{ref | href, time?, note?}\` pointing at where this
  record was extracted from — usually a capture-session card elsewhere
  in the box, so a box-root-absolute \`ref\` (leading \`/\`) reads clearest
  here. The optional \`time\` pinpoints a moment in a transcript; the
  \`note\` explains why this source is relevant.
- \`dates:\` — Array of \`{value, note?}\`. Parseable date strings
  with context ("Year purchased", "Date of letter").
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

Status lifecycle:
- \`draft\` — Freshly extracted, may need human review.
- \`reviewed\` — Human has verified the record is accurate.
- \`archived\` — Record is finalized and stored long-term.`,
});

export type RecordFields = InferCardFields<typeof RecordSchema>;

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
