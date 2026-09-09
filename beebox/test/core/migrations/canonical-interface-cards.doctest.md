# Canonical interface bootstrap through the real migration runner

```ts setup
import { initBox } from "../../../src/core/box/index.js";
import { rm } from "node:fs/promises";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { runMigrationScript, readManifest } from "../../../src/core/migration-run.js";
import { sweepMigrations } from "../../../src/core/migration-sweep.js";
import { MIGRATIONS, MANIFEST_PATH } from "../../../src/core/migrations.js";
import { SYSTEM_CARD_PATHS, SYSTEM_CARD_MIGRATION } from "../../../src/shared/system-card-paths.js";
import { seedSystemCards, checkSystemCards } from "../../../src/core/system-cards.js";
const migration = MIGRATIONS.find((entry) => entry.name === SYSTEM_CARD_MIGRATION)!;
async function pendingManifest(box) {
  await box.write(MANIFEST_PATH, MIGRATIONS.filter((entry) => entry.name !== SYSTEM_CARD_MIGRATION).map((entry) => JSON.stringify({ name: entry.name, "applied-at": "2026-09-09T00:00:00Z" })).join("\n") + "\n");
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

await checkSystemCards(box.root, true)
=> []

(await readManifest(box.root))?.some((entry) => entry.name === SYSTEM_CARD_MIGRATION)
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

(await fresh.read(SYSTEM_CARD_PATHS.settings)).includes("Repaired notes.")
=> true
```

```ts cleanup
await fresh.cleanup();
```
