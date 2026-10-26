// Restore refuses a populated target before reading the repository or writing any files.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { instanceOf } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { restoreBoxBackup, RestoreTargetNotEmptyError } from "../../../src/core/box-backup/restore.js";

void test("restore refuses a target that already contains data", async (t) => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-restore-target-"));
  t.teardown(() => fs.rm(target, { recursive: true, force: true }));
  await fs.writeFile(path.join(target, "keep.txt"), "keep this file");

  let failure: unknown;
  try {
    await restoreBoxBackup({ repository: "unused", passwordFile: "unused", target });
  } catch (error) {
    failure = error;
  }

  t.check(failure, instanceOf(RestoreTargetNotEmptyError));
  t.check(await fs.readFile(path.join(target, "keep.txt"), "utf8"), "keep this file");
});

void test("restore refuses a symlink target even when its destination is empty", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-restore-symlink-"));
  t.teardown(() => fs.rm(base, { recursive: true, force: true }));
  const destination = path.join(base, "destination");
  const target = path.join(base, "target");
  await fs.mkdir(destination);
  await fs.symlink(destination, target);

  let failure: unknown;
  try {
    await restoreBoxBackup({ repository: "unused", passwordFile: "unused", target });
  } catch (error) {
    failure = error;
  }

  t.check(failure, instanceOf(RestoreTargetNotEmptyError));
  t.check(await fs.readdir(destination), []);
});

void test("restore stages the selected verified snapshot as box and external state", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-restore-integration-"));
  t.teardown(() => fs.rm(base, { recursive: true, force: true }));
  const backupId = "00000000-0000-4000-8000-000000000001";
  const target = path.join(base, "recovery");
  const calls: string[][] = [];
  const gitCalls: string[][] = [];
  const snapshotPaths = ["/synthetic/box", `/Users/me/.config/beebox/backups/staging/${backupId}/secrets/box.json`];
  let gitExitCode = 0;
  const { restoreBoxBackup: restore } = await t.mockImport("../../../src/core/box-backup/restore.ts", {
    "../../../src/core/box-backup/run/backup.ts": {
      listSnapshots: async () => [
        { id: "verified-snapshot", time: "2026-10-25T10:00:00.000Z", host: backupId, paths: snapshotPaths, tags: [`bbx-backup:${backupId}`, "verified"] },
        { id: "partial-snapshot", time: "2026-10-26T10:00:00.000Z", host: backupId, paths: ["/synthetic/box"], tags: [`bbx-backup:${backupId}`] },
      ],
    },
    "../../../src/core/box-backup/restic.ts": {
      runRestic: async ({ args }: { args: string[] }) => {
        calls.push(args);
        if (args[0] === "restore") {
          const stage = args[3]!;
          const box = path.join(stage, "synthetic/box");
          const secret = path.join(stage, `Users/test/.config/beebox/backups/staging/${backupId}/secrets/box.json`);
          await fs.mkdir(path.join(box, "_config"), { recursive: true });
          await fs.mkdir(path.join(box, ".git", "annex"), { recursive: true });
          if (snapshotPaths.some((source) => source.endsWith(`/staging/${backupId}/secrets/box.json`))) {
            await fs.mkdir(path.dirname(secret), { recursive: true });
            await fs.writeFile(secret, "synthetic secret share");
          }
          await fs.writeFile(path.join(box, "package.json"), JSON.stringify({ dependencies: { beebox: "link:.beebox/engine" }, beebox: { shapeVersion: 3 } }));
          await fs.writeFile(path.join(box, "authored.txt"), "synthetic content");
        }
        return { stdout: "", stderr: "" };
      },
    },
    execa: { execa: async (_file: string, args: string[]) => {
      gitCalls.push(args);
      return { exitCode: gitExitCode, stderr: gitExitCode === 0 ? "" : "fatal: detected dubious ownership" };
    } },
  });

  const result = await restore({ repository: "synthetic-repo", passwordFile: "synthetic-password", target });

  t.check(result, {
    snapshotId: "verified-snapshot",
    boxPath: path.join(target, "box"),
    externalPath: path.join(target, "external"),
  });
  t.check(await fs.readFile(path.join(result.boxPath, "authored.txt"), "utf8"), "synthetic content");
  t.check(await fs.readFile(path.join(result.externalPath, "secrets/box.json"), "utf8"), "synthetic secret share");
  t.check(calls.map((args) => args.slice(0, 3)), [["restore", "verified-snapshot", "--target"]]);
  t.check(calls.map((args) => path.dirname(args[3] ?? "")), [target]);
  t.check(gitCalls, [
    ["-c", `safe.directory=${result.boxPath}`, "fsck", "--no-reflogs", "--connectivity-only"],
    ["-c", `safe.directory=${result.boxPath}`, "annex", "fsck"],
  ]);

  gitExitCode = 1;
  const validationFailureTarget = path.join(base, "validation-failure-recovery");
  let validationFailure: unknown;
  try {
    await restore({ repository: "synthetic-repo", passwordFile: "synthetic-password", target: validationFailureTarget });
  } catch (error) {
    validationFailure = error;
  }
  t.check(validationFailure, {
    name: "RestoreGitValidationError",
    message: `Git validation failed for restored box at ${path.join(validationFailureTarget, "box")}; recovered files are preserved for inspection: fatal: detected dubious ownership`,
  });
  t.check(await fs.readFile(path.join(validationFailureTarget, "box", "authored.txt"), "utf8"), "synthetic content");
  t.check(await fs.readFile(path.join(validationFailureTarget, "external", "secrets/box.json"), "utf8"), "synthetic secret share");

  gitExitCode = 0;
  snapshotPaths.splice(1);
  const missingShareTarget = path.join(base, "missing-share-recovery");
  let failure: unknown;
  try {
    await restore({ repository: "synthetic-repo", passwordFile: "synthetic-password", target: missingShareTarget });
  } catch (error) {
    failure = error;
  }
  t.check(failure, {
    name: "RestoreSecretShareNotFoundError",
    message: `verified snapshot ${backupId} does not contain its expected external secret share`,
  });
  t.check(await fs.readdir(missingShareTarget), []);
});
