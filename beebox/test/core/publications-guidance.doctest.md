# Publication guidance is installed lazily and notes are preserved

The nested guide points agents to the installed reference. Shared notes are
created for a fresh box, then survive later initialization unchanged.

```ts setup
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { installPublicationsGuidance } from "../../src/core/box/templates.js";
import { initBox } from "../../src/core/box/index.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

## Install creates the lazy pointer and the shared note template

```ts
const box = await makeTmpBox();
await installPublicationsGuidance(box.root);
const guide = await readFile(path.join(box.root, "src/publications/CLAUDE.md"), "utf-8");
const notes = await readFile(path.join(box.root, "src/publications/NOTES.md"), "utf-8");

guide.includes("node_modules/beebox/box-docs/publishing.md")
=> true

notes.includes("## All sites") && notes.includes("## Site: <name>") && notes.includes("## Path: <site>/<relative-path>")
=> true

await box.cleanup();
```

## Re-running initialization preserves authored notes

```ts
const box = await makeTmpBox();
await initBox(box.root, { skipGit: true });
const notesPath = path.join(box.root, "src/publications/NOTES.md");
await writeFile(notesPath, "# Notes I wrote\n\nKeep this exactly.\n");
await initBox(box.root, { skipGit: true });

(await readFile(notesPath, "utf-8")) === "# Notes I wrote\n\nKeep this exactly.\n"
=> true

await box.cleanup();
```
