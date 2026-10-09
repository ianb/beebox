# Instruction-file name resolver

Boxes move from authored `CLAUDE.md` files to authored `AGENTS.md` through the
`agents-md-2026-10` migration. The engine updates before a box's migration
runs, so every writer asks `instructionFilePath(boxRoot, dirRel)` which file to
write. An existing file keeps its name, so an unconverted box behaves as it did
and a half-converted one keeps each directory's own file. Only a missing file
takes the box-level name. Plan: `docs/plans/box-agents-md.md`, Track A.

```ts setup
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AGENTS_MD_MIGRATION,
  instructionFileName,
  instructionFilePath,
  instructionSiblingPath,
  isAgentInstructionsFile,
} from "../../src/core/agent-instruction-files.js";

/** A temp box; `converted` records the AGENTS.md migration in its manifest. */
async function box(converted: boolean): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bbx-instruction-files-"));
  await mkdir(join(root, "_config"), { recursive: true });
  await mkdir(join(root, "dir"), { recursive: true });
  const entries = [{ name: "briefing-openers-2026-10", "applied-at": "2026-10-01T00:00:00Z" }];
  if (converted) entries.push({ name: AGENTS_MD_MIGRATION, "applied-at": "2026-10-09T00:00:00Z" });
  await writeFile(join(root, "_config/migrations.jsonl"), entries.map((e) => `${JSON.stringify(e)}\n`).join(""));
  return root;
}
```

## A missing file takes the box's name

With neither file in the directory, an unconverted box gets `CLAUDE.md` and a
converted one `AGENTS.md`. `dirRel` `""` is the box root.

```ts
const legacy = await box(false);
const converted = await box(true);
({
  unconvertedRoot: await instructionFilePath(legacy, ""),
  unconvertedDir: await instructionFilePath(legacy, "dir"),
  convertedRoot: await instructionFilePath(converted, ""),
  convertedDir: await instructionFilePath(converted, "dir"),
  unconvertedName: await instructionFileName(legacy),
  convertedName: await instructionFileName(converted),
})
=> {
  unconvertedRoot: "CLAUDE.md",
  unconvertedDir: "dir/CLAUDE.md",
  convertedRoot: "AGENTS.md",
  convertedDir: "dir/AGENTS.md",
  unconvertedName: "CLAUDE.md",
  convertedName: "AGENTS.md",
}
```

A box with no manifest at all is unconverted:

```ts
const bare = await mkdtemp(join(tmpdir(), "bbx-instruction-files-bare-"));
await instructionFilePath(bare, "")
=> CLAUDE.md
```

## An existing file keeps its name

A legacy `CLAUDE.md` wins in a converted box too: the writer edits it instead
of creating an `AGENTS.md` beside it that Claude Code would ignore.

```ts
const root = await box(true);
await writeFile(join(root, "dir/CLAUDE.md"), "# Legacy\n");
await instructionFilePath(root, "dir")
=> dir/CLAUDE.md
```

A real `AGENTS.md` wins in an unconverted box (the boxholder or a partly-run
migration already made one):

```ts
const root = await box(false);
await writeFile(join(root, "dir/AGENTS.md"), "# New\n");
await instructionFilePath(root, "dir")
=> dir/AGENTS.md
```

An `AGENTS.md` symlink beside a `CLAUDE.md` is the old Codex mirror, not an
authored file. The `CLAUDE.md` is the file to write:

```ts
const root = await box(true);
await writeFile(join(root, "dir/CLAUDE.md"), "# Legacy\n");
await symlink("CLAUDE.md", join(root, "dir/AGENTS.md"));
await instructionFilePath(root, "dir")
=> dir/CLAUDE.md
```

A dangling mirror symlink with no `CLAUDE.md` counts as no file, so an
unconverted box gets `CLAUDE.md` again (and the symlink resolves):

```ts
const root = await box(false);
await symlink("CLAUDE.md", join(root, "dir/AGENTS.md"));
await instructionFilePath(root, "dir")
=> dir/CLAUDE.md
```

Two real files in one directory is a conflict the migration reports. Until a
person resolves it, writers keep using the `CLAUDE.md`, which is the file
Claude Code loads:

```ts
const root = await box(true);
await writeFile(join(root, "dir/CLAUDE.md"), "# Legacy\n");
await writeFile(join(root, "dir/AGENTS.md"), "# New\n");
await instructionFilePath(root, "dir")
=> dir/CLAUDE.md
```

## Sibling paths and recognition

`instructionSiblingPath` gives the other spelling of an instruction-file path,
which the template ledger uses as one key; other paths have none.

```ts
({
  nested: instructionSiblingPath("src/schemas/CLAUDE.md"),
  back: instructionSiblingPath("src/schemas/AGENTS.md"),
  root: instructionSiblingPath("CLAUDE.md"),
  local: instructionSiblingPath("CLAUDE.local.md"),
  other: instructionSiblingPath("src/schemas/README.md"),
})
=> { nested: "src/schemas/AGENTS.md", back: "src/schemas/CLAUDE.md", root: "AGENTS.md", local: null, other: null }
```

`isAgentInstructionsFile` recognizes every instruction-file name, including
Claude Code's personal `CLAUDE.local.md`:

```ts
["a/CLAUDE.md", "a/AGENTS.md", "a/CLAUDE.local.md", "a/README.md"].map(isAgentInstructionsFile)
=> [true, true, true, false]
```
