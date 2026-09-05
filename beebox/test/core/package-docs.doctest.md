# Package docs: beebox's reference docs live in the package, not the box

`engineDocs()` (`src/core/docs-gen/package-docs.ts`) computes every reference
doc about the engine itself — the static reference docs, one `card-<type>.md`
per built-in schema with `instructions`, and a `README.md` index — from the
running source alone. `ensurePackageDocs()` writes them into
`<packageRoot>/box-docs/` when the content fingerprint on disk differs, so a
box never carries a copy and the docs can never lag the engine that reads them.
Design: `docs/plans/box-docs-in-package.md`.

```ts setup
import { mkdtemp, readFile, readdir, chmod, rm } from "node:fs/promises";
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
