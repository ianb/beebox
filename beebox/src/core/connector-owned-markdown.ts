/**
 * Identifying the markdown a Drive connector owns.
 *
 * A gdoc card's body is not authored here: it is whatever Google's export API
 * produced, mirrored into the card's `<basename>.attach/` scope, and whatever
 * sits in that file is pushed back upstream on the next sync. Two things
 * follow, and both callers of this module need the same answer:
 *
 *  - Lint must not gate a commit on it. Google's markdown export puts trailing
 *    whitespace at the end of lines inside nested checklists, which MD009
 *    flags; the connector's own pull then cannot be committed, the tree stays
 *    dirty, and every later commit fails on a file nobody wrote.
 *  - An agent editing it must be told what it is. "Fix the lint error" on one
 *    of these files is a push that can destroy structure the markdown does not
 *    express — the incident this module exists because of
 *    (`issues/bugs/2026-09-16-drive-doc-round-trip-destroyed-by-lint-driven-whitespace-edit.md`).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { attachDirOwnerBasename } from "../shared/attach-path.js";

/**
 * The only markdown a connector both writes and pushes is a gdoc's body,
 * `<basename>.attach/<basename>.md`, plus the `<basename>.remote.md` a refused
 * push parks beside it (`connectors/drive-handler-docs.ts`). Nothing else in
 * that scope is connector-owned — a gsheet mirrors JSON tab files, and an
 * agent's own notes beside either card are ordinary authored content that
 * should still be linted.
 */
function connectorOwnedFilenames(owner: string): string[] {
  return [`${owner}.md`, `${owner}.remote.md`];
}

async function exists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch (_e) {
    // Absence is the ordinary answer here, not a failure.
    return false;
  }
}

/**
 * Is `absPath` the markdown body of a gdoc card — the file Google's export
 * writes and the next sync pushes back upstream?
 *
 * Requires the owner card to exist rather than trusting the directory name, so
 * an orphaned `Foo.attach/` left behind by a deleted card is authored content
 * again. Only the payload filenames count: `Foo.attach/notes.md` is something
 * an agent wrote and is linted normally.
 */
export async function isConnectorOwnedMarkdown(absPath: string): Promise<boolean> {
  if (!absPath.endsWith(".md")) return false;
  const filename = path.basename(absPath);
  const attachDir = path.dirname(absPath);
  const owner = attachDirOwnerBasename(path.basename(attachDir));
  if (owner === null) return false;
  if (!connectorOwnedFilenames(owner).includes(filename)) return false;
  return exists(path.join(path.dirname(attachDir), `${owner}.gdoc.card`));
}

/**
 * Drop connector-owned files from a list headed for markdownlint.
 */
export async function filterLintableMarkdown(files: string[]): Promise<string[]> {
  const lintable: string[] = [];
  for (const file of files) {
    if (!(await isConnectorOwnedMarkdown(file))) lintable.push(file);
  }
  return lintable;
}

/**
 * What an agent is told the moment it writes to one of these files. This is
 * the delivery point that matters: a rule in a doc is read long before the
 * edit, a hook message arrives while the edit is still the current thought.
 */
export function connectorOwnedEditWarning(absPath: string): string {
  return (
    `${path.basename(absPath)} is connector-owned content, not an authored file.\n` +
    "It mirrors an upstream document, and the next sync pushes whatever is on " +
    "disk back out — replacing the upstream copy.\n" +
    "- Never edit it to satisfy a linter or a formatter. Lint does not run on " +
    "these files; a lint failure here is an engine bug to report, not a file " +
    "to repair.\n" +
    "- Invisible formatting carries structure upstream: trailing spaces are line " +
    "breaks inside nested lists, and stripping them collapses checklists into " +
    "paragraphs. Leave them alone even when making a real edit — a push that " +
    "removes them is refused.\n" +
    "- An empty `lossy:` on the card does NOT mean an edit is safe. It means " +
    "none of six specific features (comments, footnotes, images, equations, " +
    "suggestions, tables) were found — it says nothing about list structure.\n" +
    "Edit it only to change what the document says, on purpose."
  );
}
