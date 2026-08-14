# Agent context mirrors

Claude-authored context stays canonical and editable. Codex aliases it with
relative symlinks, while Claude-only rules become generated Codex skills.

```ts setup
import { mkdtemp, mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateAgentContextMirrors } from "../../src/core/agent-context-mirrors.js";

const root = await mkdtemp(join(tmpdir(), "cb-context-"));
const boxRoot = join(root, "content");
await mkdir(boxRoot);
await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { "callback-box": "*" } }));
await writeFile(join(boxRoot, ".cb-box"), JSON.stringify({ shapeVersion: 2 }));
await mkdir(join(root, ".claude/skills/calendar"), { recursive: true });
await mkdir(join(root, ".claude/rules"), { recursive: true });
await mkdir(join(root, "nested"), { recursive: true });
await writeFile(join(root, "CLAUDE.md"), "# Box\n");
await writeFile(join(root, "nested/CLAUDE.md"), "# Nested\n");
await writeFile(join(root, ".claude/skills/calendar/SKILL.md"), "# Calendar\n");
await writeFile(join(root, ".claude/rules/card-memo.md"), `---
paths:
  - "**/*.memo.card"
---

# Memo rules
`);
await generateAgentContextMirrors(boxRoot);
```

The editable files are symlinked, including nested context:

```ts
JSON.stringify(await readlink(join(root, "AGENTS.md")))
=> "CLAUDE.md"

JSON.stringify(await readlink(join(root, "nested/AGENTS.md")))
=> "CLAUDE.md"

JSON.stringify(await readlink(join(root, ".agents/skills/calendar")))
=> "../../.claude/skills/calendar"
```

Rules are copied into provider-valid skills:

```ts
(await readFile(join(root, ".agents/skills/callback-box-rule-card-memo/SKILL.md"), "utf8")).includes("# Memo rules")
=> true

(await readFile(join(root, ".agents/skills/callback-box-rule-card-memo/SKILL.md"), "utf8")).includes("**/*.memo.card")
=> true
```
