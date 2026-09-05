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
 * These are targeted checks by deliberate design (see docs/implemented-plans/box-root-paths.md,
 * "NOT in scope"): a general schema-declared path-field registry is real
 * machinery for a two-entry long tail, and would also owe `bbx mv` rewrite
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
 * One card field that names a file WITHOUT being called `ref`/`refs` — the
 * single inventory this lint module AND the one-root migration's ref
 * rewriter (`one-root-ref-rewrite.ts`) both walk (finding 9, round 3
 * hardening: before this shared inventory, the rewriter didn't know about
 * either field, so a migrated box with a landmark symbol or figure entry
 * failed the migration's own hard link gate — the gate runs THIS module's
 * checks, unrewritten). Adding a third field here is enough to cover both
 * sides; there is no second list to remember to update.
 */
export interface PathField {
  name: string;
  getValue: (fields: Record<string, unknown>) => string | undefined;
  setValue: (fields: Record<string, unknown>, newValue: string) => void;
}

function getNavigationSymbolSrc(fields: Record<string, unknown>): string | undefined {
  const navigation = fields["navigation"];
  if (!isRecord(navigation)) return undefined;
  const symbol = navigation["symbol"];
  if (!isRecord(symbol)) return undefined;
  const src = symbol["src"];
  return typeof src === "string" ? src : undefined;
}

function setNavigationSymbolSrc(fields: Record<string, unknown>, newValue: string): void {
  const navigation = fields["navigation"];
  if (!isRecord(navigation)) return;
  const symbol = navigation["symbol"];
  if (!isRecord(symbol)) return;
  symbol["src"] = newValue;
}

export const PATH_FIELDS: readonly PathField[] = [
  {
    name: "navigation.symbol.src",
    getValue: getNavigationSymbolSrc,
    setValue: setNavigationSymbolSrc,
  },
  {
    name: "entry",
    getValue: (fields) => {
      const entry = fields["entry"];
      return typeof entry === "string" ? entry : undefined;
    },
    setValue: (fields, newValue) => {
      fields["entry"] = newValue;
    },
  },
];

/**
 * Warn when a landmark's `navigation.symbol.src` names a file that doesn't
 * exist (or escapes the box). A text/emoji symbol and an absent symbol are both
 * silent — there is nothing to resolve.
 */
export async function lintLandmarkSymbolSrc(input: PathFieldLintInput): Promise<LintIssue[]> {
  const src = getNavigationSymbolSrc(input.fields);
  if (src === undefined || src.trim() === "") return [];
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
