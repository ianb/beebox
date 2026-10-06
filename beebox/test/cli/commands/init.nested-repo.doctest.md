# `bbx init` refuses a box inside another repository

A box is its own git repository. On 2026-10-04 a throwaway box created under
the monorepo's gitignored `scratch/` directory skipped `git init`, because
`isRepo` answered "yes" for any directory inside a repository. Every git and
annex command after that ran against the monorepo, which ended up
annex-initialized. Now `isRepo` means "the root of its own repository", and
init refuses a nested target before it writes anything.

```ts setup
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { runInit } from "../../../src/cli/commands/init.js";
import { isRepo, repoRootOf } from "../../../src/lib/git/core/operations.js";

const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bbx-init-nested-")));
const outer = path.join(dir, "outer");
await fs.mkdir(outer);
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: outer });
```

## A directory inside a repository is not a repository

The outer repository's root is a repository; a folder inside it is not,
though git can see the outer one from there.

```ts
const inside = path.join(outer, "scratch", "box");
await fs.mkdir(inside, { recursive: true });
await isRepo(outer)
=> true

await isRepo(inside)
=> false

path.relative(dir, await repoRootOf(inside))
=> outer
```

## Init refuses the nested path and leaves the outer repository alone

The refusal names both paths. Nothing is scaffolded in the target, and the
outer repository gains no annex configuration.

```ts continue
const refused = await runInit(inside, { branch: "main" }).then(() => null, (error) => error);
refused.name
=> NestedBoxError

path.relative(dir, refused.enclosingRepo)
=> outer

await fs.readdir(inside)
=> []
```

`git config --get-regexp` exits 1 when no key matches: the outer repository
has no annex settings.

```ts continue
spawnSync("git", ["config", "--get-regexp", "^annex"], { cwd: outer }).status
=> 1
```

## A target that does not exist yet is checked against its nearest ancestor

```ts continue
const deeper = path.join(outer, "not", "yet", "box");
(await runInit(deeper, { branch: "main" }).then(() => "created", (error) => error.name))
=> NestedBoxError
```

## Outside any repository, init proceeds

```ts continue
const standalone = path.join(dir, "standalone");
await runInit(standalone, { branch: "main" });
await isRepo(standalone)
=> true
```

```ts cleanup
await fs.rm(dir, { recursive: true, force: true });
```
