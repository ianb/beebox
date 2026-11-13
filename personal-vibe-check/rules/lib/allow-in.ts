/**
 * The `allowIn` option shared by `restricted-classes` and
 * `require-ui-primitive`: the files that own a shape and may use it.
 */

import type { Rule } from "eslint";
import path from "node:path";

/**
 * A test of `allowIn` globs against the file being linted. The globs are
 * relative to ESLint's working directory, which is the config's directory when
 * ESLint runs there; a rule cannot see its config's directory. From elsewhere
 * they match nothing, so a rule using this fails closed.
 */
export function fileOwner(context: Rule.RuleContext): (allowIn: readonly string[] | undefined) => boolean {
  const file = path.relative(context.cwd, context.filename).split(path.sep).join("/");
  return (allowIn) => (allowIn ?? []).some((glob) => path.matchesGlob(file, glob));
}
