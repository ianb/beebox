# health: legacy exposition-plan rules

An exposition-plan's rules used to live in the card's `rules` field and were
compiled into `.claude/rules/exposition-*.md`. They now go into the course
directory's AGENTS.md (courseware README, Migration). The field stays on the
schema so old cards validate; `legacy-exposition-rules` names each card still
carrying one, and is quiet when the move is done. Core owns the check so it
fires in a box where the plugin is inactive.

```ts setup
import { legacyExpositionRulesChecks } from "../../../../../../../src/webapp/trpc/routers/health/checks/plugins/legacy-exposition-rules.js";
import { makeTmpBox } from "../../../../../../helpers/doctest-helpers.js";
```

## Cards with a non-empty `rules` array, one warning each

An empty `rules`, a missing one, a non-array value and malformed frontmatter
are not legacy rules; `bbx validate` reports the malformed card.

```ts
const box = await makeTmpBox();
await box.write("content/Acids.attach/plan.exposition-plan.card", "---\nrules:\n  - Start from a kitchen example\n  - Name the pH scale only after the first contrast\n---\nPlan.\n");
await box.write("content/Bases.attach/plan.exposition-plan.card", "---\nrules: []\n---\nPlan.\n");
await box.write("content/Salts.attach/plan.exposition-plan.card", "---\nlearner: Alex\n---\nPlan.\n");
await box.write("content/Water.attach/plan.exposition-plan.card", "---\nrules: not a list\n---\nPlan.\n");
await box.write("content/Broken.attach/plan.exposition-plan.card", "---\nrules: [\n---\nPlan.\n");
await box.write("content/Notes.note.card", "---\nrules:\n  - irrelevant type\n---\n");
const checks = await legacyExpositionRulesChecks(box.root);
checks.map(({ name, ok, severity, message }) => ({ name, ok, severity, message }))
=> [{
  name: "legacy-exposition-rules",
  ok: false,
  severity: "warning",
  message: "content/Acids.attach/plan.exposition-plan.card: `rules` is legacy; move them into the course directory's AGENTS.md (courseware README, Migration).",
}]
```

```ts cleanup
await box.cleanup();
```

## Quiet when nothing carries one

```ts
const clean = await makeTmpBox();
await legacyExpositionRulesChecks(clean.root)
=> [{ name: "legacy-exposition-rules", ok: true, severity: "warning", message: "No exposition-plan card carries a legacy `rules` field" }]
```

```ts cleanup
await clean.cleanup();
```
