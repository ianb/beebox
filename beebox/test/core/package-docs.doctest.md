# Package docs: beebox's reference docs live in the package, not the box

`engineDocs()` (`src/core/docs-gen/package-docs.ts`) computes every reference
doc about the engine itself — the static reference docs, one `card-<type>.md`
per built-in schema with `instructions`, and a `README.md` index — from the
running source alone. `ensurePackageDocs()` writes them into
`<packageRoot>/box-docs/` when the content fingerprint on disk differs, so a
box never carries a copy and the docs can never lag the engine that reads them.
Design: `docs/plans/box-docs-in-package.md`.

```ts setup
import { mkdtemp, mkdir, readFile, readdir, chmod, rm, writeFile } from "node:fs/promises";
import { writeBoxCardDocs } from "../../src/core/docs-gen/box-docs.js";
import { cardSchema } from "../../src/cards/index.js";
import { z } from "zod";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { engineDocs, ensurePackageDocs, engineDocFilenames } from "../../src/core/docs-gen/package-docs.js";
import { BOX_PACKAGE_DOCS } from "../../src/core/docs-gen/shared.js";
import { cardSchemas } from "../../src/schemas/registry.js";

const docs = engineDocs();
const byName = new Map(docs.map((d) => [d.filename, d.content]));
```

## Every built-in schema with instructions has a doc, and the index lists every doc

```ts
const withInstructions = cardSchemas.filter((s) => s.instructions !== undefined);
withInstructions.every((s) => byName.has(`card-${s.type}.md`))
=> true

// The static reference docs are all present
["bbx-commands.md", "connectors.md", "views.md", "procedures.md", "triage.md", "chat-voice.md", "narration-mode.md", "reducing-claude-md.md", "python-tools.md"].every((f) => byName.has(f))
=> true

const index = byName.get("README.md") ?? "";
// One index row per doc (every doc but the index itself)
docs.filter((d) => d.filename !== "README.md").every((d) => index.includes(`| \`${d.filename}\` |`))
=> true

// The index tells the agent where it is from a box
index.includes(BOX_PACKAGE_DOCS)
=> true

// Package docs never carry a per-box DOCID marker
docs.some((d) => d.content.includes("DOCID:"))
=> false

// Prose docs from docs/box/ ship with their frontmatter stripped and their read-when in the index
const prose = byName.get("what-you-could-do.md") ?? "";
prose.startsWith("# What you could do with your box")
=> true

index.includes("| `what-you-could-do.md` | The user asks what the box can do")
=> true
```

## A card doc uses only built-in templates and carries the contains: appendix for searchable types

```ts
const memo = byName.get("card-memo.md") ?? "";
memo.startsWith("# memo Card")
=> true

const searchable = cardSchemas.find((s) => s.searchable && s.instructions !== undefined);
(byName.get(`card-${searchable?.type}.md`) ?? "").includes("## The `contains:` field")
=> true
```

## ensurePackageDocs writes once, then reports current; a changed fingerprint rewrites

```ts
const packageRoot = await mkdtemp(join(tmpdir(), "bbx-pkgdocs-"));
const first = await ensurePackageDocs({ packageRoot });
first.status
=> written

const second = await ensurePackageDocs({ packageRoot });
second.status
=> current

// Every doc landed, plus the fingerprint file; no temp sibling was left behind
const files = (await readdir(join(packageRoot, "box-docs"))).sort();
files.includes("README.md") && files.includes(".hash") && files.includes("card-memo.md")
=> true

(await readdir(packageRoot)).join(",")
=> box-docs

// The filenames the box pruner uses are exactly what the package holds
JSON.stringify(engineDocFilenames().sort()) === JSON.stringify(files.filter((f) => f !== ".hash").sort())
=> true

await rm(packageRoot, { recursive: true, force: true });
```

## An unwritable package root is reported, not thrown

```ts
const readOnlyRoot = await mkdtemp(join(tmpdir(), "bbx-pkgdocs-ro-"));
await chmod(readOnlyRoot, 0o500);
const blocked = await ensurePackageDocs({ packageRoot: readOnlyRoot });
blocked.status
=> unwritable

blocked.status === "unwritable" && blocked.dir.endsWith("/box-docs")
=> true

await chmod(readOnlyRoot, 0o700);
await rm(readOnlyRoot, { recursive: true, force: true });
```

## Concurrent ensures in one process share a single write

```ts
const sharedRoot = await mkdtemp(join(tmpdir(), "bbx-pkgdocs-race-"));
const results = await Promise.all([
  ensurePackageDocs({ packageRoot: sharedRoot }),
  ensurePackageDocs({ packageRoot: sharedRoot }),
  ensurePackageDocs({ packageRoot: sharedRoot }),
]);
results.map((r) => r.status).join(",")
=> written,written,written

// One live directory, no temp or old siblings left behind
(await readdir(sharedRoot)).join(",")
=> box-docs

await rm(sharedRoot, { recursive: true, force: true });
```

## The box writer prunes old engine docs first, so a shadowing box-local doc survives

An older engine wrote every engine doc into the box's `_content/docs/generated/`.
`writeBoxCardDocs` removes those (they live in the package now) and then writes
the box-local card docs — in that order, so a box-local schema that shadows a
built-in type (`memo` here) keeps its doc where the agent guide points.

```ts
const boxRoot = await mkdtemp(join(tmpdir(), "bbx-boxdocs-"));
const docsDir = join(boxRoot, "_content/docs/generated");
await mkdir(docsDir, { recursive: true });
await writeFile(join(docsDir, "bbx-commands.md"), "old engine doc");
await writeFile(join(docsDir, "card-memo.md"), "old built-in memo doc");
await writeFile(join(docsDir, "intake-guide.md"), "compiled from this box");

const boxMemo = cardSchema("memo", {
  description: "this box's memo",
  category: "authored",
  fields: { status: z.string() },
  instructions: "How THIS box memos.",
});
await writeBoxCardDocs({ boxRoot, debug: false, boxCardSchemas: [boxMemo], boxTemplates: [] });

(await readdir(docsDir)).sort().join(",")
=> card-memo.md,intake-guide.md

(await readFile(join(docsDir, "card-memo.md"), "utf-8")).includes("How THIS box memos.")
=> true

await rm(boxRoot, { recursive: true, force: true });
```
