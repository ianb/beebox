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
