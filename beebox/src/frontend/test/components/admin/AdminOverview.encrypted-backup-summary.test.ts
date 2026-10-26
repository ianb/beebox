// # Encrypted backup overview summary
//
// Keep the overview honest about first setup, stale verified snapshots, and
// an active host run without exposing the attempt's error text there.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import type { RouterOutput } from "../../../src/lib/trpc/client.js";
import { summarizeEncryptedBackup } from "../../../src/components/admin/AdminOverview/admin-overview-summaries.js";

type Status = RouterOutput["admin"]["encryptedBackupStatus"];
type ConfiguredStatus = Status & { configured: true; repository: string; retention: NonNullable<Status["retention"]> };
const base: ConfiguredStatus = {
  boxRoot: "/srv/box",
  boxSlug: "box",
  installKind: "local",
  configured: true,
  repository: "s3:safe-bucket/box",
  retention: { daily: 7, weekly: 4, monthly: 12 },
  schedule: "daily",
  newestVerified: null,
  lastAttempt: null,
  maintenance: null,
};

function status(overrides?: Partial<ConfiguredStatus>): ConfiguredStatus {
  return { ...base, ...overrides };
}

void test("summarizes encrypted backup lifecycle", async (t) => {
  const unconfigured: Status & { configured: false; repository: null; retention: null; schedule: "daily"; newestVerified: null; lastAttempt: null; maintenance: null } = {
    boxRoot: "/srv/box", boxSlug: "box", installKind: "local", configured: false,
    repository: null, retention: null, schedule: "daily", newestVerified: null, lastAttempt: null, maintenance: null,
  };
  t.check(summarizeEncryptedBackup(unconfigured), { state: "ready", summary: "Not configured", tone: "warning" });
  t.check(summarizeEncryptedBackup(status({})), { state: "ready", summary: "No local snapshot record; inspect repository", tone: "warning" });
  t.check(summarizeEncryptedBackup(status({ newestVerified: { snapshotId: "abc", verifiedAt: "2026-10-26T12:00:00.000Z" } })), { state: "ready", summary: "Verified snapshot available", tone: "success" });
  t.check(summarizeEncryptedBackup(status({
    newestVerified: { snapshotId: "abc", verifiedAt: "2026-10-26T12:00:00.000Z" },
    lastAttempt: { startedAt: "2026-10-26T12:00:00.000Z", completedAt: "2026-10-26T12:01:00.000Z", outcome: "failed", error: "safe summary" },
  })), { state: "ready", summary: "Last run failed; previous snapshot available", tone: "warning" });
  t.check(summarizeEncryptedBackup(status({ maintenance: "running" })), { state: "ready", summary: "Backup running", tone: "info" });
  t.check(summarizeEncryptedBackup(status({ schedule: "off" })), { state: "ready", summary: "Manual backups only", tone: "neutral" });
  t.check(summarizeEncryptedBackup(status({
    lastAttempt: { startedAt: "2026-10-26T12:00:00.000Z", completedAt: "2026-10-26T12:01:00.000Z", outcome: "failed", error: "Snapshot verified; retention could not be applied" },
    maintenance: "running",
  })), { state: "ready", summary: "Backup running", tone: "info" });
  t.check(summarizeEncryptedBackup(status({
    newestVerified: { snapshotId: "old", verifiedAt: "2000-01-01T00:00:00.000Z" },
  })), { state: "ready", summary: "Latest verified snapshot is over 36 hours old", tone: "warning" });
  t.check(summarizeEncryptedBackup(status({
    newestVerified: { snapshotId: "old", verifiedAt: "2000-01-01T00:00:00.000Z" },
    lastAttempt: { startedAt: "2026-10-26T12:00:00.000Z", completedAt: "2026-10-26T12:01:00.000Z", outcome: "failed", error: "Snapshot verified; retention could not be applied" },
  })), { state: "ready", summary: "Snapshot verified; retention failed", tone: "warning" });
});
