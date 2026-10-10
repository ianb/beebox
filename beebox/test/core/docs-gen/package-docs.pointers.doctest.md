# Every `box-docs/<name>.md` pointer names a doc the package ships

Plan: `docs/implemented-plans/doc-structure-box-guidance.md`, Track 2. A nested guide, a
managed skill, the agent guide (`guide.md`), and the guide ledger's `mechanics:` field
(`ledger.yaml`) send an agent to an engine doc by path,
`node_modules/beebox/box-docs/<name>.md` (written in source as
`${BOX_PACKAGE_DOCS}/<name>.md`). A pointer to a file the package does not
ship leaves the agent with nothing to read, so every such path in those
sources must be one of the engine doc filenames: the static docs, the prose
docs under `docs/box/`, and the built-in `card-<type>.md` docs.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";
import { engineDocFilenames } from "../../../src/core/docs-gen/package-docs/core.js";

const SOURCES = [
  "src/core/box/guidance-sync/skills/content.ts",
  "src/core/box/templates.ts",
];
const GUIDE_DIR = "src/core/agent-guide";

const POINTER = /(?:\$\{BOX_PACKAGE_DOCS\}|box-docs)\/([\w.-]+\.md)/g;

async function sourceFiles(): Promise<string[]> {
  const guide = (await fs.readdir(path.join(PACKAGE_ROOT, GUIDE_DIR)))
    .filter((f) => f.endsWith(".ts") || f.endsWith(".md") || f.endsWith(".yaml"))
    .map((f) => `${GUIDE_DIR}/${f}`);
  return [...SOURCES, ...guide];
}

// Every pointer as "<source>: <name>", in source order.
async function pointers(): Promise<string[]> {
  const out: string[] = [];
  for (const rel of await sourceFiles()) {
    const text = await fs.readFile(path.join(PACKAGE_ROOT, rel), "utf-8");
    for (const m of text.matchAll(POINTER)) out.push(`${rel}: ${m[1]}`);
  }
  return out;
}

// Pointers whose target is not a shipped engine doc.
async function dangling(): Promise<string[]> {
  const shipped = new Set(engineDocFilenames());
  return (await pointers()).filter((p) => !shipped.has(p.slice(p.indexOf(": ") + 2)));
}
```

## The scan finds pointers

A regex that matched nothing would pass the next check vacuously.

```ts
(await pointers()).length > 10
=> true
```

## Every pointer resolves to a shipped doc

If this lists a pointer, either the doc was renamed or removed (fix the
pointer) or the pointer has a typo.

```ts
await dangling()
=> []
```
