# Candidate-state protection for canonical interface cards

```ts setup
import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { checkSystemCards, checkStagedSystemCards, seedSystemCards } from "../../../src/core/system-cards.js";
import { SYSTEM_CARD_PATHS, SYSTEM_CARD_MIGRATION } from "../../../src/shared/system-card-paths.js";
import { MANIFEST_PATH } from "../../../src/core/migrations.js";
import { runPreCommitChecks } from "../../../src/cli/commands/validate-pre-commit.js";
import { markMigrationApplied } from "../../../src/cli/commands/migrate.js";
import { appendManifestEntry, writeManifest } from "../../../src/core/migration-run.js";
function git(box, ...args) { return execFileSync("git", args, { cwd: box.root }).toString(); }
const completion = { name: SYSTEM_CARD_MIGRATION, "applied-at": "2026-09-09T00:00:00Z" };
```

An old box may omit all anchors. Partial bootstrap does not permit deleting an
anchor that already exists in HEAD. Index deletion cannot be hidden by an
unstaged working copy; unstaged removal cannot invalidate a valid index.

```ts
const box = await makeTmpBox({ git: true });
await rm(box.path("_config/interface"), { recursive: true });
await box.write(MANIFEST_PATH, "");
await box.commitAll("legacy");
await checkSystemCards(box.root)
=> []

await checkStagedSystemCards(box.root)
=> []

await box.write(SYSTEM_CARD_PATHS.dashboard, "---\ntitle: Custom dashboard\n---\nKeep my notes.\n");
await box.commitAll("partial bootstrap");
git(box, "rm", "--cached", SYSTEM_CARD_PATHS.dashboard);
(await checkStagedSystemCards(box.root))[0]?.includes("Required system card missing from proposed commit")
=> true

git(box, "restore", "--staged", SYSTEM_CARD_PATHS.dashboard);
await rm(box.path(SYSTEM_CARD_PATHS.dashboard));
await checkStagedSystemCards(box.root)
=> []

git(box, "restore", SYSTEM_CARD_PATHS.dashboard);
await seedSystemCards(box.root);
(await box.read(SYSTEM_CARD_PATHS.dashboard)).includes("Keep my notes.")
=> true

await appendManifestEntry(box.root, completion);
git(box, "add", MANIFEST_PATH);
(await checkStagedSystemCards(box.root)).length
=> 2

await box.commitAll("completed bootstrap");
await checkStagedSystemCards(box.root)
=> []
```

An enrolled HEAD cannot opt out by rolling back its manifest. Moving a required
card is both a missing canonical path and a duplicate instrument error.

```ts continue
await box.write(MANIFEST_PATH, "");
git(box, "add", MANIFEST_PATH);
git(box, "mv", SYSTEM_CARD_PATHS.settings, "_config/interface/Other.settings.card");
const moved = await checkStagedSystemCards(box.root);
moved.some((message) => message.includes("Required system card missing")) && moved.some((message) => message.includes("must be at"))
=> true

git(box, "reset", "--hard", "HEAD");
await box.write(SYSTEM_CARD_PATHS.browse, "---\ntype: memo\n---\n");
git(box, "add", SYSTEM_CARD_PATHS.browse);
(await checkStagedSystemCards(box.root)).some((message) => message.includes("does not match filename type"))
=> true

git(box, "reset", "--hard", "HEAD");
await rm(box.path("_config/interface"), { recursive: true });
git(box, "add", "-A");
(await checkStagedSystemCards(box.root)).length
=> 3

(await checkSystemCards(box.root)).length
=> 3

await appendManifestEntry(box.root, completion)
=> throws SystemCardInvariantError

await writeManifest(box.root, [completion])
=> throws SystemCardInvariantError

await box.write(MANIFEST_PATH, "");
await markMigrationApplied({ boxRoot: box.root, name: SYSTEM_CARD_MIGRATION })
=> throws SystemCardInvariantError

(await runPreCommitChecks(box.root, { colors: false })).report.includes("Required system card missing from proposed commit")
=> true
```

```ts cleanup
await box.cleanup();
```


Trash is not an active instrument. A stray copy can be discarded through the
ordinary trash path, but a trashed canonical card cannot satisfy presence.

```ts
const trashBox = await makeTmpBox({ git: true });
const stray = "_content/Old.browse.card";
const discarded = "_bookkeeping/trash/Old.browse.card";
await trashBox.write(stray, "---\ntitle: Old browser\n---\n");
await trashBox.commitAll("stray copy before validation");
(await checkSystemCards(trashBox.root)).some((message) => message.includes("must be at"))
=> true

git(trashBox, "mv", stray, discarded);
await checkSystemCards(trashBox.root)
=> []

await checkStagedSystemCards(trashBox.root)
=> []

await seedSystemCards(trashBox.root);
await trashBox.commitAll("discard stray copy");
git(trashBox, "mv", SYSTEM_CARD_PATHS.browse, "_bookkeeping/trash/browse.card");
const missingWorking = await checkSystemCards(trashBox.root);
missingWorking.length === 1 && missingWorking[0].includes("Required system card missing")
=> true

const missingIndex = await checkStagedSystemCards(trashBox.root);
missingIndex.length === 1 && missingIndex[0].includes("Required system card missing")
=> true

git(trashBox, "restore", "--source=HEAD", "--staged", "--worktree", SYSTEM_CARD_PATHS.browse);
await checkSystemCards(trashBox.root)
=> []

await checkStagedSystemCards(trashBox.root)
=> []
```

```ts cleanup
await trashBox.cleanup();
```
