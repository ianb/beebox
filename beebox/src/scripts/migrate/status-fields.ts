#!/usr/bin/env tsx
/**
 * Replace every remaining `status` field with the specific fact it recorded
 * (part 2 of docs/plans/standard-card-fields.md). Each card type's planner
 * below says what its old values become; a value with no safe mapping fails
 * that card, unchanged ({@link UnmappedStatusError}).
 *
 * Idempotent: a card without the old field is "already".
 *
 * Registered in src/core/migrations.ts. Also runnable directly:
 *   pnpm exec tsx src/scripts/migrate/status-fields.ts <boxRoot>           # dry-run
 *   pnpm exec tsx src/scripts/migrate/status-fields.ts <boxRoot> --apply
 */

import { runFieldEditMigration, type FieldEditPlan } from "./_field-edits.js";

type Planner = (fm: Record<string, unknown>) => FieldEditPlan;

/** Per card type: the edits that replace its `status`. */
const PLANNERS: Readonly<Record<string, Planner>> = {};

/** The edits this migration makes to one card of `type`; none for a type it doesn't handle. */
export function planStatusFields(type: string, fm: Record<string, unknown>): FieldEditPlan {
  const planner = PLANNERS[type];
  return planner === undefined ? { edits: [], warnings: [] } : planner(fm);
}

// CLI entry — only when run directly (e.g. spawned by `bbx migrate`), not when
// imported by a test.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await runFieldEditMigration({
    description: "Replace remaining status fields with specific facts (see the module comment).",
    types: new Set(Object.keys(PLANNERS)),
    plan: planStatusFields,
  });
}
