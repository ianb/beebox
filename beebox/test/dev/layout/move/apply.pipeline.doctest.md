# Move pipeline: scan, collect, apply, report

End-to-end coverage of `edges.ts`, `apply.ts`, and `mentions.ts` together
against a real temp git repo, the same fixture style as
`test/dev/layout/scan/package.doctest.md`.

```ts setup
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateMoveList } from "../../../../src/dev/layout/move/validate.js";
import { scanRoots } from "../../../../src/dev/layout/move/roots.js";
import { collectSources, collectRewrites } from "../../../../src/dev/layout/move/edges.js";
import { moveFiles, applyRewrites } from "../../../../src/dev/layout/move/apply.js";
import { reportMentions } from "../../../../src/dev/layout/move/mentions.js";

const execFileAsync = promisify(execFile);
const repoRoot = await mkdtemp(join(tmpdir(), "layout-move-pipeline-"));
async function write(rel: string, content: string) {
  const full = join(repoRoot, rel);
  await mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
  await writeFile(full, content);
}
async function read(rel: string): Promise<string> {
  return readFile(join(repoRoot, rel), "utf8");
}
async function git(args: string[]) {
  await execFileAsync("git", args, { cwd: repoRoot });
}
await git(["init", "-q"]);

await write("pkg/package.json", JSON.stringify({ name: "pkg" }));
await write(
  "pkg/tsconfig.json",
  JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@shared/*": ["./src/shared/*"] } } }),
);
// The file that moves, with its own relative import (must be rewritten to
// account for its new directory) and a sibling that stays put.
await write("pkg/src/helper.ts", "export const helper = 1;\n");
await write("pkg/src/a.ts", 'import { helper } from "./helper.js";\nexport const a = helper;\n');
// An importer in another directory, unaffected by the move itself but whose
// specifier to the moved file must be recomputed.
await write("pkg/src/other/importer.ts", 'import { a } from "../a.js";\nexport const value = a;\n');
// A doctest importer.
await write(
  "pkg/test/x.doctest.md",
  '# X\n\n```ts setup\nimport { a } from "../src/a.js";\n```\n\n```ts\na\n=> 1\n```\n',
);
// An aliased import whose target moves but stays under the alias root.
await write("pkg/src/shared/thing.ts", "export const thing = 1;\n");
await write("pkg/src/webapp/user.ts", 'import { thing } from "@shared/thing";\nexport const value = thing;\n');
// A non-import mention that must NOT be rewritten, only reported.
await write("pkg/docs/note.md", "See pkg/src/a.ts for details.\n");
await git(["add", "-A"]);

const plannedMoves = [
  { from: "pkg/src/a.ts", to: "pkg/src/sub/a.ts" },
  { from: "pkg/src/shared/thing.ts", to: "pkg/src/shared/moved/thing.ts" },
];
const moves = validateMoveList({ moves: plannedMoves, repoRoot });
const moveMap = new Map(moves.map((m) => [m.from, m.to] as const));
const roots = scanRoots(repoRoot);
const sources = await collectSources({ repoRoot, roots });
const { byImporter, edgeCount } = collectRewrites({ sources, moveMap });
```

## Only the affected edges are collected: the moved file's own import, the distant importer's, the doctest's, and the alias importer's

```ts
edgeCount
=> 4

JSON.stringify([...byImporter.keys()].toSorted())
=> ["pkg/src/other/importer.ts","pkg/src/sub/a.ts","pkg/src/webapp/user.ts","pkg/test/x.doctest.md"]
```

## Applying moves the files and rewrites every collected specifier

```ts
moveFiles({ repoRoot, moves });
applyRewrites({ repoRoot, byImporter });

(await read("pkg/src/sub/a.ts")).includes('from "../helper.js"')
=> true

(await read("pkg/src/other/importer.ts")).includes('from "../sub/a.js"')
=> true

(await read("pkg/src/webapp/user.ts")).includes('from "@shared/moved/thing"')
=> true

(await read("pkg/test/x.doctest.md")).includes('from "../src/sub/a.js"')
=> true
```

## The unrelated file that only mentions the old path in prose is untouched, and shows up in the mention report

```ts
(await read("pkg/docs/note.md")).includes("pkg/src/a.ts")
=> true

const mentions = reportMentions({ repoRoot, moves, roots, rewrittenFiles: new Set(byImporter.keys()) });
mentions.find((m) => m.movedPath === "pkg/src/a.ts")?.lines.some((line) => line.startsWith("pkg/docs/note.md:"))
=> true
```

```ts cleanup
t.teardown(() => rm(repoRoot, { recursive: true, force: true }));
```
