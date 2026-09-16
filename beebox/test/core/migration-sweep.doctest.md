# The unattended migration sweep

`sweepMigrations` is what `deploy.sh` runs per box after shipping new engine
code: apply pending **script** migrations, commit each one, and leave anything
needing a human alone. See `src/core/migration-sweep.ts`.

```ts setup
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { MIGRATIONS, MANIFEST_PATH } from "../../src/core/migrations.js";
import { acquireBoxMaintenance, acquireBoxWork, boxMaintenanceStatus, closeBoxMaintenance } from "../../src/lib/box-maintenance.js";
import { sweepMigrations } from "../../src/core/migration-sweep.js";

// Pinned rather than "whatever is last": appending a migration would otherwise
// change what these tests run. `annex-config-2026-08` is chosen because it
// converges configuration and touches no cards, so on a non-annex tmp box it is
// a clean no-op — the sweep's own bookkeeping is what gets tested, not a
// migrator's side effects. The registry is append-only, so this name persists.
const PROBE = "annex-config-2026-08";

/** Seed the manifest as fully applied, optionally leaving some names pending. */
async function seedManifest(box, opts) {
  const pending = new Set(opts.pending);
  const lines = MIGRATIONS
    .filter((m) => !pending.has(m.name))
    .map((m) => JSON.stringify({ name: m.name, "applied-at": "2026-01-01T00:00:00.000Z" }));
  await box.write(MANIFEST_PATH, lines.join("\n") + "\n");
}

function git(box, ...args) {
  return execFileSync("git", args, { cwd: box.root }).toString().trim();
}
```

## A box with nothing pending says nothing and does nothing

The common case — this runs against every box on every deploy, so the quiet
path has to stay quiet. The commit count is the check that it really did
nothing.

```ts
const box = await makeTmpBox({ git: true });
await seedManifest(box, { pending: [] });
await box.commitAll("seed migration manifest");
const before = git(box, "rev-list", "--count", "HEAD");

const result = await sweepMigrations({ boxRoot: box.root });
JSON.stringify({ status: result.status, newCommits: Number(git(box, "rev-list", "--count", "HEAD")) - Number(before) })
=> {"status":"current","newCommits":0}
```

The quiet path never closes admission. With live work on the box, a sweep that
closed first would sit in its drain until that work ended; this one reads,
finds nothing, and returns while the work is still admitted.

```ts continue
const busy = await acquireBoxWork(box.root, { reason: "live chat run" });
const quiet = sweepMigrations({ boxRoot: box.root }).then((outcome) => outcome.status);
await Promise.race([quiet, new Promise((resolve) => setTimeout(() => resolve("still draining"), 3000))])
=> current

await boxMaintenanceStatus(box.root)
=> null

await busy.release();
```

```ts cleanup
await box.cleanup();
```

## A pending script migration is applied and committed as one unit

The manifest entry and the changes it describes land in the **same** commit, so
a box can never claim a migration whose effects are not in its history. The
commit carries the `Created-By` trailer the box's other automated writers use.

`annex-config-2026-08` is the migration under test here (see the setup note): on
a box that is not on git-annex it converges nothing, which is exactly the shape
that proves the sweep's own bookkeeping without depending on a migrator's side
effects.

```ts
const box = await makeTmpBox({ git: true });
await seedManifest(box, { pending: [PROBE] });
await box.commitAll("seed migration manifest");

const result = await sweepMigrations({ boxRoot: box.root });
JSON.stringify({ status: result.status, applied: result.applied.map((m) => m.name) })
=> {"status":"applied","applied":["annex-config-2026-08"]}
```

```ts continue
JSON.stringify({
  subject: git(box, "log", "-1", "--format=%s"),
  trailer: git(box, "log", "-1", "--format=%(trailers:key=Created-By,valueonly)"),
  manifestInCommit: git(box, "show", "--name-only", "--format=", "HEAD").includes(MANIFEST_PATH),
  clean: git(box, "status", "--porcelain") === "",
})
=> {"subject":"Apply migration: annex-config-2026-08","trailer":"migration-sweep","manifestInCommit":true,"clean":true}
```

A second sweep is a no-op — the manifest now records it:

```ts continue
(await sweepMigrations({ boxRoot: box.root })).status
=> current
```

```ts cleanup
await box.cleanup();
```

## A scheduled pass yields to a box in use

`--yield` is the hourly schedule's mode. An idle chat run holds a lease until
the box's server sees a maintenance phase and closes it, so the pass cannot
tell "in use" from the leases alone: it closes, waits fifteen seconds, and
work that outlasts the wait means the box is in use. That pass is deferred to
the next hour, naming the holder, and the box reopens. Once the box is free
the same pass applies the work. A deploy does not yield.

```ts
const box = await makeTmpBox({ git: true });
await seedManifest(box, { pending: [PROBE] });
await box.commitAll("seed migration manifest");
const holder = spawn(process.execPath, ["--import", "tsx", join(import.meta.dirname, "../helpers/box-maintenance-child.ts"), box.root], { stdio: ["pipe", "pipe", "inherit"] });
await once(holder.stdout, "data");

const deferred = await sweepMigrations({ boxRoot: box.root, yield: true });
JSON.stringify({ status: deferred.status, holders: deferred.holders.map((entry) => entry.reason), phase: await boxMaintenanceStatus(box.root) })
=> {"status":"deferred","holders":["fixture child"],"phase":null}

holder.stdin.end("finish");
await once(holder, "exit");
(await sweepMigrations({ boxRoot: box.root, yield: true })).status
=> applied
```

A deploy holding the maintenance owner lock is the other way a box is in use.
That is what the lock is for, so a yielding pass defers and names it rather
than failing the check.

```ts continue
await seedManifest(box, { pending: [PROBE] });
const deploy = await closeBoxMaintenance(box.root, { reason: "deployment" });
const behindDeploy = await sweepMigrations({ boxRoot: box.root, yield: true });
await deploy.release();
JSON.stringify({ status: behindDeploy.status, holders: behindDeploy.holders.map((entry) => entry.reason) })
=> {"status":"deferred","holders":["deployment"]}
```

```ts cleanup
holder.kill();
await box.cleanup();
```

## A dirty box converges without committing unrelated work

The recovery ref preserves input while the path-scoped output commit leaves unrelated working files and staging alone.

```ts
const box = await makeTmpBox({ git: true });
await seedManifest(box, { pending: [PROBE] });
await box.commitAll("seed migration manifest");
await box.write("_content/inbox/Half_Written.memo.card", "---\nstatus: new\n---\nmid-edit\n");

const result = await sweepMigrations({ boxRoot: box.root });
JSON.stringify({ status: result.status, untracked: git(box, "ls-files", "--others", "--exclude-standard").includes("Half_Written.memo.card") })
=> {"status":"applied","untracked":true}
```

The migration was recorded despite the unrelated dirty file:

```ts continue
(await box.read(MANIFEST_PATH)).includes(PROBE)
=> true
```

```ts cleanup
await box.cleanup();
```

## A commit that fails rolls the manifest entry back

The manifest entry has to be written *before* the commit, because it belongs in
it. So a commit that fails — the box's own pre-commit hook rejecting a card the
migrator produced, say — must not leave a manifest claiming a migration that
never landed: the next sweep would read that line, report the box current, and
never retry.

Simulated by making the commit fail for a reason the sweep cannot foresee: a
pre-commit hook that always rejects.

```ts
const box = await makeTmpBox({ git: true });
await seedManifest(box, { pending: [PROBE] });
await box.commitAll("seed migration manifest");
// The repo root is not necessarily box.root (a v2 box roots at the package
// dir, one level up), so ask git where its hooks actually live.
const hookPath = join(git(box, "rev-parse", "--absolute-git-dir"), "hooks", "pre-commit");
// APPEND the rejection rather than replacing the hook. The box is annexed, so
// its stock hook invokes `git annex pre-commit`; overwriting that would break
// the box's annex configuration and the sweep would fail for that reason
// instead of the one under test.
const stockHook = await readFile(hookPath, "utf8").catch(() => "#!/bin/sh\n");
await writeFile(hookPath, `${stockHook}\nexit 1\n`);
await chmod(hookPath, 0o755);

const result = await sweepMigrations({ boxRoot: box.root });
result.status
=> commit-failed
```

The manifest is back to what it was, so the migration is still pending and the
next sweep retries it:

```ts continue
JSON.stringify({
  recorded: (await box.read(MANIFEST_PATH)).includes(PROBE),
  head: git(box, "log", "-1", "--format=%s"),
})
=> {"recorded":false,"head":"seed migration manifest"}
```

```ts cleanup
await box.cleanup();
```

## A box with no manifest at all is left alone

It predates `bbx migrate`, and only a human can say whether it is already
migrated (`--mark-all-applied`) or genuinely needs the whole queue. A fresh
`bbx init` box always seeds a manifest, so this simulates the legacy case by
removing it (a real pre-`bbx migrate` box on disk simply never had one):

```ts
const box = await makeTmpBox({ git: true });
await rm(join(box.root, MANIFEST_PATH));
(await sweepMigrations({ boxRoot: box.root })).status
=> no-manifest
```

```ts cleanup
await box.cleanup();
```

## Partial conversion asks once and lets later migrations proceed

```ts
const box = await makeTmpBox({ git: true });
const later = MIGRATIONS.at(-1).name;
await seedManifest(box, { pending: [PROBE, later] });
await box.commitAll("seed");
let agents = 0;
let calls = 0;
const result = await sweepMigrations({
  boxRoot: box.root, repair: true,
  runScript: async ({ script }) => {
    calls += 1;
    return script === MIGRATIONS.find((m) => m.name === PROBE).script ? 2 : 0;
  },
  repairAgent: { invokeStructured: async () => {
    agents += 1;
    return { success: true, sessionId: "repair-session", data: { status: "needs-human", reason: "Choose between divergent copies." } };
  } },
});
JSON.stringify({ status: result.status, applied: result.applied.length, partial: result.applied[0].partial, agents, calls })
=> {"status":"attention","applied":2,"partial":true,"agents":1,"calls":3}

const next = await sweepMigrations({ boxRoot: box.root });
JSON.stringify({ status: next.status, questions: next.questions.length })
=> {"status":"attention","questions":1}
```

```ts cleanup
await box.cleanup();
```

## A joined blocker revokes readiness and leaves deployment closed

A missing manifest or pending procedure is not permission to activate new code,
even if an earlier nested operation prepared readiness. The outer controller
retains the closed phase after its owner releases.

```ts
const box = await makeTmpBox({ git: true });
await rm(join(box.root, MANIFEST_PATH));
const owner = await acquireBoxMaintenance(box.root, { reason: "deployment" });
await owner.prepare();
const result = await owner.run(() => sweepMigrations({ boxRoot: box.root, withinMaintenance: true }));
await owner.release();
JSON.stringify({ status: result.status, phase: (await boxMaintenanceStatus(box.root)).phase })
=> {"status":"no-manifest","phase":"exclusive"}
```

```ts cleanup
await owner.release();
await box.cleanup();
```

```ts
const box = await makeTmpBox({ git: true });
await seedManifest(box, { pending: ["view-card-shape"] });
await box.commitAll("pending procedure");
const owner = await acquireBoxMaintenance(box.root, { reason: "deployment" });
await owner.prepare();
const result = await owner.run(() => sweepMigrations({ boxRoot: box.root, withinMaintenance: true }));
await owner.release();
JSON.stringify({ status: result.status, phase: (await boxMaintenanceStatus(box.root)).phase })
=> {"status":"needs-procedure","phase":"exclusive"}
```

```ts cleanup
await owner.release();
await box.cleanup();
```

## A rejected commit retains conversion output across an idempotent retry

The new attempt snapshots current input and staging, but its output comparison
keeps the original failed attempt's baseline. A converter writing identical
bytes on retry must still commit those bytes with the manifest.

```ts
const box = await makeTmpBox({ git: true });
await seedManifest(box, { pending: [PROBE] });
await box.write("_content/Converted.memo.card", "---\nstatus: new\n---\nOriginal\n");
await box.write("_content/unrelated.txt", "original\n");
await box.commitAll("seed");
await box.write("_content/unrelated.txt", "staged unrelated\n");
git(box, "add", "_content/unrelated.txt");
const hook = join(git(box, "rev-parse", "--absolute-git-dir"), "hooks/pre-commit");
await writeFile(hook, "#!/bin/sh\nexit 1\n");
await chmod(hook, 0o755);
const converted = "---\nstatus: new\n---\nConverted\n";
const runScript = async () => { await box.write("_content/Converted.memo.card", converted); return 0; };
(await sweepMigrations({ boxRoot: box.root, runScript })).status
=> commit-failed

await rm(hook);
(await sweepMigrations({ boxRoot: box.root, repair: true, runScript })).status
=> applied

JSON.stringify({ committed: git(box, "show", "HEAD:_content/Converted.memo.card").endsWith("Converted"), staged: git(box, "diff", "--cached", "--name-only"), unstaged: git(box, "diff", "--name-only"), pendingRef: git(box, "for-each-ref", "--format=%(refname)", `refs/bbx/migrations/${PROBE}/pending`) })
=> {"committed":true,"staged":"_content/unrelated.txt","unstaged":"","pendingRef":""}
```

```ts cleanup
await box.cleanup();
```
