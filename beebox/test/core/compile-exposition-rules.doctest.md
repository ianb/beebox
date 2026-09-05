# compile-exposition-rules

`compileExpositionRules` turns each exposition-plan card's `rules` into a
path-loaded box rule under `.claude/rules/exposition-<course>.md` — a derived
artifact (source of truth is the card's `rules` field), clean-and-rewritten.

```ts setup
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { compileExpositionRules } from "../../src/core/compile-exposition-rules.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
```

## A card with `rules` produces a rule path-scoped to its course directory

shapeVersion 3 (the one-root layout): `.claude/rules` and course directories
share the same `boxRoot`, so the generated `paths:` glob is just the course
directory relative to `boxRoot` — no cross-root prefix needed.

```ts
const box = await makeTmpBox();
await box.write(
  "_content/courses/Acids.attach/Acids.exposition-plan.card",
  "---\nrules:\n  - Open from a phenomenon\n---\nbody\n",
);
const written = await compileExpositionRules(box.root);
written
=> [
  "exposition-content-courses-acids-attach.md"
]
```

```ts continue
const text = await readFile(join(box.root, ".claude/rules/exposition-content-courses-acids-attach.md"), "utf8");
text.includes('"_content/courses/Acids.attach/**"')
=> true
```

```ts cleanup
await box.cleanup();
```

An exposition-plan with no `rules` produces no rule file:

```ts
const box = await makeTmpBox();
await box.write(
  "_content/courses/Empty.attach/Empty.exposition-plan.card",
  "---\nlearner-translation:\n  - reasons aloud\n---\nbody\n",
);
const written = await compileExpositionRules(box.root);
written.length
=> 0
```
