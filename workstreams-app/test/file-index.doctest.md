# The browsable-path index and quick-open matching (src/server/file-index.ts)

Quick-open is the affordance that has to survive the consolidation
(`docs/plans/general-browser.md`, Track 3). Replacing several reading surfaces
with one is only an improvement if finding things gets *easier*; a browser
without it would trade five surfaces for one worse one.

The listing rule is ported from the doc browser rather than reinvented,
including its deliberate exception: `.gitignore` keeps build output out, and
then ignored markdown under `scratch/` is re-admitted, because that is where
agents leave notes worth reading.

```ts setup
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";

import { listBrowsablePaths, scorePath, searchPaths } from "../src/server/file-index.js";

async function git(cwd: string, args: string[]) {
  return execa("git", args, { cwd });
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "file-index-"));
await git(root, ["init", "-q", "-b", "main"]);
await git(root, ["config", "user.email", "t@example.com"]);
await git(root, ["config", "user.name", "Test"]);

await fs.mkdir(path.join(root, "bin/lib"), { recursive: true });
await fs.mkdir(path.join(root, "node_modules/junk"), { recursive: true });
await fs.mkdir(path.join(root, "scratch"), { recursive: true });
await fs.mkdir(path.join(root, "dist"), { recursive: true });

await fs.writeFile(path.join(root, ".gitignore"), "node_modules/\ndist/\nscratch/\n");
await fs.writeFile(path.join(root, "bin/lib/comments-store.ts"), "export const a = 1;\n");
await fs.writeFile(path.join(root, "README.md"), "# readme\n");
await fs.writeFile(path.join(root, "node_modules/junk/index.js"), "module.exports = 1;\n");
await fs.writeFile(path.join(root, "dist/bundle.js"), "console.log(1);\n");
await fs.writeFile(path.join(root, "scratch/orientation.md"), "# notes\n");
await fs.writeFile(path.join(root, "scratch/debug.log"), "noise\n");
await fs.writeFile(path.join(root, "untracked-but-visible.ts"), "export const b = 2;\n");

await git(root, ["add", "bin", "README.md", ".gitignore"]);
await git(root, ["commit", "-qm", "base"]);
```

## Ignored trees stay out; `scratch/` markdown comes back in

The exception is scoped twice over — to `scratch/` and to markdown — so a build
artifact cannot ride in with the notes.

```ts
const listed = (await listBrowsablePaths(root)).map((entry) => entry.relPath);
const shape = {
  tracked: listed.includes("bin/lib/comments-store.ts"),
  untrackedButNotIgnored: listed.includes("untracked-but-visible.ts"),
  nodeModules: listed.some((p) => p.startsWith("node_modules/")),
  dist: listed.some((p) => p.startsWith("dist/")),
  scratchMarkdown: listed.includes("scratch/orientation.md"),
  scratchNoise: listed.includes("scratch/debug.log"),
};
JSON.stringify(shape)
=> {"tracked":true,"untrackedButNotIgnored":true,"nodeModules":false,"dist":false,"scratchMarkdown":true,"scratchNoise":false}
```

Each entry carries its kind, so the palette can show what a path is without a
second read.

```ts continue
const kinds = (await listBrowsablePaths(root))
  .filter((entry) => entry.relPath === "README.md" || entry.relPath === "bin/lib/comments-store.ts")
  .map((entry) => `${entry.relPath}:${entry.kind}`)
  .toSorted();
JSON.stringify(kinds)
=> ["README.md:markdown","bin/lib/comments-store.ts:code"]
```

## Matching prefers the basename, then contiguity

Typing part of a filename should find that file, not every directory that
happens to contain the letters.

```ts
const corpus = [
  { relPath: "bin/lib/comments-store.ts", kind: "code" as const },
  { relPath: "docs/comments/overview.md", kind: "markdown" as const },
  { relPath: "src/store.ts", kind: "code" as const },
];
const hits = searchPaths(corpus, { text: "comments-store", limit: 5 }).map((e) => e.relPath);
JSON.stringify(hits)
=> ["bin/lib/comments-store.ts"]
```

A subsequence still matches when nothing contiguous does — the reason `cstore`
finds the file — but scores below a real substring hit.

```ts continue
const scattered = scorePath("bin/lib/comments-store.ts", "cstore");
const contiguous = scorePath("bin/lib/comments-store.ts", "store");
const missing = scorePath("bin/lib/comments-store.ts", "zzz");
JSON.stringify({ scatteredMatches: scattered !== null, contiguousWins: (contiguous ?? 0) > (scattered ?? 0), missing })
=> {"scatteredMatches":true,"contiguousWins":true,"missing":null}
```

An empty query returns the corpus rather than nothing, so the palette opens with
something in it.

```ts continue
JSON.stringify(searchPaths(corpus, { text: "", limit: 2 }).length)
=> 2
```

Ties break toward the shorter path, which is almost always the one meant.

```ts continue
const ties = searchPaths(
  [
    { relPath: "a/very/deep/nested/store.ts", kind: "code" as const },
    { relPath: "store.ts", kind: "code" as const },
  ],
  { text: "store.ts", limit: 2 },
).map((e) => e.relPath);
JSON.stringify(ties)
=> ["store.ts","a/very/deep/nested/store.ts"]
```

```ts cleanup
await fs.rm(root, { recursive: true, force: true });
```
