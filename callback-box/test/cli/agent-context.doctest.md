# Agent context includes

The Codex plugin expands Claude-style `@file` lines without copying editable
context files.

```ts setup
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expandClaudeIncludes } from "../../src/cli/commands/agent-context.js";

const root = await mkdtemp(join(tmpdir(), "cb-agent-context-"));
await mkdir(join(root, "content/.callback-box"), { recursive: true });
await writeFile(join(root, "content/CLAUDE.md"), "@.callback-box/agent-guide.md\n@briefing.md\n# Editable\n");
await writeFile(join(root, "content/.callback-box/agent-guide.md"), "# Agent guide\n");
await writeFile(join(root, "content/briefing.md"), "# Briefing\n");
```

```ts
(await expandClaudeIncludes({ claudePath: join(root, "content/CLAUDE.md"), packageRoot: root })).includes("# Agent guide")
=> true

(await expandClaudeIncludes({ claudePath: join(root, "content/CLAUDE.md"), packageRoot: root })).includes("# Briefing")
=> true
```

Absolute and package-escaping includes are ignored:

```ts
await writeFile(join(root, "content/CLAUDE.md"), "@/tmp/private.md\n@../../private.md\n");
await expandClaudeIncludes({ claudePath: join(root, "content/CLAUDE.md"), packageRoot: root })
=>
```
