/**
 * Pre-commit guard for the testing cutover: a commit may not add a
 * `.doctest.md` file (plan beebox/docs/plans/retire-doctest.md, track 1b).
 * Renames and edits pass, so in-place edits and layout moves still work. A
 * copy counts as an addition. Track 6 removes this guard with the doctest
 * tooling.
 *
 *   node --import tsx bin/no-new-doctests.ts
 */

import { git } from "./test-git.js";

/** The `.doctest.md` paths that `git diff --cached --name-status -M` lists as added or copied. */
export function addedDoctests(nameStatus: string): string[] {
  const added: string[] = [];
  for (const line of nameStatus.split("\n")) {
    const [status = "", ...paths] = line.split("\t");
    const path = paths.at(-1);
    if ((status === "A" || status.startsWith("C")) && path?.endsWith(".doctest.md") === true) added.push(path);
  }
  return added;
}

export const CUTOVER_MESSAGE = `Testing cutover (since 2026-10-18): new tests are .test.ts files that use t.check
(beebox/docs/testing/check.md). Do not add .doctest.md files. To keep an existing
doctest's content, convert it: node agent-doctest/bin/doctest-to-ts.mjs <file>`;

if (import.meta.main) {
  const added = addedDoctests(git(["diff", "--cached", "--name-status", "-M"]));
  if (added.length > 0) {
    console.error(`[no-new-doctests] this commit adds doctests:\n${added.map((p) => `  ${p}`).join("\n")}\n\n${CUTOVER_MESSAGE}`);
    process.exitCode = 1;
  }
}
