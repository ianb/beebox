/**
 * Box-aware existence checks for the two card fields that name a file WITHOUT
 * being called `ref`.
 *
 * The generic broken-ref walk in `card-lint.ts` finds frontmatter keys literally
 * named `ref`/`refs`, so these two stayed unvalidated: a landmark's
 * `navigation.symbol.src` (its icon image) and a figure's `entry` (the sketch
 * source in the card's attach scope). Both silently degraded when the target
 * moved or was renamed — a missing icon, a figure that fails to compile.
 *
 * These are targeted checks by deliberate design (see docs/plans/box-root-paths.md,
 * "NOT in scope"): a general schema-declared path-field registry is real
 * machinery for a two-entry long tail, and would also owe `cb mv` rewrite
 * coverage. A third field is the trigger to revisit.
 *
 * Both resolve through `resolveRefExists` — the same 3-form semantics, escape,
 * and symlink handling as every other ref — and report warning severity, like
 * every other broken ref (a stale path must not block a commit).
 */

import type { LintIssue } from "../cards/index.js";
import { resolveRefExists } from "./ref-exists.js";
import { isRecord } from "./card-io.js";

export interface PathFieldLintInput {
  /** Absolute path of the card being linted. */
  path: string;
  /** Its parsed frontmatter fields. */
  fields: Record<string, unknown>;
  /** Box root, for resolving box-root-absolute (`/…`) refs. */
  boxRoot: string;
}

/**
 * Warn when a landmark's `navigation.symbol.src` names a file that doesn't
 * exist (or escapes the box). A text/emoji symbol and an absent symbol are both
 * silent — there is nothing to resolve.
 */
export async function lintLandmarkSymbolSrc(input: PathFieldLintInput): Promise<LintIssue[]> {
  const navigation = input.fields["navigation"];
  if (!isRecord(navigation)) return [];
  const symbol = navigation["symbol"];
  if (!isRecord(symbol)) return [];
  const src = symbol["src"];
  if (typeof src !== "string" || src.trim() === "") return [];
  return checkPathField({ input, ref: src, field: "navigation.symbol.src" });
}

/**
 * Warn when a figure's `entry` names a source file that doesn't exist (or
 * escapes the box). `entry` is conventionally an `attach/…` ref into the card's
 * own attach scope, which the shared algebra resolves.
 */
export async function lintFigureEntry(input: PathFieldLintInput): Promise<LintIssue[]> {
  const entry = input.fields["entry"];
  if (typeof entry !== "string" || entry.trim() === "") return [];
  return checkPathField({ input, ref: entry, field: "entry" });
}

async function checkPathField(args: {
  input: PathFieldLintInput;
  ref: string;
  field: string;
}): Promise<LintIssue[]> {
  const { input, ref, field } = args;
  const exists = await resolveRefExists({ ref, fromPath: input.path, boxRoot: input.boxRoot });
  if (exists) return [];
  return [
    {
      type: "reference",
      severity: "warning",
      message: `Broken reference at ${field}: ${ref} does not exist`,
    },
  ];
}
