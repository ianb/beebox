// Retention cleanup removes only this box's old incomplete snapshots.
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { expiredUnverifiedSnapshotIds } from "../../../src/core/box-backup/retention.js";

void test("expired incomplete snapshots exclude verified and unrelated snapshots", async (t) => {
  const backupId = "box-identity";
  const snapshots = [
    { id: "old-unverified", time: "2026-10-01T00:00:00.000Z", host: backupId, paths: [], tags: [`bbx-backup:${backupId}`] },
    { id: "old-verified", time: "2026-10-01T00:00:00.000Z", host: backupId, paths: [], tags: [`bbx-backup:${backupId}`, "verified"] },
    { id: "other-box", time: "2026-10-01T00:00:00.000Z", host: "other", paths: [], tags: ["bbx-backup:other"] },
    { id: "recent-unverified", time: "2026-10-25T00:00:00.000Z", host: backupId, paths: [], tags: [`bbx-backup:${backupId}`] },
  ];
  await t.check(expiredUnverifiedSnapshotIds({ snapshots, backupId, now: Date.parse("2026-10-26T00:00:00.000Z") }), ["old-unverified"]);
});
