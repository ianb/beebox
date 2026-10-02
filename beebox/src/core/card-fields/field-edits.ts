/**
 * Editing a few frontmatter keys by path, for the shipped card-field
 * migrations (`src/scripts/migrate/card-fields/`) and `bbx migrate-fields`:
 * the edit type, a document-model applier that leaves untouched keys
 * byte-for-byte, the refusal errors, and the per-card conversion.
 */

import { readFile, writeFile } from "node:fs/promises";
import { isMap, isScalar, parse as parseYaml, parseDocument, type Document } from "yaml";
import { splitCardContent } from "../../cards/frontmatter.js";
import { typeFromFilename } from "../card-io.js";
import { isRecord } from "../../shared/is-record.js";

/**
 * One change to a card's frontmatter, addressed by key path. A `set` of a new
 * key lands at the end of its map, or right after the sibling key `after`
 * names when that key is there.
 */
export type FieldEdit =
  | { op: "delete"; path: ReadonlyArray<string | number> }
  | { op: "set"; path: ReadonlyArray<string | number>; value: unknown; after?: string };

/** The edits for one card, plus warnings for content they drop. */
export interface FieldEditPlan {
  edits: FieldEdit[];
  warnings: string[];
}

/**
 * A value a migration has no safe mapping for; the card is left unchanged
 * for a person to decide.
 */
export class UnmappedStatusError extends Error {
  readonly type: string;
  readonly status: unknown;
  constructor({ type, status }: { type: string; status: unknown }) {
    super(`${type} status ${JSON.stringify(status)} has no safe mapping; migrate this card by hand`);
    this.name = "UnmappedStatusError";
    this.type = type;
    this.status = status;
  }
}

/** What is wrong with a card's fields, for {@link UnmappedFieldError}. */
type FieldProblem = "old-and-new" | "not-a-map" | "not-a-list" | "incomplete" | "two-pointers";

const FIELD_PROBLEM_TEXT: Readonly<Record<FieldProblem, string>> = {
  "old-and-new": "has both the old and the new keys",
  "not-a-map": "is not a map",
  "not-a-list": "is not a list",
  incomplete: "is missing a key the new shape requires",
  "two-pointers": "has both `ref` and `href`, and the new shape takes one",
};

/**
 * A field whose shape a migration cannot convert safely (for example, it
 * already has both the old and the new keys); the card is left unchanged for
 * a person to decide.
 */
export class UnmappedFieldError extends Error {
  readonly type: string;
  readonly field: string;
  readonly problem: FieldProblem;
  constructor({ type, field, problem }: { type: string; field: string; problem: FieldProblem }) {
    super(`${type} ${field} ${FIELD_PROBLEM_TEXT[problem]}; migrate this card by hand`);
    this.name = "UnmappedFieldError";
    this.type = type;
    this.field = field;
    this.problem = problem;
  }
}

/**
 * Insert a new key right after its `after` sibling. Returns false (nothing
 * done) when the parent is not a map, the key already exists, or the sibling
 * is absent; the caller then falls back to a plain `setIn`.
 */
function insertAfter(doc: Document, edit: { path: ReadonlyArray<string | number>; value: unknown; after: string }): boolean {
  const key = edit.path.at(-1);
  const parentPath = edit.path.slice(0, -1);
  const parent = parentPath.length === 0 ? doc.contents : doc.getIn(parentPath, true);
  if (key === undefined || !isMap(parent) || parent.has(key)) return false;
  const index = parent.items.findIndex((pair) => isScalar(pair.key) && pair.key.value === edit.after);
  if (index === -1) return false;
  parent.items.splice(index + 1, 0, doc.createPair(key, edit.value));
  return true;
}

/**
 * Apply edits to the frontmatter's YAML text through the `yaml` document
 * model, so every untouched key keeps its exact formatting (line wrapping,
 * quoting, comments). yaml does not keep a long plain value's original line
 * breaks; it re-folds at its default width. That reproduces a card written
 * by a default `stringify` (folded at 80 columns), but would fold every long
 * value of a card written unwrapped (`renderFrontmatterBlock`, agents). So a
 * frontmatter that yaml's defaults do not reproduce unchanged is written back
 * unwrapped (`lineWidth: 0`).
 */
export function applyFieldEdits(frontmatterText: string, edits: readonly FieldEdit[]): string {
  const doc = parseDocument(frontmatterText);
  // Every edit addresses a map key, never an array element, so applying one
  // cannot shift another's path.
  for (const edit of edits) {
    if (edit.op === "delete") doc.deleteIn(edit.path);
    else if (edit.after === undefined || !insertAfter(doc, { path: edit.path, value: edit.value, after: edit.after })) {
      doc.setIn(edit.path, edit.value);
    }
  }
  const foldedByDefault = parseDocument(frontmatterText).toString().trimEnd() === frontmatterText.trimEnd();
  return doc.toString(foldedByDefault ? {} : { lineWidth: 0 });
}

/** A per-type planner: the edits for one card's parsed frontmatter. */
export type FieldPlanner = (type: string, fm: Record<string, unknown>) => FieldEditPlan;

export type ConvertOutcome = "converted" | "already";

/**
 * Plan and (with `apply`) rewrite one card file. "already" when the card has
 * no frontmatter, no type, or nothing to change. A planner that throws
 * propagates: the caller decides how to report a refused card.
 */
export async function convertCardFile(file: string, { plan, apply }: { plan: FieldPlanner; apply: boolean }): Promise<{ outcome: ConvertOutcome; warnings: string[] }> {
  const type = typeFromFilename(file);
  const split = splitCardContent(await readFile(file, "utf8"));
  if (type === undefined || !split.hasFrontmatter) return { outcome: "already", warnings: [] };
  const parsed: unknown = parseYaml(split.frontmatterText);
  if (!isRecord(parsed)) return { outcome: "already", warnings: [] };
  const planned = plan(type, parsed);
  if (planned.edits.length === 0) return { outcome: "already", warnings: planned.warnings };
  if (apply) await writeFile(file, `---\n${applyFieldEdits(split.frontmatterText, planned.edits)}---\n${split.body}`);
  return { outcome: "converted", warnings: planned.warnings };
}
