/**
 * A body that opens with `# <title>` reads the title twice: the card page
 * shows `title:`. `MarkdownCardView` hides that line with the same predicate,
 * so this warning is about the file, not what the reader sees.
 */

import { leadingTitleHeading } from "../../../shared/leading-title-heading.js";
import type { LintIssue } from "../../../cards/lint-format.js";

/** The `body` warning for a card whose body repeats its title as an H1. */
export function bodyTitleWarnings(fields: Record<string, unknown>): LintIssue[] {
  const body = fields["body"];
  const title = fields["title"];
  if (typeof body !== "string" || typeof title !== "string") return [];
  if (leadingTitleHeading(body, title) === null) return [];
  return [{
    type: "body",
    severity: "warning",
    message: "body repeats the title as a heading; the title is shown from `title:`",
  }];
}
