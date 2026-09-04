# Agent context includes

The Codex plugin expands Claude-style `@file` lines without copying editable
context files.

```ts setup
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expandClaudeIncludes } from "../../src/cli/commands/agent-context.js";

const root = await mkdtemp(join(tmpdir(), "bbx-agent-context-"));
await mkdir(join(root, ".beebox"), { recursive: true });
await writeFile(join(root, "CLAUDE.md"), "@.beebox/agent-guide.md\n@briefing.md\n# Editable\n");
await writeFile(join(root, ".beebox/agent-guide.md"), "# Agent guide\n");
await writeFile(join(root, "briefing.md"), "# Briefing\n");
```

```ts
(await expandClaudeIncludes({ claudePath: join(root, "CLAUDE.md"), boxRoot: root })).includes("# Agent guide")
=> true

(await expandClaudeIncludes({ claudePath: join(root, "CLAUDE.md"), boxRoot: root })).includes("# Briefing")
=> true
```

Absolute and box-escaping includes fail visibly:

```ts
await writeFile(join(root, "CLAUDE.md"), "@/tmp/private.md\n@../../private.md\n");
await expandClaudeIncludes({ claudePath: join(root, "CLAUDE.md"), boxRoot: root })
=> throws UnsafeAgentContextIncludeError: Agent context include must stay inside the box package
```
