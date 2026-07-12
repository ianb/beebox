# compile-exposition-rules

`compileExpositionRules` turns each exposition-plan card's `rules` into a
path-loaded box rule under `.claude/rules/exposition-<course>.md` — a derived
artifact (source of truth is the card's `rules` field), clean-and-rewritten.

```ts setup
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { compileExpositionRules } from "../../src/core/compile-exposition-rules.js";
import { readFile, writeFile, mkdir, mkdtemp, rm, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * A v2 (package-layout) box fixture: `<root>/package.json` declares a
 * `callback-box` dependency (all `getBoxShape` needs — this module never
 * imports through `node_modules`, so there's no need for the symlink trick
 * other v2 doctests use), and `<root>/content/.cb-box` marks the
 * operational root, one level below the package root.
 */
async function makeV2TmpBox() {
  const root = await mkdtemp(join(tmpdir(), "cb-doctest-v2-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "my-box", private: true, dependencies: { "callback-box": "0.1.0" } }),
  );
  const boxRoot = join(root, "content");
  await mkdir(boxRoot, { recursive: true });
  await writeFile(join(boxRoot, ".cb-box"), JSON.stringify({ shapeVersion: 2 }));
  return {
    root,
    boxRoot,
    async write(relativePath, content) {
      const fullPath = join(boxRoot, relativePath);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content);
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
}
```

## A card with `rules` produces a rule path-scoped to its course directory

`.claude/rules` lives at the package root, one level above a v2 box's
operational root — and the generated glob is anchored (not `**/`-prefixed),
so it needs the same `content/` prefix or it never matches a real course
file:

```ts
const v2box = await makeV2TmpBox();
await v2box.write(
  "store/courses/Acids.attach/Acids.exposition-plan.card",
  "---\nrules:\n  - Open from a phenomenon\n---\nbody\n",
);
const written = await compileExpositionRules(v2box.boxRoot);
written
=> [
  "exposition-store-courses-acids-attach.md"
]
```

```ts continue
const text = await readFile(join(v2box.root, ".claude/rules/exposition-store-courses-acids-attach.md"), "utf8");
text.includes('"content/store/courses/Acids.attach/**"')
=> true
```

The rule is NOT written under the operational root's own (nonexistent)
`.claude/` — only the package root's:

```ts continue
await exists(join(v2box.boxRoot, ".claude/rules/exposition-store-courses-acids-attach.md"))
=> false
```

```ts cleanup
await v2box.cleanup();
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
