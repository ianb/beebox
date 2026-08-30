# Agent context includes

The Codex plugin expands Claude-style `@file` lines without copying editable
context files.

```ts setup
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expandClaudeIncludes } from "../../src/cli/commands/agent-context.js";

const root = await mkdtemp(join(tmpdir(), "bbx-agent-context-"));
await mkdir(join(root, "content/.beebox"), { recursive: true });
await writeFile(join(root, "content/CLAUDE.md"), "@.beebox/agent-guide.md\n@briefing.md\n# Editable\n");
await writeFile(join(root, "content/.beebox/agent-guide.md"), "# Agent guide\n");
await writeFile(join(root, "content/briefing.md"), "# Briefing\n");
```

```ts
(await expandClaudeIncludes({ claudePath: join(root, "content/CLAUDE.md"), packageRoot: root })).includes("# Agent guide")
=> true

(await expandClaudeIncludes({ claudePath: join(root, "content/CLAUDE.md"), packageRoot: root })).includes("# Briefing")
=> true
```

Absolute and package-escaping includes fail visibly:

```ts
await writeFile(join(root, "content/CLAUDE.md"), "@/tmp/private.md\n@../../private.md\n");
await expandClaudeIncludes({ claudePath: join(root, "content/CLAUDE.md"), packageRoot: root })
=> throws UnsafeAgentContextIncludeError: Agent context include must stay inside the box package
```
