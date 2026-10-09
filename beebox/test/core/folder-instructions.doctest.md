# Folder instruction notes

`folderInstructionNotes(boxRoot, cardPath)` names the instruction files that
apply to a new card: those in its directory and the ancestors below the box
root, nearest first. The root file is always loaded, so it is not listed.
Files holding only `@` includes (a map-only stub) are skipped.

```ts setup
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { folderInstructionNotes } from "../../src/core/folder-instructions.js";

const box = await makeTmpBox({ git: "none" });
async function put(rel: string, content: string) {
  await mkdir(join(box.root, rel, ".."), { recursive: true });
  await writeFile(join(box.root, rel), content);
}
```

## No files

```ts
await folderInstructionNotes(box.root, "_content/people/Priya_Marlowe.person.card")
=> []
```

## Root file is not listed

```ts continue
await put("AGENTS.md", "Root rules.\n");
await folderInstructionNotes(box.root, "_content/people/Priya_Marlowe.person.card")
=> []
```

## Nested file with real content

```ts continue
await put("_content/people/AGENTS.md", "# People\nUse full names.\n");
await folderInstructionNotes(box.root, "_content/people/Priya_Marlowe.person.card")
=> ["Folder instructions: _content/people/AGENTS.md. Read it before filling in this card."]
```

## Map-only stub is skipped

```ts continue
await put("_content/AGENTS.md", "\n@MAP.md\n\n");
await folderInstructionNotes(box.root, "_content/people/Priya_Marlowe.person.card")
=> ["Folder instructions: _content/people/AGENTS.md. Read it before filling in this card."]
```

## Both names, and two levels

An unconverted box uses `CLAUDE.md`. Instructions at both levels list nearest
first, and an absolute card path works.

```ts continue
await put("_content/people/CLAUDE.md", "Legacy people rules.\n");
await put("_content/AGENTS.md", "@MAP.md\nContent rules.\n");
await folderInstructionNotes(box.root, join(box.root, "_content/people/Priya_Marlowe.person.card"))
=> [
  "Folder instructions: _content/people/CLAUDE.md. Read it before filling in this card.",
  "Folder instructions: _content/people/AGENTS.md. Read it before filling in this card.",
  "Folder instructions: _content/AGENTS.md. Read it before filling in this card.",
]
```
