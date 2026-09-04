/**
 * The box-specific `bbx validate` ignore list: `_config/bbx-validate.ignore`.
 *
 * A gitignore-style file — the `.gitignore` analogue for `bbx validate` — that
 * lets the *boxholder* exclude box-specific paths from validation (a vendored
 * doc tree, imported data full of illustrative example links, etc.) beyond the
 * always-on builtin skips (`isBuiltinLintableMarkdown` in list-cards.ts already
 * covers bbx's own `docs/generated/` output). Lives under `_config/` — operator
 * territory, deliberately away from where agents routinely edit.
 *
 * Deliberately undocumented in any agent-facing surface, and `bbx validate`
 * never hints it exists: the guardrail against an agent silencing real errors
 * is that agents don't know about the escape hatch. A path-conditional
 * `.claude/rules/` rule (installed alongside the seeded file) is the only
 * agent-facing mention, and it fires only when an agent actually opens the file
 * — to warn it off, not to advertise the mechanism.
 */

import * as path from "node:path";
import { readFile } from "node:fs/promises";
import * as ignoreModule from "ignore";
import type { Ignore, Options } from "ignore";
import { errnoCode } from "../lib/error-guards.js";

// `ignore` is a legacy CJS package (no `type`/`exports` in package.json) whose
// ESM-style `.d.ts` declares a merged function+namespace default export. Under
// NodeNext the interop types don't line up — `.default` is typed as the module
// namespace — but at runtime it IS the callable factory (`module.exports`). One
// centralized cast at this package boundary, using the package's own types.
// eslint-disable-next-line no-restricted-syntax -- vendor .d.ts mistypes the CJS default export as the module namespace; verified callable at runtime, no code-level fix exists
const ignoreFactory = ignoreModule.default as unknown as (options?: Options) => Ignore;

export const VALIDATION_IGNORE_PATH = "_config/bbx-validate.ignore";

export interface ValidationIgnore {
  /**
   * True if `filePath` (box-relative or absolute) is excluded from validation
   * by the box's ignore list. Always false when no ignore file exists.
   */
  isIgnored(filePath: string): boolean;
}

const ALLOW_ALL: ValidationIgnore = { isIgnored: () => false };

/**
 * Load the box's `_config/bbx-validate.ignore` matcher. Returns an allow-all
 * matcher when the file is absent (the common case — the builtin skips already
 * cover bbx's generated docs, so most boxes never need an entry).
 */
export async function loadValidationIgnore(boxRoot: string): Promise<ValidationIgnore> {
  let text: string;
  try {
    text = await readFile(path.join(boxRoot, VALIDATION_IGNORE_PATH), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return ALLOW_ALL;
    throw e;
  }

  const matcher = ignoreFactory().add(text);
  return {
    isIgnored(filePath: string): boolean {
      const rel = path.isAbsolute(filePath) ? path.relative(boxRoot, filePath) : filePath;
      // `ignore` rejects "" and paths escaping the root; those are never
      // box-relative content, so treat them as not-ignored rather than throw.
      if (rel === "" || rel.startsWith("..")) return false;
      return matcher.ignores(rel);
    },
  };
}
