/**
 * One entry of a card's `sources:` list: what the card's content was derived
 * from. Same meaning as the `{% source %}` Markdoc tag
 * (`src/shared/markdoc-config/core.ts`), and an attribute that means what a
 * tag attribute means has the tag's name. See the Ontology in
 * `docs/plans/standard-card-fields.md`. Shared by the built-in schemas in
 * `src/schemas/`.
 */

import { z } from "zod";

/**
 * - `ref` — an in-box card or file; `href` — an external URL. Exactly one.
 * - `retrieved` — when an external `href` was retrieved.
 * - `pos` — where in the target (a page, a heading, a moment in a
 *   transcript), free-form.
 * - `usage` — how the source material was used ("verbatim", "summary").
 * - `label` — display text (frontmatter only).
 * - `note` — why this source is relevant, in prose (frontmatter only).
 */
const SourcesEntryObject = z.object({
  ref: z.string().optional(),
  href: z.string().optional(),
  label: z.string().optional(),
  retrieved: z.string().optional(),
  pos: z.string().optional(),
  usage: z.string().optional(),
  note: z.string().optional(),
});

type SourcesEntryShape = z.infer<typeof SourcesEntryObject>;

function present(value: string | undefined): boolean {
  return value !== undefined && value !== "";
}

/** The problems with an entry's pointer; `labelOnly` allows an entry that names a source it cannot point at. */
function pointerIssues(entry: SourcesEntryShape, { labelOnly }: { labelOnly: boolean }): string[] {
  const hasRef = present(entry.ref);
  const hasHref = present(entry.href);
  const issues: string[] = [];
  if (hasRef && hasHref) issues.push("a `sources` entry takes exactly one of `ref` or `href`, not both");
  else if (!hasRef && !hasHref && !(labelOnly && present(entry.label))) {
    issues.push(labelOnly
      ? "a `sources` entry requires one of `ref` or `href`, or a `label` naming a source with neither"
      : "a `sources` entry requires exactly one of `ref` or `href`");
  }
  if (present(entry.retrieved) && !hasHref) issues.push("a `sources` entry's `retrieved` is only valid with an external `href`");
  return issues;
}

function withPointerCheck(options: { labelOnly: boolean }) {
  return SourcesEntryObject.superRefine((entry, ctx) => {
    for (const message of pointerIssues(entry, options)) ctx.addIssue({ code: "custom", message });
  });
}

/** A `sources` entry: exactly one of `ref` or `href`. */
export const SourcesEntrySchema = withPointerCheck({ labelOnly: false });
export type SourcesEntry = z.infer<typeof SourcesEntrySchema>;

/**
 * A `sources` entry that may instead name a source with nothing to point at
 * (`{ label: "Grandma" }`), for recipes, which record a cookbook or a person
 * as often as a page.
 */
export const LabeledSourcesEntrySchema = withPointerCheck({ labelOnly: true });
