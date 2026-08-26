# symlinkClaudeMemory — the global dir is keyed the way Claude Code keys it

`cb init` links a box's `.claude/memory/` into `~/.claude/projects/<dir>/memory`
so auto-memory is git-tracked. Claude Code derives `<dir>` by replacing EVERY
non-alphanumeric character in the cwd with `-` (see `encodeProjectDir` in
`src/core/chat/session/transcript-paths.ts`). The linker used to translate only
`/`, so a box whose path held `_` or `.` got its link planted under a name
Claude Code never reads, and its memory silently stayed global.

`CB_CLAUDE_PROJECTS_DIR` redirects the global root into the tmpdir.

```ts setup
import { symlinkClaudeMemory } from "../../../src/core/box/index.js";
import { encodeProjectDir } from "../../../src/core/chat/session/transcript-paths.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
```

A box reached through a path containing `_` and `.` (a symlink beside the real
box, so `path.resolve` keeps the odd characters) links under the fully collapsed
name — the `_` and `.` become `-`:

```ts
const box = await makeTmpBox();
const previousProjects = process.env["CB_CLAUDE_PROJECTS_DIR"];
const projects = await fs.mkdtemp(path.join(os.tmpdir(), "cb-projects-"));
process.env["CB_CLAUDE_PROJECTS_DIR"] = projects;
const oddRoot = path.join(path.dirname(box.root), `odd_name.v2-${path.basename(box.root)}`);
await fs.symlink(box.root, oddRoot);

const linked = await symlinkClaudeMemory(oddRoot);
const entries = await fs.readdir(projects);
print(`linked: ${linked}`);
print(`entry matches encoder: ${entries[0] === encodeProjectDir(oddRoot)}`);
print(`odd chars collapsed: ${!/[_.]/.test(entries[0] ?? "")}`);
print(`target: ${path.basename(path.dirname(await fs.readlink(path.join(projects, entries[0] ?? "", "memory"))))}`);
=>
linked: true
entry matches encoder: true
odd chars collapsed: true
target: .claude
```

```ts cleanup
if (previousProjects === undefined) delete process.env["CB_CLAUDE_PROJECTS_DIR"];
else process.env["CB_CLAUDE_PROJECTS_DIR"] = previousProjects;
await fs.rm(projects, { recursive: true, force: true });
await fs.unlink(oddRoot);
await box.cleanup();
```
