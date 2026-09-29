/**
 * Shared pieces for migrations that edit a few frontmatter keys by path
 * (`standard-fields.ts`, `status-fields.ts`): the edit type, a document-model
 * applier that leaves untouched keys byte-for-byte, the refusal error, and a
 * CLI runner over a per-type planner.
 */

import { readFile, writeFile } from "node:fs/promises";
import { parse as parseYaml, parseDocument } from "yaml";
import { runMigration } from "./_harness.js";
import { splitCardContent } from "../../cards/frontmatter.js";
import { typeFromFilename } from "../../core/card-io.js";
import { isRecord } from "../../shared/is-record.js";

/** One change to a card's frontmatter, addressed by key path. */
export type FieldEdit =
  | { op: "delete"; path: ReadonlyArray<string | number> }
  | { op: "set"; path: ReadonlyArray<string | number>; value: unknown };

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

/**
 * Apply edits to the frontmatter's YAML text through the `yaml` document
 * model, so every untouched key keeps its exact formatting (line wrapping,
 * quoting, comments).
 */
export function applyFieldEdits(frontmatterText: string, edits: readonly FieldEdit[]): string {
  const doc = parseDocument(frontmatterText);
  // Every edit addresses a map key, never an array element, so applying one
  // cannot shift another's path.
  for (const edit of edits) {
    if (edit.op === "delete") doc.deleteIn(edit.path);
    else doc.setIn(edit.path, edit.value);
  }
  return doc.toString();
}

/**
 * Run a field-edit migration from the command line: every card whose type
 * `plan` handles is planned, and changed cards are rewritten through
 * {@link applyFieldEdits}. A planner that throws fails that card only.
 */
export async function runFieldEditMigration({ description, types, plan }: {
  description: string;
  types: ReadonlySet<string>;
  plan: (type: string, fm: Record<string, unknown>) => FieldEditPlan;
}): Promise<void> {
  await runMigration({
    description,
    match: (name) => {
      const type = typeFromFilename(name);
      return type !== undefined && types.has(type);
    },
    convert: async (file, { apply, warnings }) => {
      const type = typeFromFilename(file);
      const split = splitCardContent(await readFile(file, "utf8"));
      if (type === undefined || !split.hasFrontmatter) return "already";
      const parsed: unknown = parseYaml(split.frontmatterText);
      if (!isRecord(parsed)) return "already";
      const planned = plan(type, parsed);
      for (const warning of planned.warnings) warnings.push(file, warning);
      if (planned.edits.length === 0) return "already";
      if (apply) await writeFile(file, `---\n${applyFieldEdits(split.frontmatterText, planned.edits)}---\n${split.body}`);
      return "converted";
    },
  });
}
