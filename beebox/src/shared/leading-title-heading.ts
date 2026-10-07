/**
 * Does a card body open by repeating its `title:` as a heading?
 *
 * The card page shows the title from `title:`, so a body whose first line is
 * `# <same title>` reads the title twice. Lint warns on it
 * (`core/card-lint/core/lint-cards.ts`) and `MarkdownCardView` hides it; both
 * call this predicate so they agree on which cards repeat the title.
 *
 * The match is plain text: the first non-blank line must be an ATX H1
 * (`# text`, optional closing `#`s) whose text equals the title after
 * trimming and case-folding. A heading with emphasis or a link around the
 * words is not a repeat; it is shown and not warned.
 */

const ATX_H1 = /^ {0,3}#(?=[\t ]|$)(.*)$/;
const CLOSING_HASHES = /(?:^|[\t ]+)#+$/;

/**
 * The 1-based body line of a leading `# <title>` heading, or null when the
 * body does not open with one (or the title is empty).
 */
export function leadingTitleHeading(body: string, title: string): { line: number } | null {
  const wanted = title.trim().toLowerCase();
  if (wanted === "") return null;
  const lines = body.split("\n");
  const index = lines.findIndex((line) => line.trim() !== "");
  if (index === -1) return null;
  const match = ATX_H1.exec((lines[index] ?? "").replace(/\r$/, ""));
  if (match === null) return null;
  const text = (match[1] ?? "").trim().replace(CLOSING_HASHES, "").trim();
  return text.toLowerCase() === wanted ? { line: index + 1 } : null;
}

/**
 * The body with a leading `# <title>` line replaced by an empty line, so the
 * remaining lines keep their numbers (todo locators count body lines).
 */
export function blankLeadingTitleHeading(body: string, title: string): string {
  const found = leadingTitleHeading(body, title);
  if (found === null) return body;
  const lines = body.split("\n");
  lines[found.line - 1] = "";
  return lines.join("\n");
}
