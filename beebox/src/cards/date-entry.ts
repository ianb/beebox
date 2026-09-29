/**
 * The date entry: one structured date that belongs to a card's subject (when
 * a bill is due, when a letter was written), never when the card was
 * written. Exported from `beebox/cards` so built-in and box-local schemas use
 * one shape. See the Ontology in `docs/plans/standard-card-fields.md`.
 *
 * A card with one such date names the field for it (`due: DateEntrySchema`);
 * a card with several lists them (`dates: z.array(DateEntrySchema)`) and says
 * which is which with `kind`.
 */

import { z } from "zod";

/**
 * ISO 8601 at whatever precision is known: a year (`1974`), a month
 * (`1974-06`), a day (`1974-06-02`), or a date and time with an offset
 * (`2026-09-28T09:30:00-05:00`, `2026-09-28T14:30:00Z`).
 */
const ISO_DATE_VALUE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01])(T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d))?)?)?$/;

/** A date value: ISO 8601 at any precision (see {@link ISO_DATE_VALUE}). */
export const IsoDateValueSchema = z
  .string()
  .regex(ISO_DATE_VALUE, "expected an ISO 8601 date: YYYY, YYYY-MM, YYYY-MM-DD, or a date and time with an offset");

/**
 * - `value` — the date, ISO 8601 at any precision.
 * - `end` — the same format; present, it makes the entry a range from
 *   `value` to `end`.
 * - `kind` — which date this is, when a card has several (`due`, `filed`,
 *   `starts`). A short name, not prose.
 * - `note` — anything else about the date, in prose.
 */
export const DateEntrySchema = z.object({
  value: IsoDateValueSchema,
  kind: z.string().optional(),
  end: IsoDateValueSchema.optional(),
  note: z.string().optional(),
});
export type DateEntry = z.infer<typeof DateEntrySchema>;
