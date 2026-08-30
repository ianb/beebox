# Box Git Lock — Crash Recovery

The regression test for the failure this design was corrected to avoid.

A crashed holder leaves its guard directory behind, and `proper-lockfile` only
lets the next acquirer reclaim it once the guard's mtime is older than the
`default` profile's five-minute stale window. If the box git lock failed hard
when its wait budget expired, one SIGKILLed process — `bbx tick` reaching its
ten-minute per-script timeout, say — would turn into roughly four more minutes
of writers failing on a box whose git index is actually free. That is a worse
failure than the lock race it replaces, so the lock fails **open** instead:
it logs loudly and runs unserialized.

```ts setup
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { stageAndCommitPaths, getStatus } from "../../src/lib/git.js";
import { LOCK_STALE_MS } from "../../src/lib/file-lock.js";

const PACKAGE_ROOT = join(import.meta.dirname, "../..");
const CHILD_SCRIPT = join(PACKAGE_ROOT, "test/helpers/box-git-lock-child.ts");

// Start a real process that takes the box git lock, wait until it holds it,
// then SIGKILL it — a genuine crashed holder, guard directory and all, with no
// exit handler having run.
async function crashedHolder(boxRoot, env) {
  const child = spawn(process.execPath, ["--import", "tsx", CHILD_SCRIPT, boxRoot], {
    cwd: PACKAGE_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("held")) resolve(undefined); });
    child.once("error", reject);
    child.once("exit", (code) => { reject(new Error(`child exited early (${code}): ${stderr}`)); });
  });
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
}
```

## A crashed holder does not block the next writer

The killed process leaves its guard directory on disk, and it stays there —
nothing sweeps it, and it is far too fresh to be reclaimed:

```ts
const box = await makeTmpBox({ git: true });
await crashedHolder(box.root, {});

existsSync(join(box.packageRoot, ".git", "beebox-index.lock.guard"))
=> true
```

The next writer still commits. The budget is shortened so the test does not
spend a real minute waiting the dead holder out, which is exactly the situation
a hard failure would have turned into an error:

```ts continue
process.env["BBX_BOX_GIT_LOCK_WAIT_MS"] = "300";
const warnings: string[] = [];
const realError = console.error;
console.error = (...args) => { warnings.push(args.map(String).join(" ")); };
const started = Date.now();
await box.write("after-crash.md", "written after the holder died\n");
const hash = await stageAndCommitPaths(box.root, {
  paths: ["after-crash.md"],
  message: "commit after a crashed lock holder",
});
const elapsed = Date.now() - started;
console.error = realError;
delete process.env["BBX_BOX_GIT_LOCK_WAIT_MS"];

typeof hash === "string" && hash.length > 0
=> true
```

The degradation was announced, not swallowed — it names the dead holder so a
reader can tell "a process died holding this" from "the index is genuinely
busy":

```ts continue
warnings.length === 1 && warnings[0].includes("Proceeding WITHOUT the lock")
=> true
```

It landed, and the tree is clean:

```ts continue
(await getStatus(box.root)).clean
=> true
```

And it landed *well* inside the stale window rather than after it. This is the
assertion that fails if the lock ever goes back to failing hard on expiry:

```ts continue
elapsed < LOCK_STALE_MS.default
=> true
```

```ts cleanup
await box.cleanup();
```
