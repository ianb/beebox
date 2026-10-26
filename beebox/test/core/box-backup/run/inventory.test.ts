// Inventory separates hub-owned credentials from per-box logins and excludes runtime locks.
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as path from "node:path";
import { BackupRepositoryInsideBoxError, configureBackup } from "../../../../src/core/box-backup/run/backup.js";
import { backupInventory } from "../../../../src/core/box-backup/run/inventory.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

void test("dedicated-home inventory selects that box's auth state and excludes transient locks", async (t) => {
  const previous = process.env.BBX_BACKUP_DEDICATED_HOME;
  const previousUnitHost = process.env.BBX_UNIT_HOST;
  process.env.BBX_BACKUP_DEDICATED_HOME = "1";
  delete process.env.BBX_UNIT_HOST;
  const box = await makeTmpBox();
  t.teardown(async () => {
    if (previous === undefined) delete process.env.BBX_BACKUP_DEDICATED_HOME;
    else process.env.BBX_BACKUP_DEDICATED_HOME = previous;
    if (previousUnitHost === undefined) delete process.env.BBX_UNIT_HOST;
    else process.env.BBX_UNIT_HOST = previousUnitHost;
    await box.cleanup();
  });
  const inventory = await backupInventory({ boxRoot: box.root, backupId: "test-backup-id" });
  const externalTargets = inventory.external.map((item) => path.relative(inventory.stagingRoot, item.target)).toSorted();
  const requiredKinds = inventory.external.filter((item) => item.required).map((item) => item.kind).toSorted();
  const runtimeExcludes = inventory.excludes.filter((pattern) => pattern.startsWith(".git/"));
  t.check({ externalTargets, requiredKinds, skippedKinds: inventory.skipped.map((entry) => entry.kind).toSorted(), runtimeExcludes }, {
    externalTargets: ["auth/bbx-auth.json", "auth/session-secret", "claude-auth/credentials.json", "codex-auth/auth.json", `secrets/${path.basename(box.root)}.json`, "origin/origin-id"].toSorted(),
    requiredKinds: ["auth", "session-secret"] as const,
    skippedKinds: ["claude-transcripts", "google-tokens"] as const,
    runtimeExcludes: [
      ".git/bbx-maintenance/**", ".git/annex/**/*.lck", ".git/annex/tmp/**", ".git/annex/keysdb/db-wal", ".git/annex/keysdb/db-shm", ".git/annex/fsckdb/db-wal", ".git/annex/fsckdb/db-shm",
    ],
  });
});

void test("unit-host inventory omits hub credentials but selects per-box Claude and Codex logins", async (t) => {
  const previousUnitHost = process.env.BBX_UNIT_HOST;
  const previousDedicatedHome = process.env.BBX_BACKUP_DEDICATED_HOME;
  process.env.BBX_UNIT_HOST = "1";
  process.env.BBX_BACKUP_DEDICATED_HOME = "1";
  const box = await makeTmpBox();
  t.teardown(async () => {
    if (previousUnitHost === undefined) delete process.env.BBX_UNIT_HOST;
    else process.env.BBX_UNIT_HOST = previousUnitHost;
    if (previousDedicatedHome === undefined) delete process.env.BBX_BACKUP_DEDICATED_HOME;
    else process.env.BBX_BACKUP_DEDICATED_HOME = previousDedicatedHome;
    await box.cleanup();
  });
  const inventory = await backupInventory({ boxRoot: box.root, backupId: "test-backup-id" });
  const externalKinds = inventory.external.map((item) => item.kind).toSorted();
  const hubSkipped = inventory.skipped.filter((item) => item.kind === "auth" || item.kind === "session-secret").map((item) => item.reason).toSorted();
  t.check({ externalKinds, hubSkipped }, {
    externalKinds: ["box-secrets", "claude-auth", "codex-auth", "origin-id"] as const,
    hubSkipped: ["hub-owned account store is outside the per-box backup", "hub-owned session secret is outside the per-box backup"].toSorted(),
  });
});

void test("local: repository URLs resolve their path before rejecting a repository inside the box", async (t) => {
  const previousUnitHost = process.env.BBX_UNIT_HOST;
  delete process.env.BBX_UNIT_HOST;
  const box = await makeTmpBox();
  t.teardown(async () => {
    if (previousUnitHost === undefined) delete process.env.BBX_UNIT_HOST;
    else process.env.BBX_UNIT_HOST = previousUnitHost;
    await box.cleanup();
  });
  let errorName: string | undefined;
  try {
    await configureBackup({ boxRoot: box.root, repository: `local:${path.join(box.root, "backup-repo")}`, passwordFile: "/tmp/not-read-before-containment-check" });
  } catch (error) {
    if (!(error instanceof BackupRepositoryInsideBoxError)) throw error;
    errorName = error.name;
  }
  t.check(errorName, "BackupRepositoryInsideBoxError");
});
