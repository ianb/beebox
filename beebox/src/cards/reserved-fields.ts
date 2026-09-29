import { GLOBAL_CARD_FIELDS, type CardSchema } from "./schema.js";

/**
 * Field names no card schema may declare, each with what to write instead.
 *
 * These names attract fields that have no job: an agent fills in
 * `status: new` or a `created` time because the name looks standard, a
 * reader expects it to mean something, and nothing reads it. Each message
 * names the specific alternative. See `docs/cards/schemas.md` ("Adding a
 * field").
 */
const BANNED_FIELD_NAMES: Readonly<Record<string, string>> = {
  status:
    "record the specific fact instead: the presence of the result (a `transcript`), an error field (`transcription-error`), or a named boolean such as `archived: true`",
  created:
    "git records when a card was written; a media capture time belongs on the media reference",
  summary:
    "use the global `contains` for what the card holds, or `description` for what its subject is or does",
  date:
    "name the date for what it is (`due`, `starts`), or list several in `dates:` with a `kind` each",
  modified:
    "git records when a card was edited; an external system's timestamp belongs under that system's key",
  source:
    "use `sources: [{ ref } | { href }]` for what the content was derived from; any other meaning gets its own name",
};

/** One reserved field a schema declares, with what to do instead. */
export interface ReservedFieldProblem {
  field: string;
  message: string;
}

function globalFieldMessage(field: string): string {
  if (field === "title") {
    return "`title` is a global field every card already has; set `requireTitle: true` on the schema to require it";
  }
  return `\`${field}\` is a global field every card already has; don't redeclare it`;
}

/**
 * The reserved field names a schema declares at the top level of `fields`:
 * global field names (a redeclaration would silently replace the global
 * one) and the banned names above. Nested keys are not checked.
 *
 * Built-in schemas must have none (a registry test enforces it). Box-local
 * schemas still load with problems; the loader records them so health
 * checks can show them.
 */
export function reservedFieldProblems(schema: CardSchema): ReservedFieldProblem[] {
  const problems: ReservedFieldProblem[] = [];
  for (const field of Object.keys(schema.fields)) {
    if (field in GLOBAL_CARD_FIELDS) {
      problems.push({ field, message: globalFieldMessage(field) });
      continue;
    }
    const banned = BANNED_FIELD_NAMES[field];
    if (banned !== undefined) problems.push({ field, message: `\`${field}\` is a reserved field name: ${banned}` });
  }
  return problems;
}
