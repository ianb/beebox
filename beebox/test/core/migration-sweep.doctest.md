# The unattended migration sweep

`sweepMigrations` is what `deploy.sh` runs per box after shipping new engine
code: apply pending **script** migrations, commit each one, and leave anything
needing a human alone. See `src/core/migration-sweep.ts`.

```ts setup
import { execFileSync } from "node:child_process";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { MIGRATIONS, MANIFEST_PATH } from "../../src/core/migrations.js";
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

## A dirty box is skipped, not migrated

Auto-committing would sweep someone's in-flight work into a migration commit.
The pending names are reported so the deploy log says what was deferred, and the
next deploy retries.

```ts
const box = await makeTmpBox({ git: true });
await seedManifest(box, { pending: [PROBE] });
await box.commitAll("seed migration manifest");
await box.write("box/inbox/Half_Written.memo.card", "---\nstatus: new\n---\nmid-edit\n");

const result = await sweepMigrations({ boxRoot: box.root });
JSON.stringify({ status: result.status, pending: result.pending })
=> {"status":"skipped-dirty","pending":["annex-config-2026-08"]}
```

Nothing was recorded, so the work is still queued rather than silently lost:

```ts continue
(await box.read(MANIFEST_PATH)).includes(PROBE)
=> false
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
await writeFile(hookPath, "#!/bin/sh\nexit 1\n");
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
migrated (`--mark-all-applied`) or genuinely needs the whole queue.

```ts
const box = await makeTmpBox({ git: true });
(await sweepMigrations({ boxRoot: box.root })).status
=> no-manifest
```

```ts cleanup
await box.cleanup();
```
