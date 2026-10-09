# Agent context includes

The Codex plugin expands Claude-style `@file` lines without copying editable
context files. Callers find the root instruction file through
`instructionFilePath`: a legacy `CLAUDE.md` in a box not yet converted, an
`AGENTS.md` in a converted one.

```ts setup
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expandInstructionIncludes } from "../../../src/core/agent-context-includes.js";
import { AGENTS_MD_MIGRATION, instructionFilePath } from "../../../src/core/agent-instruction-files.js";

const root = await mkdtemp(join(tmpdir(), "bbx-agent-context-"));
await mkdir(join(root, ".beebox"), { recursive: true });
await writeFile(join(root, "CLAUDE.md"), "@.beebox/agent-guide.md\n@briefing.md\n# Editable\n");
await writeFile(join(root, ".beebox/agent-guide.md"), "# Agent guide\n");
await writeFile(join(root, "briefing.md"), "# Briefing\n");
const expand = async (boxRoot: string): Promise<string> =>
  expandInstructionIncludes({ instructionPath: join(boxRoot, await instructionFilePath(boxRoot, "")), boxRoot });
```

```ts
(await expand(root)).includes("# Agent guide")
=> true

(await expand(root)).includes("# Briefing")
=> true
```

A converted box's root `AGENTS.md` is expanded the same way:

```ts
const converted = await mkdtemp(join(tmpdir(), "bbx-agent-context-converted-"));
await mkdir(join(converted, "_config"), { recursive: true });
await writeFile(join(converted, "_config/migrations.jsonl"), `${JSON.stringify({ name: AGENTS_MD_MIGRATION, "applied-at": "2026-10-09T00:00:00Z" })}\n`);
await writeFile(join(converted, "AGENTS.md"), "@briefing.md\n");
await writeFile(join(converted, "briefing.md"), "# Converted briefing\n");
(await expand(converted)).includes("# Converted briefing")
=> true
```

Absolute and box-escaping includes fail visibly:

```ts
await writeFile(join(root, "CLAUDE.md"), "@/tmp/private.md\n@../../private.md\n");
await expand(root)
=> throws UnsafeAgentContextIncludeError: Agent context include must stay inside the box package
```
