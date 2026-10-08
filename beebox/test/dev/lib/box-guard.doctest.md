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
import { existsSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { assertStandaloneBox, assertCleanAuditBox } from "../../../src/dev/lib/box-guard.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";
import { generateDocs } from "../../../src/core/docs-gen/generate/core.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { runTest } from "../../../src/dev/lib/test-runner/runner/run-test.js";

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
assertCleanAuditBox(root);
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

## The CLI refuses dirty standalone boxes before setup

This runs the actual CLI against a disposable synthetic box. Both a modified
tracked file and an untracked file must survive byte-for-byte.

```ts
const dirtyRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-audit-dirty-"));
execSync("git init -q -b main", { cwd: dirtyRoot });
execSync("git config user.email test@example.invalid && git config user.name Test", { cwd: dirtyRoot });
await fs.writeFile(path.join(dirtyRoot, "package.json"), '{"name":"fixture"}\n');
execSync("git add package.json && git commit -qm initial", { cwd: dirtyRoot });
const stagedBytes = '{"name":"fixture","staged":"keep staged edit"}\n';
const trackedBytes = '{"name":"fixture","staged":"keep staged edit","local":"keep me"}\n';
const untrackedBytes = "leave this file alone\n";
await fs.writeFile(path.join(dirtyRoot, "package.json"), stagedBytes);
execSync("git add package.json", { cwd: dirtyRoot });
await fs.writeFile(path.join(dirtyRoot, "package.json"), trackedBytes);
await fs.writeFile(path.join(dirtyRoot, "local-notes.txt"), untrackedBytes);
const stagedDiff = execSync("git diff --cached", { cwd: dirtyRoot, encoding: "utf-8" });
const headDiff = execSync("git diff HEAD", { cwd: dirtyRoot, encoding: "utf-8" });

const cliPath = path.join(PACKAGE_ROOT, "src/dev/knowledge-audit.ts");
const cli = spawnSync(process.execPath, ["--import", "tsx", cliPath, "run", "--box", dirtyRoot], {
  cwd: PACKAGE_ROOT,
  encoding: "utf-8",
});
const directRunnerRefused = await runTest({
  test: { id: "guard-test", prompt: "test", expected_level: "knows_directly" },
  boxRoot: dirtyRoot,
}).then(() => false, (error: Error) => error.name === "AuditBoxDirtyError");
JSON.stringify({
  refused: cli.status !== 0 && cli.stderr.includes("working tree has pre-existing changes"),
  actionable: cli.stderr.includes("clean disposable box"),
  trackedPreserved: await fs.readFile(path.join(dirtyRoot, "package.json"), "utf-8") === trackedBytes,
  untrackedPreserved: await fs.readFile(path.join(dirtyRoot, "local-notes.txt"), "utf-8") === untrackedBytes,
  stagedIndexPreserved: execSync("git diff --cached", { cwd: dirtyRoot, encoding: "utf-8" }) === stagedDiff,
  combinedIndexAndWorktreePreserved: execSync("git diff HEAD", { cwd: dirtyRoot, encoding: "utf-8" }) === headDiff,
  noGeneratedGuidance: !existsSync(path.join(dirtyRoot, ".agents")),
  directRunnerRefused,
})
=> {"refused":true,"actionable":true,"trackedPreserved":true,"untrackedPreserved":true,"stagedIndexPreserved":true,"combinedIndexAndWorktreePreserved":true,"noGeneratedGuidance":true,"directRunnerRefused":true}
```

```ts continue
await fs.rm(dirtyRoot, { recursive: true, force: true });
```

## CLI-generated setup baseline passes the guard, then cleanup restores clean status

The CLI's forced docs generation can create untracked guidance. Its exact
post-generation status is the baseline supplied to the first runner call;
cleanup returns the synthetic box to clean status, which later runner calls
require. This exercises the guard's baseline contract around actual generation.

```ts
const generatedBox = await makeTmpBox({ git: true });
await generateDocs(generatedBox.root, { force: true });
const generatedStatus = (await import("../../../src/dev/lib/box-guard.js")).auditBoxStatus(generatedBox.root);
assertCleanAuditBox(generatedBox.root, generatedStatus);
execSync("git reset --hard HEAD && git clean -fd", { cwd: generatedBox.root, stdio: "ignore" });
assertCleanAuditBox(generatedBox.root);
generatedStatus.length > 0
=> true
```

```ts cleanup
await generatedBox.cleanup();
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
