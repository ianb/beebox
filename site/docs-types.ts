// Shared types for the agent-docs corpus module (site/docs*.ts). See
// beebox/docs/plans/agent-docs.md ("Sources", "Comparisons") and the
// workstream's file contract for the full spec.

import { z } from "zod";

export const comparedFrontmatterSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
    subject: z.string().min(1),
    beebox: z.string().min(1),
    "looked-for": z.array(z.string().min(1)).min(1),
    "not-looked-for": z.array(z.string().min(1)),
  })
  .strict();

export type ComparedFrontmatter = z.infer<typeof comparedFrontmatterSchema>;

export type DocKind = "authored" | "promoted" | "generated";

/** One doc that will be written under dist/docs/. `publishPath` is posix, relative to /docs/. */
export interface PublishedDoc {
  publishPath: string;
  kind: DocKind;
  /** One-line index-row text: authored/promoted frontmatter `description`, or generated `readWhen`. */
  description: string;
  /** Markdown body, already link-resolved. The header line and caveat block are added at write time. */
  body: string;
  compared?: ComparedFrontmatter;
  /** Where this doc came from, for error messages (repo-relative path or site/docs/-relative path). */
  sourceLabel: string;
}
