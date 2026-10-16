# bbx trick

`bbx trick` discovers and runs box-local agent-authored scripts. Tricks live
at `boxCodePaths(shape).tricksDir` — `boxRoot/src/tricks` (the box's one
root, shapeVersion 3) — so both the subprocess's cwd and every path in its
listing/error messages resolve through the box's actual shape.

```ts setup
import { mkdir, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

// Run the prebuilt CLI with the given cwd (requireBoxRoot walks up from there).
function runTrickCli(cwd, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(PACKAGE_ROOT, "dist/cli.mjs"), "trick", ...args], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

// A trick that proves both where it ran from and what env it saw, without
// needing any of its own npm dependencies.
const PROBE_TRICK = `
export const description = "reports its own cwd and BBX_BOX_ROOT";
console.log("cwd:" + process.cwd());
console.log("boxRoot:" + process.env.BBX_BOX_ROOT);
console.log("trickName:" + process.env.BBX_TRICK_NAME);
`;

async function writeTrick(box, name, content) {
  const dir = box.path(join("src", "tricks", "scripts", name));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.ts"), content);
}

async function writeTrickSecrets(box, name, declarations) {
  const dir = box.path(join("src", "tricks", "scripts", name));
  await writeFile(join(dir, "secrets.json"), JSON.stringify(declarations));
}
```

## Runs from `boxRoot/src/tricks`, with `BBX_BOX_ROOT` set to the box root

```ts
const box = await makeTmpBox({ git: true });
await writeTrick(box, "probe", PROBE_TRICK);

const r = await runTrickCli(box.root, ["probe"]);
r.code
=> 0
```

```ts continue
const expectedCwd = await realpath(box.path("src/tricks"));
r.stdout.includes("cwd:" + expectedCwd)
=> true

r.stdout.includes("boxRoot:" + (await realpath(box.root)))
=> true
```

```ts cleanup
await box.cleanup();
```

## Secret declarations can be checked without running a trick

The migration and CI can validate the author-provided declarations without
resolving or printing any secret values.

```ts
const box = await makeTmpBox({ git: true });
await writeTrick(box, "needs-key", PROBE_TRICK);
await writeTrickSecrets(box, "needs-key", [
  { name: "image-generation", reason: "image-generation", env: "IMAGE_API_KEY" },
]);

const checked = await runTrickCli(box.root, ["--check-secrets"]);
JSON.stringify({ code: checked.code, stdout: checked.stdout.trim() })
=> {"code":0,"stdout":"Validated secret declarations for 1 trick(s)."}
```

```ts cleanup
await box.cleanup();
```

## Listing and not-found messages name `src/tricks/scripts/...`

```ts
const box = await makeTmpBox({ git: true });

const empty = await runTrickCli(box.root, []);
empty.stdout.includes("Create one at src/tricks/scripts/<name>/index.ts")
=> true
```

```ts continue
const missing = await runTrickCli(box.root, ["nope"]);
missing.code
=> 1

missing.stderr.includes("Expected: src/tricks/scripts/nope/index.ts")
=> true
```

```ts cleanup
await box.cleanup();
```

## A successful run commits only the paths the trick changed

The runner fingerprints every dirty path before the trick starts and again
after it exits 0, and commits the paths that are new or whose content changed.
An edit someone left uncommitted before the run stays uncommitted. Untracked
directories are listed file by file, so a new file in a new directory is
committed.

```ts setup
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

function git(box, args) {
  return execFileSync("git", args, { cwd: box.root, encoding: "utf8" });
}

// The files the HEAD commit touched, and its subject and Run-By trailer.
function headCommit(box) {
  return {
    subject: git(box, ["log", "-1", "--format=%s"]).trim(),
    runBy: git(box, ["log", "-1", "--format=%(trailers:key=Run-By,valueonly)"]).trim(),
    files: git(box, ["show", "--name-only", "--format=", "HEAD"]).trim().split("\n"),
  };
}

function dirty(box) {
  return git(box, ["status", "--porcelain", "--untracked-files=all"]).trim().split("\n").filter(Boolean);
}

// A trick that appends a line to each box-relative path given as an argument,
// creating parent directories. A literal "fail" argument makes it exit 3.
const WRITE_TRICK = `
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
const args = process.argv.slice(2);
for (const rel of args.filter((a) => a !== "fail")) {
  const abs = join(process.env.BBX_BOX_ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  appendFileSync(abs, "from trick\\n");
}
process.exit(args.includes("fail") ? 3 : 0);
`;

async function writeBoxFile(box, rel, content) {
  await mkdir(join(box.root, rel, ".."), { recursive: true });
  await writeFile(box.path(rel), content);
}

// A box with the write trick committed, and one unrelated uncommitted edit.
async function boxWithPendingEdit() {
  const box = await makeTmpBox({ git: true });
  await writeTrick(box, "write", WRITE_TRICK);
  await writeBoxFile(box, "notes/shared.txt", "committed\n");
  git(box, ["add", "-A"]);
  git(box, ["commit", "-q", "-m", "fixture"]);
  await writeBoxFile(box, "notes/someone-else.txt", "unrelated edit\n");
  return box;
}
```

```ts
const box = await boxWithPendingEdit();
const r = await runTrickCli(box.root, ["write", "out/new/deep/result.txt"]);
r.code
=> 0

headCommit(box)
=> {"subject":"Auto-commit changes from trick: write","runBy":"trick/write","files":["out/new/deep/result.txt"]}

dirty(box)
=> ["?? notes/someone-else.txt"]
```

```ts cleanup
await box.cleanup();
```

## A trick's edit to an already-dirty file is committed

A path that was dirty before the run and that the trick changes again is in
both snapshots; its content differs, so it is committed. The commit holds the
whole file, including the earlier uncommitted edit.

```ts
const box = await boxWithPendingEdit();
await writeFile(box.path("notes/shared.txt"), "committed\nedited before the run\n");
const r = await runTrickCli(box.root, ["write", "notes/shared.txt"]);
headCommit(box).files
=> ["notes/shared.txt"]

await readFile(box.path("notes/shared.txt"), "utf8")
=> committed
edited before the run
from trick

dirty(box)
=> ["?? notes/someone-else.txt"]
```

```ts cleanup
await box.cleanup();
```

## Output that git ignores commits nothing

```ts
const box = await boxWithPendingEdit();
await writeFile(box.path(".gitignore"), (await readFile(box.path(".gitignore"), "utf8")) + "scratch/\n");
git(box, ["commit", "-q", "-am", "ignore scratch"]);
const headBefore = git(box, ["rev-parse", "HEAD"]);

const r = await runTrickCli(box.root, ["write", "scratch/out.txt"]);
r.code
=> 0

git(box, ["rev-parse", "HEAD"]) === headBefore
=> true

dirty(box)
=> ["?? notes/someone-else.txt"]
```

```ts cleanup
await box.cleanup();
```

## `--no-commit` and a failed run leave the tree as the trick left it

```ts
const box = await boxWithPendingEdit();
const headBefore = git(box, ["rev-parse", "HEAD"]);

const skipped = await runTrickCli(box.root, ["write", "--no-commit", "out/a.txt"]);
skipped.code
=> 0
```

```ts continue
const failed = await runTrickCli(box.root, ["write", "out/b.txt", "fail"]);
failed.code
=> 3

git(box, ["rev-parse", "HEAD"]) === headBefore
=> true

dirty(box)
=> ["?? notes/someone-else.txt","?? out/a.txt","?? out/b.txt"]
```

```ts cleanup
await box.cleanup();
```
