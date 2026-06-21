# Audit box guard

`assertStandaloneBox` protects the knowledge-audit runner: it resets box git
state between tests (`git reset --hard` + `git clean -fd`), so the box must be
its **own** git repo. A box nested inside another repo (e.g. a dir created by
mistake inside the monorepo) would have those commands hit the enclosing repo
and discard uncommitted work — the guard refuses it.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { assertStandaloneBox } from "../../../src/dev/lib/box-guard.js";

// Run the guard, returning the thrown error's class name, or "ok".
function guard(p) {
  try {
    assertStandaloneBox(p);
    return "ok";
  } catch (e) {
    return e.constructor.name;
  }
}
```

## A box that is its own git repo passes

```ts
const root = await fs.mkdtemp(path.join(os.tmpdir(), "cb-guard-"));
execSync("git init -q", { cwd: root });
guard(root)
=> ok
```

## A directory nested inside another git repo is refused

```ts continue
const sub = path.join(root, "nested");
await fs.mkdir(sub);
guard(sub)
=> AuditBoxInsideRepoError
```

## A path that isn't a git repo at all is refused

```ts continue
const plain = await fs.mkdtemp(path.join(os.tmpdir(), "cb-guard-plain-"));
guard(plain)
=> AuditBoxNotGitRepoError
```

```ts continue
await fs.rm(root, { recursive: true, force: true });
await fs.rm(plain, { recursive: true, force: true });
```
