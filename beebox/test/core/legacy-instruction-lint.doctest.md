# Legacy instruction-file lint

Claude Code loads `AGENTS.md` only for a project with no `CLAUDE.md` of its
own. In a box converted to `AGENTS.md` (its manifest records
`agents-md-2026-10`), one stray `CLAUDE.md` silently drops every `AGENTS.md`,
so `bbx validate` reports each `CLAUDE.md`, `CLAUDE.local.md`, and
`.claude/CLAUDE.md` as an error. A box not yet converted still authors
`CLAUDE.md` and gets no finding. The validate hook makes the same check on one
written file (`test/cli/validate-hook/command.input.doctest.md`).

```ts setup
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { lintLegacyInstructionFiles } from "../../src/core/legacy-instruction-lint.js";
import { AGENTS_MD_MIGRATION } from "../../src/core/agent-instruction-files.js";

/** A box holding every legacy name, plus a parked copy and a vendored file the walk skips. */
async function box(converted: boolean): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bbx-legacy-instructions-"));
  const files = [
    "CLAUDE.md",
    "_content/people/CLAUDE.md",
    "_content/CLAUDE.local.md",
    ".claude/CLAUDE.md",
    "_content/people/AGENTS.md",
    "_config/_template-updates/src/schemas/CLAUDE.md",
    "node_modules/pkg/CLAUDE.md",
  ];
  for (const rel of files) {
    await mkdir(join(root, rel, ".."), { recursive: true });
    await writeFile(join(root, rel), "# Notes\n");
  }
  if (converted) {
    await writeFile(join(root, "_config/migrations.jsonl"), `${JSON.stringify({ name: AGENTS_MD_MIGRATION, "applied-at": "2026-10-09T00:00:00Z" })}\n`);
  }
  return root;
}
```

A converted box reports each legacy file, one line each:

```ts
await lintLegacyInstructionFiles(await box(true))
=> [
  ".claude/CLAUDE.md: Name instruction files AGENTS.md. A CLAUDE.md here makes Claude Code ignore every AGENTS.md.",
  "CLAUDE.md: Name instruction files AGENTS.md. A CLAUDE.md here makes Claude Code ignore every AGENTS.md.",
  "_content/CLAUDE.local.md: Name instruction files AGENTS.md. A CLAUDE.md here makes Claude Code ignore every AGENTS.md.",
  "_content/people/CLAUDE.md: Name instruction files AGENTS.md. A CLAUDE.md here makes Claude Code ignore every AGENTS.md.",
]
```

An unconverted box reports nothing:

```ts
await lintLegacyInstructionFiles(await box(false))
=> []
```
