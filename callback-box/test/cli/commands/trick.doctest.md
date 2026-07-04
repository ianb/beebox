# cb trick

`cb trick` discovers and runs box-local agent-authored scripts. Tricks live at
`boxCodePaths(shape).tricksDir` — `boxRoot/tricks` for a legacy (v1) box,
`packageRoot/src/tricks` for a package (v2) box — so both the subprocess's
cwd and every path in its listing/error messages must resolve through the
box's actual shape rather than a hardcoded `tricks/` relative to `boxRoot`.

```ts setup
import { mkdtemp, mkdir, writeFile, symlink, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, execSync } from "node:child_process";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";

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
export const description = "reports its own cwd and CB_BOX_ROOT";
console.log("cwd:" + process.cwd());
console.log("boxRoot:" + process.env.CB_BOX_ROOT);
console.log("trickName:" + process.env.CB_TRICK_NAME);
`;

/**
 * Build a v2 (package-shaped) fixture box: a package root with its own
 * `node_modules/callback-box` (symlinked to the real engine copy, the same
 * trick the v2 fixtures in `test/webapp/views-compiler-v2.doctest.md` and
 * `test/cli/lib/init-v2.doctest.md` use), `content/` nested inside as the
 * operational root, and `src/tricks/scripts/` for trick sources.
 */
async function makeV2Box() {
  const root = await mkdtemp(join(tmpdir(), "cb-v2trick-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "my-box", private: true, dependencies: { "callback-box": "0.1.0" } })
  );
  await mkdir(join(root, "node_modules"), { recursive: true });
  await symlink(PACKAGE_ROOT, join(root, "node_modules", "callback-box"), "dir");
  await mkdir(join(root, "content"), { recursive: true });
  await writeFile(join(root, "content", ".cb-box"), JSON.stringify({ shapeVersion: 2 }));
  await mkdir(join(root, "src", "tricks", "scripts"), { recursive: true });
  // Git (like `.claude/`) lives at the package root for a v2 box; a trick's
  // auto-commit (`commitIfDirty`, keyed off `boxRoot` = `content/`) still
  // finds it by walking up, same as real usage.
  execSync("git init -q && git add -A && git commit --allow-empty -m init -q", {
    cwd: root,
    stdio: "pipe",
  });
  return {
    root,
    contentRoot: join(root, "content"),
    tricksDir: join(root, "src", "tricks"),
    async writeTrick(name, content) {
      const dir = join(root, "src", "tricks", "scripts", name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "index.ts"), content);
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}
```

## v1 (legacy) box: runs from `boxRoot/tricks`, unchanged from before

```ts
const box = await makeTmpBox({ git: true });
await box.write("tricks/scripts/probe/index.ts", PROBE_TRICK);

const r = await runTrickCli(box.root, ["probe"]);
r.code
=> 0
```

The subprocess's cwd is the box's own `tricks/` directory, and it sees the
box root and trick name via env vars:

```ts continue
const expectedCwd = await realpath(box.path("tricks"));
r.stdout.includes("cwd:" + expectedCwd)
=> true

r.stdout.includes("boxRoot:" + (await realpath(box.root)))
=> true

r.stdout.includes("trickName:probe")
=> true
```

```ts cleanup
await box.cleanup();
```

## v1 box: listing and not-found messages name `tricks/scripts/...`

```ts
const box = await makeTmpBox();

const empty = await runTrickCli(box.root, []);
empty.stdout.includes("Create one at tricks/scripts/<name>/index.ts")
=> true
```

```ts continue
const missing = await runTrickCli(box.root, ["nope"]);
missing.code
=> 1

missing.stderr.includes("Expected: tricks/scripts/nope/index.ts")
=> true
```

```ts cleanup
await box.cleanup();
```

## v2 (package-layout) box: runs from `packageRoot/src/tricks`, not `boxRoot/tricks`

```ts
const box = await makeV2Box();
await box.writeTrick("probe", PROBE_TRICK);

const r = await runTrickCli(box.contentRoot, ["probe"]);
r.code
=> 0
```

The subprocess's cwd is the package's `src/tricks/` directory — a sibling of
`content/`, not a subdirectory of it — and `CB_BOX_ROOT` still points at the
operational root (`content/`):

```ts continue
const expectedCwd = await realpath(box.tricksDir);
r.stdout.includes("cwd:" + expectedCwd)
=> true

r.stdout.includes("boxRoot:" + (await realpath(box.contentRoot)))
=> true
```

```ts cleanup
await box.cleanup();
```

## v2 box: listing and not-found messages name `../src/tricks/scripts/...`

Messages are relative to the operating agent's cwd (`content/`), which has to
climb out to the package root to reach `src/tricks/`:

```ts
const box = await makeV2Box();

const empty = await runTrickCli(box.contentRoot, []);
empty.stdout.includes("Create one at ../src/tricks/scripts/<name>/index.ts")
=> true
```

```ts continue
const missing = await runTrickCli(box.contentRoot, ["nope"]);
missing.code
=> 1

missing.stderr.includes("Expected: ../src/tricks/scripts/nope/index.ts")
=> true
```

```ts cleanup
await box.cleanup();
```
