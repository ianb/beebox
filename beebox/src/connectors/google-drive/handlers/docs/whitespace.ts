/**
 * The one question the Drive docs push asks about whitespace.
 *
 * Its own module because it is the guard standing between a routine lint fix
 * and destroyed upstream documents, and because that makes it testable without
 * a connector, a box, or a fake Drive.
 */

/**
 * Does the local markdown strip trailing whitespace off a line it otherwise
 * keeps?
 *
 * Google's export encodes a line break inside a nested list item as trailing
 * spaces, so a push that removes them collapses nested checklists into run-on
 * paragraphs when the markdown is converted back to Doc format. The damage is
 * not confined to a whitespace-only edit: a lint sweep bundled with a real
 * content change destroys exactly as much, so the question asked here is per
 * line, not per file.
 *
 * A line the edit genuinely rewrote or deleted is not a strip and does not
 * count — only a line that survives verbatim except for its trailing
 * whitespace. Counting occurrences rather than matching them pairwise makes two
 * ambiguous cases inexact, in opposite directions: a delete plus an unrelated
 * insert of the same text reads as a strip and is refused, and deleting one of
 * two identical lines where only the deleted copy carried trailing whitespace
 * reads as a deletion and is pushed. A lint sweep never removes a line, so
 * neither case is on the path this guard exists to block.
 */
export function stripsUpstreamTrailingWhitespace(local: string, remote: string): boolean {
  const tally = (text: string): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const line of text.split("\n")) counts.set(line, (counts.get(line) ?? 0) + 1);
    return counts;
  };
  const localLines = tally(local);
  const remoteLines = tally(remote);
  const count = (lines: Map<string, number>, line: string): number => lines.get(line) ?? 0;

  for (const [line, remoteCount] of remoteLines) {
    const trimmed = line.replace(/[\t ]+$/, "");
    if (trimmed === line) continue; // No trailing whitespace to lose.
    if (count(localLines, line) >= remoteCount) continue; // Every copy survived intact.
    if (count(localLines, trimmed) > count(remoteLines, trimmed)) return true;
  }
  return false;
}
