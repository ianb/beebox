# Canonical interface cards and the migration manifest gate

The three interface-card cohorts are named after migrations
(`canonical-interface-cards`, `remaining-interface-cards`,
`search-interface-card`). Those migrations are retired, so their entries run
the shared no-op; `seedSystemCards` still installs each cohort for `bbx init`.
The runner keeps one rule for these names: it refuses to record a cohort in the
manifest while that cohort's cards are missing or invalid.

```ts setup
import { initBox } from "../../src/core/box/structure/core.js";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { appendManifestEntry, writeManifest } from "../../src/core/migration-run.js";
import { readManifest } from "../../src/core/migration-manifest.js";
import { markMigrationApplied } from "../../src/cli/commands/migrate.js";
import { sweepMigrations } from "../../src/core/migration-sweep.js";
import { MIGRATIONS, MANIFEST_PATH } from "../../src/core/migrations.js";
import { SYSTEM_CARD_PATHS, SYSTEM_CARD_MIGRATION, REMAINING_SYSTEM_CARD_MIGRATION, SEARCH_SYSTEM_CARD_MIGRATION } from "../../src/shared/system-card-paths.js";
import { seedSystemCards, checkSystemCards } from "../../src/core/system-cards.js";
async function pendingManifest(box) {
  await box.write(MANIFEST_PATH, MIGRATIONS.filter((entry) => entry.name !== SYSTEM_CARD_MIGRATION && entry.name !== REMAINING_SYSTEM_CARD_MIGRATION).map((entry) => JSON.stringify({ name: entry.name, "applied-at": "2026-09-09T00:00:00Z" })).join("\n") + "\n");
}
```

A partial bootstrap keeps notes and installs the rest. Seeding again is quiet
and preserves content.

```ts
const box = await makeTmpBox({ git: true });
await rm(box.path("_config/interface"), { recursive: true });
await box.write(SYSTEM_CARD_PATHS.dashboard, "---\ntitle: My dashboard\n---\nPreserved rationale.\n");
await seedSystemCards(box.root, SYSTEM_CARD_MIGRATION);
await seedSystemCards(box.root, REMAINING_SYSTEM_CARD_MIGRATION);
await checkSystemCards(box.root, REMAINING_SYSTEM_CARD_MIGRATION)
=> []

await seedSystemCards(box.root, SYSTEM_CARD_MIGRATION);
(await box.read(SYSTEM_CARD_PATHS.dashboard)).includes("Preserved rationale.")
=> true
```

With the cards in place, the sweep records both pending cohort names:

```ts continue
await pendingManifest(box);
await box.commitAll("cards seeded, cohorts pending");
(await sweepMigrations({ boxRoot: box.root })).status
=> applied

(await readManifest(box.root))?.some((entry) => entry.name === SYSTEM_CARD_MIGRATION)
=> true

(await readManifest(box.root))?.some((entry) => entry.name === REMAINING_SYSTEM_CARD_MIGRATION)
=> true
```

```ts cleanup
await box.cleanup();
```

A noncanonical copy fails the manifest gate at commit time: the sweep reports
`commit-failed`, does not record the cohort, and leaves the copy alone. Seeding
refuses the same box.

```ts
const conflict = await makeTmpBox({ git: true });
await pendingManifest(conflict);
await conflict.write("_content/Copy.dashboard.card", "---\ntitle: Wrong location\n---\n");
await conflict.commitAll("conflict");
(await sweepMigrations({ boxRoot: conflict.root })).status
=> commit-failed

(await readManifest(conflict.root))?.some((entry) => entry.name === SYSTEM_CARD_MIGRATION)
=> false

(await conflict.read("_content/Copy.dashboard.card")).includes("Wrong location")
=> true

await seedSystemCards(conflict.root, SYSTEM_CARD_MIGRATION)
=> throws SystemCardInvariantError
```

```ts cleanup
await conflict.cleanup();
```

The first cohort stays frozen to its original three cards even after the shared
table grows. Its manifest gate likewise accepts that exact postcondition without
requiring any of the five later cards.

```ts
const oldOnly = await makeTmpBox({ git: true });
await rm(oldOnly.path("_config/interface"), { recursive: true });
await pendingManifest(oldOnly);
await oldOnly.write("_content/Future.admin.card", "---\ntitle: Future conflict\n---\nOld cohort ignores later cards.\n");
await seedSystemCards(oldOnly.root, SYSTEM_CARD_MIGRATION);
JSON.stringify(Object.values(SYSTEM_CARD_PATHS).filter((path) => existsSync(oldOnly.path(path))))
=> ["_config/interface/dashboard.card","_config/interface/settings.card","_config/interface/browse.card"]

(await oldOnly.read("_content/Future.admin.card")).includes("Old cohort ignores later cards.")
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
await seedSystemCards(oldOnly.root, REMAINING_SYSTEM_CARD_MIGRATION);
await seedSystemCards(oldOnly.root, SEARCH_SYSTEM_CARD_MIGRATION);
Object.values(SYSTEM_CARD_PATHS).every((path) => existsSync(oldOnly.path(path)))
=> true
```

```ts cleanup
await oldOnly.cleanup();
```

The second cohort is missing-only for the five later cards. A conflicting card
of a new type blocks seeding; after repair, a retry keeps authored notes and the
cohort can be recorded.

```ts
const remainingConflict = await makeTmpBox({ git: true });
await pendingManifest(remainingConflict);
await seedSystemCards(remainingConflict.root, SYSTEM_CARD_MIGRATION);
await remainingConflict.write("_content/Copy.admin.card", "---\ntitle: Wrong Admin\n---\nDo not overwrite.\n");
await seedSystemCards(remainingConflict.root, REMAINING_SYSTEM_CARD_MIGRATION)
=> throws SystemCardInvariantError

(await remainingConflict.read("_content/Copy.admin.card")).includes("Do not overwrite.")
=> true

await rm(remainingConflict.path("_content/Copy.admin.card"));
await remainingConflict.write(SYSTEM_CARD_PATHS.history, "---\ntitle: My history\n---\nPreserved history notes.\n");
await seedSystemCards(remainingConflict.root, REMAINING_SYSTEM_CARD_MIGRATION);
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
