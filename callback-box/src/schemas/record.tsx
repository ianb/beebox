/**
 * Record card schema - generic extracted units from capture sessions.
 *
 * Records are domain-flexible: a home inventory item, an archived document,
 * a recipe, a contact — whatever discrete thing was captured. Fields are
 * intentionally loose; use only the ones that are salient.
 */

import { element, serialize } from "cardworks";
import { z } from "zod";

export const RecordStatus = z.enum(["draft", "reviewed", "archived"]);
export type RecordStatus = z.infer<typeof RecordStatus>;

export const RecordName = element("name", {
  text: z.string(),
});

export const RecordDescription = element("description", {
  text: z.string().optional(),
});

export const RecordContent = element("content", {
  text: z.string().optional(),
});

export const RecordSource = element("source", {
  attrs: {
    ref: z.string(),
    time: z.string().optional(),
  },
  text: z.string().optional(),
});

export const RecordSources = element("sources", {
  children: z.array(RecordSource).optional(),
});

export const RecordDate = element("date", {
  attrs: { value: z.string() },
  text: z.string().optional(),
});

export const RecordPerson = element("person", {
  attrs: {
    name: z.string(),
    ref: z.string().optional(),
  },
  text: z.string().optional(),
});

export const RecordLocation = element("location", {
  attrs: { ref: z.string().optional() },
  text: z.string().optional(),
});

export const RecordMeasure = element("measure", {
  attrs: { value: z.string() },
  text: z.string().optional(),
});

export const RecordLanguage = element("language", {
  text: z.string(),
});

export const RecordTriage = element("triage", {
  text: z.string(),
});

export const RecordNotes = element("notes", {
  text: z.string().optional(),
});

/**
 * Record card schema.
 *
 * Example:
 * ```xml
 * <record status="draft">
 *   <name>Brown Leather Couch</name>
 *   <description>Three-seat sofa in the living room, purchased 2019</description>
 *   <sources>
 *     <source ref="capture-20260210T1430-Living_Room/session.capture-session.card" time="2:15">
 *       User points at the couch and describes its condition
 *     </source>
 *   </sources>
 *   <location>Living room</location>
 *   <measure value="1200 USD">Estimated purchase price</measure>
 *   <measure value="7 feet">Length of the couch</measure>
 *   <date value="2019">Year purchased</date>
 * </record>
 * ```
 */
export const RecordSchema = element("record", {
  attrs: {
    status: RecordStatus.default("draft"),
  },
  children: z.array(
    z.union([
      RecordName,
      RecordDescription,
      RecordContent,
      RecordSources,
      RecordDate,
      RecordPerson,
      RecordLocation,
      RecordMeasure,
      RecordLanguage,
      RecordTriage,
      RecordNotes,
    ])
  ),
  instructions: `# Record Cards

Records are generic extracted units — discrete things pulled from capture sessions or other sources. A record might be a home inventory item, an archived document, a recipe, a contact, or any other identifiable thing.

## Fields

- **<name>**: Always present. A short identifying label for this record (e.g., "Brown Leather Couch", "Grandma's Cookie Recipe", "2019 Tax Return").

- **<description>**: About the thing — context, what it is, its condition, why it matters. This describes the record, it doesn't contain the content itself.

- **<content>**: IS the thing — the actual text of a document, recipe instructions, letter text, etc. Only use when the record represents textual content that should be preserved verbatim.

- **<sources>**: References to where this record was extracted from. Each <source ref="..."> must include body text explaining WHY this source is relevant — not just a list of files. The ref attribute is a relative path to a card. The optional time attribute pinpoints a moment in a transcript.

- **<date value="...">**: A parseable date, year, or datetime in the value attribute. Body text explains what the date means ("Year purchased", "Date of letter", "Expiration"). Only include dates that are salient to this kind of record — don't extract every date you can find.

- **<person name="...">**: A person relevant to this record. The name attribute is required. Optional ref links to a person card. Body text explains why this person is relevant ("Author", "Previous owner", "Mentioned in letter").

- **<location>**: Where the thing is, was, or relates to. Free text. Optional ref attribute for linking to a location card.

- **<measure value="...">**: A measurement, quantity, dimension, weight, price, or count. The value attribute is natural language with number and unit together: "2 pages", "7 feet", "1200 USD", "45 pounds", "12 servings". Body text provides context about what's being measured.

- **<language>**: Only include when notable — non-default language, multilingual content, or language is a significant attribute of the record.

- **<triage>**: Only used when a triage workflow is active. Contains triage status or disposition.

- **<notes>**: Anything that doesn't fit elsewhere — observations, caveats, follow-up items.

## Guidelines

Use fields that are appropriate for the domain. A home inventory item needs location and measure but probably not content or language. A document archive entry needs content and date but maybe not measure. Don't exhaustively apply every field to every record.

Status lifecycle:
- **draft**: Freshly extracted, may need human review.
- **reviewed**: Human has verified the record is accurate.
- **archived**: Record is finalized and stored long-term.`,
});

export type Record = z.infer<typeof RecordSchema>;

/**
 * Template for creating a record card.
 */
export function createRecordTemplate(options: {
  name: string;
  description?: string;
  content?: string;
  sources?: Array<{ ref: string; text?: string }>;
}): string {
  const record = (
    <record status="draft">
      <name>{options.name}</name>
      {options.description && <description>{options.description}</description>}
      {options.content && <content>{options.content}</content>}
      {options.sources && options.sources.length > 0 ? (
        <sources>
          {options.sources.map((s) => (
            <source ref={s.ref}>{s.text || ""}</source>
          ))}
        </sources>
      ) : (
        <sources />
      )}
      <notes />
    </record>
  );
  return serialize(record) + "\n";
}
