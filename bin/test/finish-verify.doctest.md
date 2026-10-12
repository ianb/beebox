# finish-verify: arguments, interruption, and concurrent runs

A full `bin/finish-verify` run merges main and runs every check the sheet
names, which takes ten minutes or more. Three finishes in October 2026 started
that run by asking for `--help`. So the command parses its arguments strictly
and runs nothing unless they are all valid.

```ts setup
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = path.resolve(process.cwd(), "..");
const verify = path.join(repo, "bin/finish-verify.ts");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "finish-verify-"));
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });

/** A sheet that names one check, run as a shell script in the fixture repo. */
const sheetFile = (script: string): string => {
  const file = path.join(root, "sheet.json");
  const command = { kind: "typecheck", command: "fixture check", cwd: ".", argv: ["sh", "-c", script] };
  fs.writeFileSync(file, JSON.stringify({ repoRoot: root, verification: [command] }));
  return file;
};
const cli = (...args: string[]) =>
  spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), verify, ...args], {
    cwd: root,
    encoding: "utf8",
  });
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
```

## Arguments

`--help` prints the usage and exits 0. The fixture is not a worktree branch, so
if the command ran preflight it would exit 1 instead.

```ts
const help = cli("--help");
[help.status, help.stdout.split("\n")[0]]
=> [0, "usage: bin/finish-verify [--sheet <file>] [--only tests|typecheck|lint|smoke|site]"]
```

An unknown flag and an unknown `--only` kind are usage errors: exit 2, the
reason, and the usage, with nothing run.

```ts
const unknown = cli("--sheeet", "x.json");
const badKind = cli("--only", "test");
[unknown.status, badKind.status, unknown.stdout, badKind.stdout]
=> [2, 2, "", ""]
```

``` continue
assert.match(unknown.stderr, /Unknown option '--sheeet'/);
assert.match(badKind.stderr, /--only takes tests, typecheck, lint, smoke, site; got 'test'/);
```

## Interruption stops the checks' whole process tree

An agent harness stops a command by signalling its pid alone. Each check runs
in its own process group, and finish-verify passes the signal to that group.
Before this, an interrupted run left its test runner going and holding a test
slot. Here the check starts a background `sleep`, the way pnpm starts tap; the
`sleep` must die with finish-verify.

```ts
const pidFile = path.join(root, "grandchild.pid");
const child = spawn(
  process.execPath,
  ["--import", import.meta.resolve("tsx"), verify, "--sheet", sheetFile(`sleep 60 & echo $! > ${pidFile}; wait`)],
  { cwd: root, stdio: "ignore" },
);
const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
const deadline = Date.now() + 20_000;
while (!fs.existsSync(pidFile) || fs.readFileSync(pidFile, "utf8").trim() === "") {
  assert.ok(Date.now() < deadline, "the check never started");
  await new Promise((resolve) => setTimeout(resolve, 50));
}
const grandchild = Number(fs.readFileSync(pidFile, "utf8"));
child.kill("SIGTERM");
const code = await exited;
await new Promise((resolve) => setTimeout(resolve, 200));
```

Exit 143 is 128 + SIGTERM's 15, the shell convention for death by signal.

``` continue
[code, alive(grandchild)]
=> [143, false]
```

## A concurrent run is named

Every worktree shares one dev router, so another worktree's finish-verify slows
this run's smoke walk. Each run registers its pid under the git common dir.
A run that finds another live registration prints a note, so a slow smoke can
be read as load. This test registers its own live pid as the other run.

```ts
const runs = path.join(root, ".git", "finish-verify-runs");
fs.mkdirSync(runs, { recursive: true });
fs.writeFileSync(path.join(runs, `${process.pid}.json`), JSON.stringify("other-worktree"));
const concurrent = cli("--sheet", sheetFile("true"));
assert.equal(concurrent.status, 0);
assert.equal(
  concurrent.stdout.split("\n")[0],
  `note: finish-verify also running in other-worktree (pid ${process.pid}) — the shared dev router is loaded; a slow smoke may be load`,
);
```

A finished run removes its own registration, so only the planted one remains.

``` continue
assert.deepEqual(fs.readdirSync(runs), [`${process.pid}.json`]);
```

```ts cleanup
fs.rmSync(root, { recursive: true, force: true });
```
