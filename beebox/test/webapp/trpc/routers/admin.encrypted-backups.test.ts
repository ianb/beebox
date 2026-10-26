// # Admin encrypted backup setup
//
// The owner can configure a new repository without receiving password bytes
// back. Status and schedule operate on machine-local records only.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, not } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { backupConfigPath, readBackupConfig, writeBackupConfig } from "../../../../src/core/box-backup/config.js";
import { createManagedBackupPasswordFile } from "../../../../src/core/box-backup/admin-config.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

void test("encrypted backup Admin procedures require an authenticated owner", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  const admin = appRouter.createCaller(trpcContext({ boxRoot: box.root })).admin;

  t.check(await admin.encryptedBackupStatus().then(() => null, (error: Error) => error.message), any(String).includes("authenticated owner"));
  t.check(await admin.configureEncryptedBackup({ repository: "local:/tmp/repo", password: "secret" }).then(() => null, (error: Error) => error.message), any(String).includes("authenticated owner"));
  t.check(await admin.updateEncryptedBackupSchedule({ schedule: "off" }).then(() => null, (error: Error) => error.message), any(String).includes("authenticated owner"));
});

void test("encrypted backup status is local, and schedule preserves the existing CLI config", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(async () => {
    await fs.rm(backupConfigPath(box.root), { force: true });
    const directory = path.dirname(backupConfigPath(box.root));
    const prefix = path.basename(backupConfigPath(box.root), ".json");
    await fs.rm(path.join(directory, `${prefix}.attempt.json`), { force: true });
    await box.cleanup();
  });
  const ctx = trpcContext({
    boxRoot: box.root,
    user: { email: "owner@example.com", name: "Owner" },
    isAuthenticatedOwner: true,
  });
  const admin = appRouter.createCaller(ctx).admin;
  t.check(await admin.encryptedBackupStatus(), {
    boxRoot: box.root,
    boxSlug: "test",
    installKind: process.env.BBX_UNIT_HOST === "1" ? "unit-host" : process.env.BBX_INSTALL_KIND === "mac-app" ? "mac-app" : process.env.BBX_INSTALL_KIND === "docker" ? "docker" : "local",
    configured: false,
    repository: null,
    retention: null,
    schedule: "daily",
    newestVerified: null,
    lastAttempt: null,
    maintenance: null,
  });

  const key = await createManagedBackupPasswordFile({ boxRoot: box.root, password: "do-not-return" });
  t.teardown(() => key.cleanup());
  t.check((await fs.stat(key.passwordFile)).mode & 0o777, 0o600);
  const configured = await writeBackupConfig({ boxRoot: box.root, repository: "s3:https://user:repository-secret@example.invalid/repo", passwordFile: key.passwordFile });
  const ownerStatus = await admin.encryptedBackupStatus();
  t.check([ownerStatus.boxSlug, ownerStatus.installKind, ownerStatus.configured, ownerStatus.repository, ownerStatus.schedule, ownerStatus.newestVerified], ["test", process.env.BBX_UNIT_HOST === "1" ? "unit-host" : process.env.BBX_INSTALL_KIND === "mac-app" ? "mac-app" : process.env.BBX_INSTALL_KIND === "docker" ? "docker" : "local", true, "s3:https://***@example.invalid/repo", "daily", null]);
  t.check(Object.keys(ownerStatus).toSorted(), ["boxRoot", "boxSlug", "configured", "installKind", "lastAttempt", "maintenance", "newestVerified", "repository", "retention", "schedule"]);
  t.check(ownerStatus.repository, "s3:https://***@example.invalid/repo");

  const directory = path.dirname(backupConfigPath(box.root));
  const passwordFiles = (await fs.readdir(directory)).filter((name) => name.startsWith("password-")).toSorted();
  const reconfigure = await admin.configureEncryptedBackup({ repository: "local:/tmp/other", password: "another-secret" }).then(() => "success", (error: Error) => error.message);
  t.check(reconfigure, any(String).includes("already configured"));
  t.check((await fs.readdir(directory)).filter((name) => name.startsWith("password-")).toSorted(), passwordFiles);

  await admin.updateEncryptedBackupSchedule({ schedule: "off" });
  const after = await readBackupConfig({ boxRoot: box.root });
  t.check([after.repository, after.passwordFile, after.backupId, after.retention, after.schedule], [configured.repository, configured.passwordFile, configured.backupId, configured.retention, "off"]);
  await key.cleanup();
});

void test("failed first-time setup removes its new password file and returns no raw Restic detail", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(async () => {
    await fs.rm(backupConfigPath(box.root), { force: true });
    const directory = path.dirname(backupConfigPath(box.root));
    const prefix = path.basename(backupConfigPath(box.root), ".json");
    await fs.rm(path.join(directory, `${prefix}.attempt.json`), { force: true });
    await box.cleanup();
  });
  const admin = appRouter.createCaller(trpcContext({
    boxRoot: box.root,
    user: { email: "owner@example.com", name: "Owner" },
    isAuthenticatedOwner: true,
  })).admin;
  const configDir = path.dirname(backupConfigPath(box.root));
  const before = new Set(await fs.readdir(configDir).catch(() => []));
  const whitespacePassword = await admin.configureEncryptedBackup({
    repository: "local:/tmp/unused-repo",
    password: "recovery-secret ",
  }).then(() => "success", (error: Error) => error.message);
  t.check(whitespacePassword, any(String).includes("no leading or trailing whitespace"));
  t.check(whitespacePassword, not(any(String).includes("recovery-secret")));
  const rejectedUrl = await admin.configureEncryptedBackup({
    repository: "s3:https://user:nested-secret@example.invalid/repo",
    password: "recovery-secret",
  }).then(() => "success", (error: Error) => error.message);
  t.check(rejectedUrl, any(String).includes("credential store"));
  t.check(rejectedUrl, not(any(String).includes("nested-secret")));
  t.check(rejectedUrl, not(any(String).includes("recovery-secret")));
  const message = await admin.configureEncryptedBackup({
    repository: `local:${path.join(box.root, "backup-repo")}`,
    password: "recovery-secret",
  }).then(() => "success", (error: Error) => error.message);
  t.check(message, any(String).includes("Could not configure encrypted backups"));
  t.check(message, not(any(String).includes(box.root)));
  t.check(message, not(any(String).includes("recovery-secret")));
  const after = await fs.readdir(configDir);
  t.check(after.filter((name) => name.startsWith("password-") && !before.has(name)), []);
});
