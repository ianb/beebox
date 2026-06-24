# compile-exposition-rules

`compileExpositionRules` turns each exposition-plan card's `rules` into a
path-loaded box rule under `.claude/rules/exposition-<course>.md` — a derived
artifact (source of truth is the card's `rules` field), clean-and-rewritten.

```ts setup
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { compileExpositionRules } from "../../src/core/compile-exposition-rules.js";
import { readFile } from "node:fs/promises";
```

A card with `rules` produces a rule path-scoped to its course directory:

```ts
const box = await makeTmpBox();
await box.write(
  "store/courses/Acids.attach/Acids.exposition-plan.card",
  "---\nrules:\n  - Open from a phenomenon\n  - Use dialog before defining\n---\nbody\n",
);
const written = await compileExpositionRules(box.root);
written
=> [
  "exposition-store-courses-acids-attach.md"
]
```

The rule globs the course dir and inlines the rules, with a do-not-edit header:

```ts continue
const text = await readFile(box.path(".claude/rules/exposition-store-courses-acids-attach.md"), "utf8");
text.includes("paths:") && text.includes('"store/courses/Acids.attach/**"')
=> true

text.includes("- Open from a phenomenon") && text.includes("GENERATED")
=> true
```

An exposition-plan with no `rules` produces no rule file:

```ts
const box = await makeTmpBox();
await box.write(
  "store/courses/Empty.attach/Empty.exposition-plan.card",
  "---\nlearner-translation:\n  - reasons aloud\n---\nbody\n",
);
const written = await compileExpositionRules(box.root);
written.length
=> 0
```
