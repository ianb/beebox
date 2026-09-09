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
async function guard(p) {
  try {
    await assertStandaloneBox(p);
    return "ok";
  } catch (e) {
    return e.constructor.name;
  }
}
```

## A box that is its own git repo passes

```ts
const root = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-guard-"));
execSync("git init -q -b main", { cwd: root });
await guard(root)
=> ok
```

## A directory nested inside another git repo is refused

```ts continue
const sub = path.join(root, "nested");
await fs.mkdir(sub);
await guard(sub)
=> AuditBoxInsideRepoError
```

## A path that isn't a git repo at all is refused

```ts continue
const plain = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-guard-plain-"));
await guard(plain)
=> AuditBoxNotGitRepoError
```

```ts continue
await fs.rm(root, { recursive: true, force: true });
await fs.rm(plain, { recursive: true, force: true });
```

## A shapeVersion-3 box (one root, same as its git top level) passes

```ts continue
const pkgRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-guard-pkg-"));
execSync("git init -q -b main", { cwd: pkgRoot });
await fs.writeFile(
  path.join(pkgRoot, "package.json"),
  JSON.stringify({ name: "my-box", dependencies: { "beebox": "^0.1.0" } })
);
await fs.mkdir(path.join(pkgRoot, ".beebox"), { recursive: true });
await fs.writeFile(path.join(pkgRoot, ".beebox/box.json"), JSON.stringify({ shapeVersion: 3 }));
await guard(pkgRoot)
=> ok
```

```ts continue
await fs.rm(pkgRoot, { recursive: true, force: true });
```

A v2 box (marker one level down, at `content/`) is a real, more-specific
error — the migration-pointing `BoxShapeError`, not one of the guard's own
errors — so it never reads as a false "nested inside another repo":

```ts continue
const v2Root = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-guard-v2-"));
execSync("git init -q -b main", { cwd: v2Root });
await fs.writeFile(
  path.join(v2Root, "package.json"),
  JSON.stringify({ name: "my-box", dependencies: { "beebox": "^0.1.0" } })
);
const contentDir = path.join(v2Root, "content");
await fs.mkdir(contentDir);
await fs.mkdir(path.join(contentDir, ".beebox"), { recursive: true });
await fs.writeFile(path.join(contentDir, ".beebox/box.json"), JSON.stringify({ shapeVersion: 2 }));
await guard(contentDir)
=> PreV3ShapeError
```

```ts continue
await fs.rm(v2Root, { recursive: true, force: true });
```
