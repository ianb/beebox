// # What a migration's commit carries
//
// After a failed attempt, the next attempt commits everything changed since
// the first one (`migrationOutputBaseline`, `src/core/migration-recovery.ts`).
// Two production failures (2026-10-21, 2026-10-22) came from what that span held.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFileSync } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";
import { MIGRATIONS, MANIFEST_PATH } from "../../src/core/migrations.js";
import { sweepMigrations } from "../../src/core/migration-sweep.js";

// A retired migration: it runs the shared no-op, so only the sweep's bookkeeping is tested.
const PROBE = "annex-config-2026-08";

async function seedManifest(box: TmpBox, opts: { pending: string[] }) {
  const lines = MIGRATIONS.filter((m) => !opts.pending.includes(m.name))
    .map((m) => JSON.stringify({ name: m.name, "applied-at": "2026-01-01T00:00:00.000Z" }));
  await box.write(MANIFEST_PATH, lines.join("\n") + "\n");
}

function git(box: TmpBox, ...args: string[]) {
  return execFileSync("git", args, { cwd: box.root }).toString().trim();
}

// ## A question left uncommitted does not block the migration's commit
//
// 2026-10-21: a failed migration wrote a question quoting `/home/<user>/` paths,
// the box commit lint refused it, and it stayed uncommitted. The next pass's
// commit carried it too, so the migration could never commit even once its
// script succeeded. The sweep now rewrites those paths before it commits. The
// hook below stands in for the lint.
void test("A leftover question with a machine path commits redacted with the migration", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await seedManifest(box, { pending: [PROBE] });
  await box.commitAll("seed");
  const question = `_bookkeeping/questions/Migration_${PROBE}-0.question.card`;
  await box.write(question, "---\nmemo: Migration needs attention\nprompt: |\n  failed in /home/beebox/boxes/a\ninput:\n  type: text\nasked-at: 2026-10-20T00:00:00.000Z\n---\n");
  const hook = join(git(box, "rev-parse", "--absolute-git-dir"), "hooks/pre-commit");
  const stockHook = await readFile(hook, "utf8").catch(() => "#!/bin/sh\n");
  await writeFile(hook, `${stockHook}\nif git diff --cached | grep -q '^+.*/home/beebox/'; then exit 1; fi\n`);
  await chmod(hook, 0o755);

  // The apply commit carries the redacted card; the question is from a run
  // before the apply, so the sweep then deletes it in a commit of its own.
  const result = await sweepMigrations({ boxRoot: box.root, repair: true, runScript: async () => 0 });
  t.check({ status: result.status, committed: git(box, "show", `HEAD~1:${question}`).includes("failed in ~beebox/boxes/a"), closed: git(box, "show", "--format=", "--name-status", "HEAD"), dirty: git(box, "status", "--porcelain") }, {
    status: "applied",
    committed: true,
    closed: `D\t${question}`,
    dirty: "",
  });
});

// ## A file deleted since the first attempt does not block the commit
//
// The commit's paths are everything changed since the migration's first
// attempt. 2026-10-22: three production boxes had committed a deletion in
// between, and `git add` refused the deleted path ("pathspec did not match any
// files"), so the migration could not commit after its script succeeded.
void test("A path deleted and committed after the first attempt is not staged", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await seedManifest(box, { pending: [PROBE] });
  await box.write("_bookkeeping/jobs/old.txt", "done\n");
  await box.commitAll("seed");
  t.check((await sweepMigrations({ boxRoot: box.root, runScript: async () => 1 })).status, "failed");
  git(box, "rm", "-q", "_bookkeeping/jobs/old.txt");
  git(box, "commit", "-q", "-m", "drop old job");

  const result = await sweepMigrations({ boxRoot: box.root, runScript: async () => { await box.write("_content/new.txt", "migrated\n"); return 0; } });
  t.check({ status: result.status, committed: git(box, "show", "HEAD:_content/new.txt"), dirty: git(box, "status", "--porcelain") }, {
    status: "applied",
    committed: "migrated",
    dirty: "",
  });
});
