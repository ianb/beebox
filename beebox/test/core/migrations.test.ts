// # The migration registry points at real scripts
//
// `MIGRATIONS` (`src/core/migrations.ts`) is the ordered list `bbx migrate` walks,
// and each entry names either a script path or a procedure. Nothing resolves those
// until a box actually runs one, so a typo'd path or a duplicated name surfaces on
// a real box mid-migration rather than here. These checks are the cheap version of
// that discovery.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MIGRATIONS, isProcedureMigration } from "../../src/core/migrations.js";
import { runMigrationScript } from "../../src/core/migration-run.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

async function missingScripts(): Promise<string[]> {
  const missing: string[] = [];
  for (const m of MIGRATIONS) {
    if (isProcedureMigration(m)) continue;
    try {
      await fs.access(path.join(REPO_ROOT, m.script));
    } catch (_e) {
      /* ignore: absence is the finding */
      missing.push(`${m.name} -> ${m.script}`);
    }
  }
  return missing;
}

// Every script-kind entry resolves to a file:
void test("Every script-kind entry resolves to a file:", async (t) => {
  t.check(await missingScripts(), []);
});

// The `name` is the manifest key, so a duplicate would make one entry
// unrunnable — the box would record the first as applied and skip the second
// forever:
void test("The name is the manifest key, so a duplicate would make one entry unrunnable...", async (t) => {
  const names = MIGRATIONS.map((m) => m.name);
  t.check(names, [...new Set(names)]);
});

// The list is append-only: a box's `config/migrations.jsonl` records names, so
// reordering or removing an entry changes which migrations a box believes it has
// applied. Retired migrations stay registered and run the shared tombstone
// `src/scripts/migrate/retired.ts` rather than disappearing.
void test("The list is append-only:", async (t) => {
  t.check(MIGRATIONS[0]?.name, "attachments");
});

// The tombstone fails closed: it only runs on a box that never applied the
// entry, so it exits 1 with a message naming the migration and writes nothing.
void test("The tombstone fails closed and names the migration:", async (t) => {
  let output = "";
  const code = await runMigrationScript({ script: "src/scripts/migrate/retired.ts", name: "example-2026-01", boxRoot: "/nonexistent-box", onOutput: (text) => { output += text; } });
  t.check({ code, output }, { code: 1, output: "Migration example-2026-01 was retired on 2026-10-08 because every fleet box had applied it, and this box never did. Restore its migrator from git history (retirement commit 81c647230; see \"Retired migrations\" in beebox/docs/cards/migrations.md), run it by hand, then record example-2026-01 in the manifest.\n" });
});
