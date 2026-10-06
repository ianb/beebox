#!/usr/bin/env tsx
/**
 * Apply every card-field migration planner in one pass: `standard`
 * (`standard-fields-2026-09`), `status` (`status-fields-2026-09`) and `source`
 * (`source-fields-2026-09`).
 *
 * The three are registered as separate migrations, but each commit the runner
 * makes is validated by the box's pre-commit hook against the CURRENT schemas,
 * which expect every card in its final shape. Applying one planner at a time
 * left cards half-converted (an audio card with `status` gone but
 * `filename.captured` still present) and the first commit failed on every box
 * with such cards. So all three registry entries run this script: the first
 * to run converts every card completely, and the later ones find nothing to
 * do ("already") and record their manifest entry.
 *
 * Runnable directly:
 *   pnpm exec tsx src/scripts/migrate/card-fields/run.ts <boxRoot>           # dry-run
 *   pnpm exec tsx src/scripts/migrate/card-fields/run.ts <boxRoot> --apply
 */

import { runMigration } from "../_harness.js";
import { convertCardFile, type FieldEditPlan } from "../../../core/card-fields/field-edits.js";
import { typeFromFilename } from "../../../core/card-io.js";
import { STANDARD_FIELD_TYPES, planStandardFields } from "./standard.js";
import { STATUS_FIELD_TYPES, planStatusFields } from "./status.js";
import { SOURCE_FIELD_TYPES, planSourceFields } from "./source.js";

/** The union of the three planners; each reads the card as it is on disk. */
export function planCardFields(type: string, fm: Record<string, unknown>): FieldEditPlan {
  const plans = [planStandardFields(type, fm), planStatusFields(type, fm), planSourceFields(type, fm)];
  return {
    edits: plans.flatMap((plan) => plan.edits),
    warnings: plans.flatMap((plan) => plan.warnings),
  };
}

export const CARD_FIELD_TYPES: ReadonlySet<string> = new Set([
  ...STANDARD_FIELD_TYPES,
  ...STATUS_FIELD_TYPES,
  ...SOURCE_FIELD_TYPES,
]);

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await runMigration({
    description: "Standard card fields: strip dead fields, replace status, rename source (all planners in one pass).",
    match: (name) => {
      const type = typeFromFilename(name);
      return type !== undefined && CARD_FIELD_TYPES.has(type);
    },
    convert: async (file, { apply, warnings }) => {
      const result = await convertCardFile(file, { plan: planCardFields, apply });
      for (const warning of result.warnings) warnings.push(file, warning);
      return result.outcome;
    },
  });
}
