# Scanner: file listing and classification

`classifyFile` is a pure extension check; `listPackageFiles` walks
`git ls-files` for one package root, excludes nested packages, and computes
directories and extra source roots.

```ts setup
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rm } from "node:fs/promises";
import { classifyFile, listPackageFiles } from "../../../../src/dev/layout/scan/files.js";

const execFileAsync = promisify(execFile);
```

## `classifyFile`

A TypeScript extension is always a module; `.d.ts`, test suffixes, and
non-module extensions are decided by extension alone, regardless of
`isSourceRoot`.

```ts
classifyFile("pkg/src/foo.ts", true)
=> module

classifyFile("pkg/src/foo.tsx", true)
=> module

classifyFile("pkg/src/foo.d.ts", true)
=> declaration

classifyFile("test/foo.doctest.md", false)
=> test

classifyFile("test/foo.test.ts", false)
=> test

classifyFile("test/foo.tour.ts", false)
=> test

classifyFile("pkg/src/foo.card", true)
=> data

classifyFile("pkg/src/foo.svg", true)
=> data
```

A plain `.js`/`.mjs`/`.cjs` file is a module inside a source root (a `.mjs`
shim beside TypeScript), and a static asset (data) outside one — the
frontend's `public/sw.js` motivating case.

```ts
classifyFile("pkg/src/foo.mjs", true)
=> module

classifyFile("pkg/public/sw.js", false)
=> data

classifyFile("pkg/scripts/build.mjs", true)
=> module
```

## Listing a package root

```ts setup
const repoRoot = await mkdtemp(join(tmpdir(), "layout-files-"));
async function write(rel: string, content: string) {
  const full = join(repoRoot, rel);
  await mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
  await writeFile(full, content);
}
await execFileAsync("git", ["init", "-q"], { cwd: repoRoot });
await write(".gitignore", "ignored.ts\n");
await write("pkg/src/a.ts", "export const a = 1;\n");
await write("pkg/src/b.test.ts", "export {};\n");
await write("pkg/src/data.json", "{}\n");
await write("pkg/scripts/build.ts", "export {};\n");
await write("pkg/ignored.ts", "export {};\n");
await write("pkg/nested/package.json", "{}\n");
await write("pkg/nested/src/x.ts", "export {};\n");
await write("pkg/public/sw.js", "self.addEventListener('install', () => {});\n");

const listed = await listPackageFiles({ repoRoot, packageRoot: "pkg" });
```

Gitignored files are excluded; a nested package (and everything under it) is
excluded and reported separately.

```ts
JSON.stringify(listed.files)
=> ["pkg/public/sw.js","pkg/scripts/build.ts","pkg/src/a.ts","pkg/src/b.test.ts","pkg/src/data.json"]

JSON.stringify(listed.nestedPackages)
=> ["pkg/nested"]
```

Directories are every ancestor of a listed file, from the package root down;
the excluded nested package contributes none.

```ts
JSON.stringify([...listed.directories].toSorted())
=> ["pkg","pkg/public","pkg/scripts","pkg/src"]
```

`scripts/` holds a TypeScript file and is not `src`/`test`, so it is an extra
source root. `public/` holds only a plain `.js` file (no TypeScript), so it
is not — `sw.js` is a static asset, not a second source tree.

```ts
JSON.stringify(listed.extraSourceRoots)
=> ["pkg/scripts"]
```

```ts cleanup
t.teardown(() => rm(repoRoot, { recursive: true, force: true }));
```
