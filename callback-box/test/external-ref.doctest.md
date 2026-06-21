# External-ref resolver + version markers

`resolveExternalRef` turns a `file:` URL into a real, allowlisted path (the
commentary surface's live wrapper, Track B). `buildVersionMarkers` produces the
drift signal: a content hash (always) plus the last-modifying git commit (when
tracked). Both are dev-only and read-only.

```ts setup
import {
  resolveExternalRef,
  buildVersionMarkers,
  ExternalRefError,
} from "../src/core/external-ref.js";
import { mkdtempSync, writeFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";

// A tmp git repo with one committed file. realpath the root so it matches what
// resolveExternalRef returns (macOS tmpdir is a symlink to /private/...).
const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "extref-")));
const file = path.join(root, "doc.md");
writeFileSync(file, "hello\n");

function git(...args: string[]): void {
  execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
}
git("init", "-q");
git("config", "user.email", "t@t");
git("config", "user.name", "t");
git("add", "doc.md");
git("commit", "-q", "-m", "add doc");

const roots = [root];
const href = `file:${file}`;

// An untracked file and a sibling outside the root, for the negative cases.
const untracked = path.join(root, "untracked.md");
writeFileSync(untracked, "x\n");
const outside = path.join(os.tmpdir(), `extref-outside-${process.pid}.md`);
writeFileSync(outside, "x\n");

function shape(markers: string): string {
  return markers
    .replace(/sha256:[\da-f]{12}/, "sha256:<hash>")
    .replace(/git:[\da-f]+/, "git:<rev>");
}
async function errName(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof ExternalRefError ? "ExternalRefError" : "other";
  }
}
async function dirtyChangesHashKeepsRev(): Promise<boolean> {
  const before = await buildVersionMarkers(file);
  writeFileSync(file, "edited content\n");
  const after = await buildVersionMarkers(file);
  return before !== after && before.includes("git:") && after.includes("git:");
}
```

## Resolves a `file:` URL under an allowed root

```ts
(await resolveExternalRef(href, { roots })) === file
=>
true
```

## Version markers: content hash + git rev for a committed file

```ts
shape(await buildVersionMarkers(file))
=>
sha256:<hash> git:<rev>
```

## An untracked file has only the content hash

```ts
shape(await buildVersionMarkers(untracked))
=>
sha256:<hash>
```

## A dirty edit changes the hash but keeps the git rev

```ts
await dirtyChangesHashKeepsRev()
=>
true
```

## A non-`file:` URL is rejected

```ts
await errName(resolveExternalRef("https://example.com/x", { roots }))
=>
ExternalRefError
```

## A path outside every allowed root is rejected

```ts
await errName(resolveExternalRef(`file:${outside}`, { roots }))
=>
ExternalRefError
```

## A denylisted path (`.git/`) is rejected even under the root

```ts
await errName(resolveExternalRef(`file:${path.join(root, ".git", "config")}`, { roots }))
=>
ExternalRefError
```
