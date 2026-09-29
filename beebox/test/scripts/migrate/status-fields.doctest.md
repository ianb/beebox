# Migration: replace remaining `status` fields

`src/scripts/migrate/status-fields.ts` replaces each card type's `status`
with the specific fact it recorded (part 2 of
`docs/plans/standard-card-fields.md`). `planStatusFields(type, fm)` lists the
edits for one card; `applyFieldEdits` applies them to the YAML text.

```ts setup
import { parse, stringify } from "yaml";
import { planStatusFields } from "../../../src/scripts/migrate/status-fields.js";
import { applyFieldEdits } from "../../../src/scripts/migrate/_field-edits.js";

// Plan the edits for a card, apply them to its YAML, and report the result.
function run(type: string, fm: Record<string, unknown>): string {
  const plan = planStatusFields(type, fm);
  const migrated: unknown = parse(applyFieldEdits(stringify(fm), plan.edits));
  return JSON.stringify({ changed: plan.edits.length > 0, warnings: plan.warnings, fm: migrated });
}

function refusal(type: string, fm: Record<string, unknown>): string {
  try {
    planStatusFields(type, fm);
    return "no error";
  } catch (e) {
    return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
}
```

## A type the migration doesn't handle is unchanged

```ts
run("doc", { title: "Notes", status: "whatever" })
=> {"changed":false,"warnings":[],"fm":{"title":"Notes","status":"whatever"}}

refusal("doc", { status: "x" })
=> no error
```
