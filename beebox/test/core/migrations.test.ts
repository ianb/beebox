// # The migration registry points at real scripts
//
// `MIGRATIONS` (`src/core/migrations.ts`) is the ordered list `bbx migrate` walks,
// and each entry names either a script path or a procedure. Nothing resolves those
// until a box actually runs one, so a typo'd path or a duplicated name surfaces on
// a real box mid-migration rather than here. These checks are the cheap version of
// that discovery.

import { test } from "tap";
import "agent-doctest/tap";
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
  // doctest:L35
  t.check((await missingScripts()).join("\n"), "");
});

// The `name` is the manifest key, so a duplicate would make one entry
// unrunnable — the box would record the first as applied and skip the second
// forever:
void test("The name is the manifest key, so a duplicate would make one entry unrunnable...", async (t) => {
  // doctest:L44
  await t.checkText(MIGRATIONS.length === new Set(MIGRATIONS.map((m) => m.name)).size, "true");
});

// The list is append-only: a box's `config/migrations.jsonl` records names, so
// reordering or removing an entry changes which migrations a box believes it has
// applied. Retired migrations stay registered and run the shared no-op
// `src/scripts/migrate/retired.ts` rather than disappearing.
void test("The list is append-only:", async (t) => {
  // doctest:L54
  t.check(MIGRATIONS[0]?.name, "attachments");
});

// The tombstone is safe to run on any box: it exits 0 and prints nothing, so a
// box that somehow still has a retired name pending records it quietly.
void test("The tombstone is safe to run on any box:", async (t) => {
  // doctest:L62
  let output = "";
  const code = await runMigrationScript({ script: "src/scripts/migrate/retired.ts", boxRoot: "/nonexistent-box", onOutput: (text) => { output += text; } });
  t.check({ code, output }, {
    code: 0,
    output: "",
  });
});
