# "Is this box on git-annex?" — the binary-free probe

`isAnnexInitialized` answers from the filesystem rather than from
`git annex info`, because it gates route registration and every scan promote
pass on hosts that may not have the binary at all. What it looks for is the
`annex/` directory `git annex init` creates inside the repository's git
directory.

Finding that git directory is the whole subtlety: a normal clone has a `.git`
**directory**, but a linked worktree (which is how a box clone is often made)
has a `.git` **file** holding a `gitdir:` pointer, and git-annex puts `annex/`
under the *common* directory that pointer's target names via `commondir`.
Reading only `<root>/.git/annex` would call such a box un-annexed — and
`bbx init` branches on this answer, so a wrong `false` de-annexes a real annex
box.

```ts setup
import { isAnnexInitialized } from "../../../src/core/annex/is-annex-box.js";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "bbx-annex-probe-"));
}
```

## A plain repository: the `.git` directory decides

```ts
const repo = await tmpRepo();
await mkdir(join(repo, ".git"), { recursive: true });
await isAnnexInitialized(repo)
=> false

await mkdir(join(repo, ".git", "annex", "objects"), { recursive: true });
await isAnnexInitialized(repo)
=> true
```

A repository with no `.git` at all is simply not annexed — not an error:

```ts continue
await isAnnexInitialized(join(repo, "nowhere"))
=> false
```

```ts cleanup
await rm(repo, { recursive: true, force: true });
```

## A `.git` file: the `gitdir:` pointer is followed

A submodule-style layout keeps the git directory elsewhere and leaves a pointer
file behind. The pointer is resolved relative to the repository root, and the
`annex/` directory under it counts exactly as if it had been in place.

```ts
const repo = await tmpRepo();
const gitDir = join(repo, "elsewhere", "gitdir");
await mkdir(gitDir, { recursive: true });
await writeFile(join(repo, ".git"), "gitdir: elsewhere/gitdir\n");
await isAnnexInitialized(repo)
=> false

await mkdir(join(gitDir, "annex"), { recursive: true });
await isAnnexInitialized(repo)
=> true
```

Garbage in the pointer file is a `false`, not a throw — a file we cannot read as
a pointer names no git directory, and the probe's contract is a plain answer:

```ts continue
await writeFile(join(repo, ".git"), "this is not a pointer\n");
await isAnnexInitialized(repo)
=> false
```

```ts cleanup
await rm(repo, { recursive: true, force: true });
```

## A linked worktree: `annex/` lives under the common directory

`git worktree add` gives the new checkout a `.git` file pointing at a
*per-worktree* git directory (`<main>/.git/worktrees/<name>`), which holds no
`annex/` of its own — it holds a `commondir` file naming the shared directory
that does. Both are checked, so this box reads as annexed.

```ts
const main = await tmpRepo();
const worktree = await tmpRepo();
const commonDir = join(main, ".git");
const perWorktree = join(commonDir, "worktrees", "scan");
await mkdir(perWorktree, { recursive: true });
await writeFile(join(worktree, ".git"), `gitdir: ${perWorktree}\n`);
// git writes `commondir` as a path relative to the per-worktree git directory.
await writeFile(join(perWorktree, "commondir"), "../..\n");

await isAnnexInitialized(worktree)
=> false

await mkdir(join(commonDir, "annex", "objects"), { recursive: true });
await isAnnexInitialized(worktree)
=> true
```

The main checkout agrees, which is the point — one repository, one answer:

```ts continue
await isAnnexInitialized(main)
=> true
```

```ts cleanup
await rm(main, { recursive: true, force: true });
await rm(worktree, { recursive: true, force: true });
```
