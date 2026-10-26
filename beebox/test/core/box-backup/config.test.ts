// Backup configuration is machine-owned, strict, and bound to one resolved box root.
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { uuid } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import { backupConfigPath, readBackupConfig, updateBackupSchedule, writeBackupConfig } from "../../../src/core/box-backup/config.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

void test("backup configuration is outside the box and pinned to its resolved root", async (t) => {
  const box = await makeTmpBox();
  t.teardown(async () => {
    await fs.rm(backupConfigPath(box.root), { force: true });
    await box.cleanup();
  });
  const config = await writeBackupConfig({ boxRoot: box.root, repository: "/tmp/restic-repository", passwordFile: "/tmp/restic-password" });
  t.check({ version: config.version, boxRoot: config.boxRoot, backupId: config.backupId, retention: config.retention, outsideBox: !configPathInsideBox(backupConfigPath(box.root), box.root) }, {
    version: 1, boxRoot: await fs.realpath(box.root), backupId: uuid(),
    retention: { daily: 7, weekly: 4, monthly: 12 }, outsideBox: true,
  });
  t.check(await readBackupConfig({ boxRoot: box.root }), config);

  const manualOnly = await updateBackupSchedule({ boxRoot: box.root, schedule: "off" });
  t.check({ backupId: manualOnly.backupId, repository: manualOnly.repository, passwordFile: manualOnly.passwordFile, retention: manualOnly.retention, schedule: manualOnly.schedule }, {
    backupId: config.backupId, repository: config.repository, passwordFile: config.passwordFile, retention: config.retention, schedule: "off",
  });
  const reconfigured = await writeBackupConfig({ boxRoot: box.root, repository: "/tmp/updated-repository", passwordFile: "/tmp/updated-password" });
  t.check({ backupId: reconfigured.backupId, schedule: reconfigured.schedule }, { backupId: config.backupId, schedule: "off" });
  const legacyConfig = { ...manualOnly, schedule: undefined };
  await fs.writeFile(backupConfigPath(box.root), `${JSON.stringify(legacyConfig)}\n`, { mode: 0o600 });
  t.check((await readBackupConfig({ boxRoot: box.root })).schedule, "daily");
});

function configPathInsideBox(configPath: string, boxRoot: string): boolean { return configPath.startsWith(`${boxRoot}/`); }
