# Canonical interface bootstrap through the real migration runner

```ts setup
import { initBox } from "../../../src/core/box/index.js";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { appendManifestEntry, runMigrationScript, readManifest, writeManifest } from "../../../src/core/migration-run.js";
import { markMigrationApplied } from "../../../src/cli/commands/migrate.js";
import { sweepMigrations } from "../../../src/core/migration-sweep.js";
import { MIGRATIONS, MANIFEST_PATH } from "../../../src/core/migrations.js";
import { SYSTEM_CARD_COHORTS, SYSTEM_CARD_PATHS, SYSTEM_CARD_MIGRATION, REMAINING_SYSTEM_CARD_MIGRATION } from "../../../src/shared/system-card-paths.js";
import { seedSystemCards, checkSystemCards } from "../../../src/core/system-cards.js";
const migration = MIGRATIONS.find((entry) => entry.name === SYSTEM_CARD_MIGRATION)!;
const remainingMigration = MIGRATIONS.find((entry) => entry.name === REMAINING_SYSTEM_CARD_MIGRATION)!;
async function pendingManifest(box) {
  await box.write(MANIFEST_PATH, MIGRATIONS.filter((entry) => entry.name !== SYSTEM_CARD_MIGRATION && entry.name !== REMAINING_SYSTEM_CARD_MIGRATION).map((entry) => JSON.stringify({ name: entry.name, "applied-at": "2026-09-09T00:00:00Z" })).join("\n") + "\n");
}
```

A partial bootstrap keeps notes and installs the rest. The actual sweep records
completion and commits the files together. Retrying the actual script is quiet
and preserves content.

```ts
const box = await makeTmpBox({ git: true });
await rm(box.path("_config/interface"), { recursive: true });
await pendingManifest(box);
await box.write(SYSTEM_CARD_PATHS.dashboard, "---\ntitle: My dashboard\n---\nPreserved rationale.\n");
await box.commitAll("partial seed");
(await sweepMigrations({ boxRoot: box.root })).status
=> applied

await checkSystemCards(box.root, REMAINING_SYSTEM_CARD_MIGRATION)
=> []

(await readManifest(box.root))?.some((entry) => entry.name === SYSTEM_CARD_MIGRATION)
=> true

(await readManifest(box.root))?.some((entry) => entry.name === REMAINING_SYSTEM_CARD_MIGRATION)
=> true

await runMigrationScript({ script: migration.script, boxRoot: box.root })
=> 0

(await box.read(SYSTEM_CARD_PATHS.dashboard)).includes("Preserved rationale.")
=> true
```

```ts cleanup
await box.cleanup();
```

A noncanonical copy blocks seeding without overwriting it or marking completion.
The runner's hard-failure result is exercised, not just the seed helper.

```ts
const conflict = await makeTmpBox({ git: true });
await pendingManifest(conflict);
await conflict.write("_content/Copy.dashboard.card", "---\ntitle: Wrong location\n---\n");
await conflict.commitAll("conflict");
(await sweepMigrations({ boxRoot: conflict.root })).status
=> failed

(await readManifest(conflict.root))?.some((entry) => entry.name === SYSTEM_CARD_MIGRATION)
=> false

(await conflict.read("_content/Copy.dashboard.card")).includes("Wrong location")
=> true
```

```ts cleanup
await conflict.cleanup();
```

The historical script remains frozen to its original three-card cohort even
after the shared table grows. Its manifest gate likewise accepts that exact
postcondition without requiring any of the five later cards.

```ts
const oldOnly = await makeTmpBox({ git: true });
await rm(oldOnly.path("_config/interface"), { recursive: true });
await pendingManifest(oldOnly);
await oldOnly.write("_content/Future.admin.card", "---\ntitle: Future conflict\n---\nOld migration ignores later cohort.\n");
await runMigrationScript({ script: migration.script, boxRoot: oldOnly.root })
=> 0

JSON.stringify(Object.values(SYSTEM_CARD_PATHS).filter((path) => existsSync(oldOnly.path(path))))
=> ["_config/interface/dashboard.card","_config/interface/settings.card","_config/interface/browse.card"]

(await oldOnly.read("_content/Future.admin.card")).includes("Old migration ignores later cohort.")
=> true

await appendManifestEntry(oldOnly.root, { name: SYSTEM_CARD_MIGRATION, "applied-at": "2026-09-10T00:00:00Z" });
(await readManifest(oldOnly.root))?.some((entry) => entry.name === SYSTEM_CARD_MIGRATION)
=> true

await appendManifestEntry(oldOnly.root, { name: REMAINING_SYSTEM_CARD_MIGRATION, "applied-at": "2026-09-10T00:00:00Z" })
=> throws SystemCardInvariantError

await writeManifest(oldOnly.root, [
  { name: SYSTEM_CARD_MIGRATION, "applied-at": "2026-09-10T00:00:00Z" },
  { name: REMAINING_SYSTEM_CARD_MIGRATION, "applied-at": "2026-09-10T00:00:00Z" },
])
=> throws SystemCardInvariantError

await writeManifest(oldOnly.root, [{ name: SYSTEM_CARD_MIGRATION, "applied-at": "2026-09-10T00:00:00Z" }]);
await markMigrationApplied({ boxRoot: oldOnly.root, name: REMAINING_SYSTEM_CARD_MIGRATION })
=> throws SystemCardInvariantError

await rm(oldOnly.path("_content/Future.admin.card"));
await runMigrationScript({ script: remainingMigration.script, boxRoot: oldOnly.root })
=> 0

Object.values(SYSTEM_CARD_PATHS).every((path) => existsSync(oldOnly.path(path)))
=> true
```

```ts cleanup
await oldOnly.cleanup();
```

The new migration is missing-only for the five later cards. A conflicting new
type blocks both completion and manifest advancement; after repair, retry keeps
authored notes and succeeds.

```ts
const remainingConflict = await makeTmpBox({ git: true });
await pendingManifest(remainingConflict);
await runMigrationScript({ script: migration.script, boxRoot: remainingConflict.root });
await remainingConflict.write("_content/Copy.admin.card", "---\ntitle: Wrong Admin\n---\nDo not overwrite.\n");
await runMigrationScript({ script: remainingMigration.script, boxRoot: remainingConflict.root })
=> 1

(await readManifest(remainingConflict.root))?.some((entry) => entry.name === REMAINING_SYSTEM_CARD_MIGRATION)
=> false

(await remainingConflict.read("_content/Copy.admin.card")).includes("Do not overwrite.")
=> true

await rm(remainingConflict.path("_content/Copy.admin.card"));
await remainingConflict.write(SYSTEM_CARD_PATHS.history, "---\ntitle: My history\n---\nPreserved history notes.\n");
await runMigrationScript({ script: remainingMigration.script, boxRoot: remainingConflict.root })
=> 0

(await remainingConflict.read(SYSTEM_CARD_PATHS.history)).includes("Preserved history notes.")
=> true

await appendManifestEntry(remainingConflict.root, { name: REMAINING_SYSTEM_CARD_MIGRATION, "applied-at": "2026-09-10T00:00:00Z" });
(await readManifest(remainingConflict.root))?.some((entry) => entry.name === REMAINING_SYSTEM_CARD_MIGRATION)
=> true
```

```ts cleanup
await remainingConflict.cleanup();
```


Fresh initialization verifies cards before marking its completion. A failed
bootstrap does not mark the box initialized, and retry preserves authored notes.

```ts
const fresh = await makeTmpBox();
await rm(fresh.path(".beebox/box.json"));
await rm(fresh.path(MANIFEST_PATH));
await fresh.write(SYSTEM_CARD_PATHS.settings, "---\ntype: memo\n---\nKeep this conflict.\n");
await initBox(fresh.root)
=> throws SystemCardInvariantError

await readManifest(fresh.root)
=> null

await fresh.write(SYSTEM_CARD_PATHS.settings, "---\ntitle: Settings\n---\nRepaired notes.\n");
await initBox(fresh.root);
(await readManifest(fresh.root))?.some((entry) => entry.name === SYSTEM_CARD_MIGRATION)
=> true

(await readManifest(fresh.root))?.some((entry) => entry.name === REMAINING_SYSTEM_CARD_MIGRATION)
=> true

Object.values(SYSTEM_CARD_PATHS).every((path) => existsSync(fresh.path(path)))
=> true

(await fresh.read(SYSTEM_CARD_PATHS.settings)).includes("Repaired notes.")
=> true
```

```ts cleanup
await fresh.cleanup();
```
