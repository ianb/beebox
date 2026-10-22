// # Box growth measurement and policy
//
// Box growth is sampled by the scheduler and persisted outside Git. The scanner
// counts content without following symlinks, attributes bounded subtree summaries,
// and keeps Git failure distinct from a zero-sized history.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import assert from "node:assert";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { makeTmpBox, useMarkerOnly } from "../../helpers/test-helpers.js";
import {
  boxGrowthStatePath,
  acknowledgeCurrentBoxGrowth,
  boxGrowthHealthCheck,
  evaluateBoxGrowth,
  expectCurrentBoxGrowthRates,
  measureBoxGrowth,
  measureBoxGrowthIfDue,
  readBoxGrowthState,
} from "../../../src/core/box-growth/health.js";
import type { GrowthMeasurement, SubtreeCounts } from "../../../src/core/box-growth/health.js";

const at = (iso: string) => new Date(iso);

// ## Tree counting, exclusions, attribution, and Git
//
// A fresh v3 box already carries the scaffolded skeleton (every underscore
// area, `src/`), so counts and subtree attribution are asserted as a delta
// against a baseline measured right after `makeTmpBox` — before this test adds
// anything of its own.
void test("A fresh v3 box already carries the scaffolded skeleton (every underscore area...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const baseline = await measureBoxGrowth(box.root, { now: at("2026-08-05T11:00:00Z") });

  await box.write("_content/inbox/email/thread/message.txt", "mail");
  await box.write("_content/chat/session/transcript.md", "chat");
  await box.write("_content/drive/folder/deep/document.md", "drive");
  await box.write("_content/drive/folder/deep/line\nbreak.md", "drive with newline");
  await box.write("_content/tmp-upload/image.jpg", "image");
  await box.write(".beebox/ignored.txt", "state");
  await fs.mkdir(box.path("node_modules/pkg"), { recursive: true });
  await fs.writeFile(box.path("node_modules/pkg/index.js"), "ignored");
  await fs.mkdir(box.path("_content/chat/session/node_modules/pkg"), { recursive: true });
  await fs.writeFile(box.path("_content/chat/session/node_modules/pkg/index.js"), "ignored nested dependency");
  await fs.mkdir(box.path("_content/chat/session/nested/.git/objects"), { recursive: true });
  await fs.writeFile(box.path("_content/chat/session/nested/.git/objects/object"), "ignored nested repo");
  await fs.symlink(box.path("_content/inbox"), box.path("box-link"));
  box.commitAll("seed growth fixture");

  const measured = await measureBoxGrowth(box.root, { now: at("2026-08-05T12:00:00Z") });

  // Connector subtrees always float to the ranked top regardless of size, so
  // they reliably survive the size cap below. Every other entry —
  // `_content/chat/session`, `_content/tmp-upload`, `box-link` — is the same size as
  // many of the skeleton's own "unknown" entries and can lose a ranking tie
  // against them, so only the connector paths are asserted here.
  assert(baseline.bytes.status === "available");
  const baselineFiles = new Map(baseline.largestSubtrees.map((item) => [item.path, item.files]));
  const connectorDelta = (p: string) => {
    const item = measured.largestSubtrees.find((i) => i.path === p);
    return { path: p, source: item?.source, files: item === undefined ? undefined : item.files - (baselineFiles.get(p) ?? 0) };
  };
  // Git hash, object counts and disk sizes vary between runs; engine bytes must have grown.
  // Git hash, object counts and disk sizes vary between runs; engine bytes must have grown.
  t.check(
    {
      directories: measured.counts.directories - baseline.counts.directories,
      files: measured.counts.files - baseline.counts.files,
      complete: measured.complete,
      history: measured.history,
      bytes: measured.bytes,
      connectors: ["_content/drive", "_content/inbox/email"].map(connectorDelta),
    },
    {
      directories: 7,
      files: 6,
      complete: true,
      history: {
        status: "available",
        gitHead: any(String),
        commits: 2,
        gitObjects: any(Number).positive(),
        gitBytes: any(Number).positive(),
      },
      bytes: {
        status: "available",
        contentBytes: any(Number).positive(),
        engineBytes: any(Number).between(baseline.bytes.engineBytes + 1, Infinity),
      },
      connectors: [
        { path: "_content/drive", source: "connector", files: 2 },
        { path: "_content/inbox/email", source: "connector", files: 1 },
      ],
    },
  );
  t.check(measured.largestSubtrees.slice(20), []);
});

// ## Hourly and connector-weighted policy; size alone is never a finding
void test("Hourly and connector-weighted policy; size alone is never a finding", async (t) => {
  const emailSubtree: SubtreeCounts = { path: "_content/inbox/email", directories: 20, files: 20, source: "connector", sourceLabel: "Gmail" };
  const base: GrowthMeasurement = {
    measuredAt: "2026-08-05T12:00:00.000Z",
    complete: true,
    filesystemError: null,
    skippedDirectories: 0,
    counts: { directories: 100, files: 100 },
    history: { status: "available", gitHead: "a", commits: 10, gitObjects: 20, gitBytes: 30 },
    bytes: { status: "unavailable", error: "not measured" },
    largestSubtrees: [emailSubtree],
  };
  const fast: GrowthMeasurement = {
    ...base,
    measuredAt: "2026-08-05T13:00:00.000Z",
    counts: { directories: 210, files: 210 },
    history: { status: "available", gitHead: "a", commits: 111, gitObjects: 20, gitBytes: 30 },
    largestSubtrees: [{ ...emailSubtree, directories: 121, files: 121 }],
  };
  const findings = evaluateBoxGrowth({ previous: base, current: fast });
  t.check(findings, [
    { kind: "rate-directories", path: "_content/inbox/email", actual: 110, threshold: 10 },
    { kind: "rate-files", path: "_content/inbox/email", actual: 110, threshold: 25 },
    { kind: "rate-commits", actual: 101, threshold: 10 },
    { kind: "rate-connector-directories", path: "_content/inbox/email", actual: 101, threshold: 5 },
    { kind: "rate-connector-files", path: "_content/inbox/email", actual: 101, threshold: 10 },
  ]);

  // Disk use warns on rate too, for box content and for `.beebox` separately.
  // A measurement without bytes (an old state file, a failed `du`) has no byte
  // finding:

  const MB = 1024 * 1024;
  const sized: GrowthMeasurement = { ...base, bytes: { status: "available", contentBytes: 400 * MB, engineBytes: 200 * MB } };
  const indexBlewUp: GrowthMeasurement = { ...sized, measuredAt: "2026-08-05T13:00:00.000Z", bytes: { status: "available", contentBytes: 402 * MB, engineBytes: 365 * MB } };
  t.check(evaluateBoxGrowth({ previous: sized, current: indexBlewUp }), [
    { kind: "rate-engine-bytes", actual: 165 * MB, threshold: 100 * MB },
  ]);

  t.check(evaluateBoxGrowth({ previous: base, current: indexBlewUp }), []);

  // A box is never warned about for being large. One Gmail account with a few
  // hundred archived threads holds thousands of files and directories, and a
  // fixed level warned about it permanently while saying nothing useful. A large
  // box growing slowly has no finding:

  const large: GrowthMeasurement = { ...base, counts: { directories: 1_800, files: 3_500 } };
  const slightlyLarger: GrowthMeasurement = { ...large, measuredAt: "2026-08-05T13:00:00.000Z", counts: { directories: 1_801, files: 3_502 } };
  t.check(evaluateBoxGrowth({ previous: large, current: slightlyLarger }), []);

  const enteredTopTwenty: GrowthMeasurement = { ...fast, largestSubtrees: [{ ...emailSubtree, directories: 121, files: 121, path: "_content/drive" }] };
  t.check(evaluateBoxGrowth({ previous: base, current: enteredTopTwenty }), [
    { kind: "rate-directories", path: "_content/drive", actual: 110, threshold: 10 },
    { kind: "rate-files", path: "_content/drive", actual: 110, threshold: 25 },
    { kind: "rate-commits", actual: 101, threshold: 10 },
    { kind: "rate-connector-directories", path: "_content/drive", actual: 121, threshold: 5 },
    { kind: "rate-connector-files", path: "_content/drive", actual: 121, threshold: 10 },
  ]);

  const newImport: GrowthMeasurement = {
    ...fast,
    counts: { directories: 100, files: 600 },
    largestSubtrees: [{
      path: "store/import-2026/batch1",
      directories: 0,
      files: 500,
      source: "unknown",
      sourceLabel: null,
    }],
  };
  t.check(evaluateBoxGrowth({ previous: base, current: newImport }), [
    { kind: "rate-files", path: "store/import-2026/batch1", actual: 500, threshold: 25 },
    { kind: "rate-commits", actual: 101, threshold: 10 },
  ]);

  const partial: GrowthMeasurement = { ...fast, complete: false };
  t.check(evaluateBoxGrowth({ previous: base, current: partial }), []);
});

// ## Box-shape failure degrades only Git history
void test("Box-shape failure degrades only Git history", async (t) => {
  t.teardown(async () => {
    try {
      await badShape.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const badShape = await makeTmpBox();
  const badShapeBaseline = await measureBoxGrowth(badShape.root, { now: at("2026-08-05T11:00:00Z") });
  await badShape.write("plain.txt", "content");
  await useMarkerOnly(badShape.root, JSON.stringify({ shapeVersion: 1 }));
  const badShapeMeasurement = await measureBoxGrowth(badShape.root, {
    now: at("2026-08-05T12:00:00Z"),
  });
  t.check({ files: badShapeMeasurement.counts.files - badShapeBaseline.counts.files, history: badShapeMeasurement.history },
    {
      files: 1,
      history: {
        status: "unavailable",
        error: str`Box at ${badShape.root} declares shapeVersion 1. This box predates the one-root layout (shapeVersion 3) and cannot be opened. The v2-to-v3 conversion has been removed — no box was left on that shape. See docs/box-layout.md.`,
      },
    });
});

// ## Persisted baseline, due interval, acknowledgement, and health
//
// The first scan establishes a baseline. A second call inside the hour is skipped;
// after a growth warning, accepting the current size re-baselines all three
// measurements and removes the action.
void test("The first scan establishes a baseline.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const first = await measureBoxGrowthIfDue(box.root, { now: at("2026-08-05T12:00:00Z") });
  // The measurement state holds the scaffolded skeleton's counts, git hashes and
  // disk sizes, so these check the outcome fields of each result.
  const skipped = await measureBoxGrowthIfDue(box.root, { now: at("2026-08-05T12:30:00Z") });
  t.check(
    { first: first.status, skipped: skipped.status, skippedReason: skipped.status === "skipped" ? skipped.reason : undefined },
    { first: "measured", skipped: "skipped", skippedReason: "not-due" },
  );

  const state = await readBoxGrowthState(box.root);
  t.check(state.status, "measured");
  t.check(path.relative(box.root, boxGrowthStatePath(box.root)), ".beebox/box-growth-health.json");
  await fs.unlink(boxGrowthStatePath(box.root));
  const missingBackoff = await measureBoxGrowthIfDue(box.root, {
    now: at("2026-08-05T12:31:00Z"),
    maxDurationMs: 0,
  });
  t.check(missingBackoff, { status: "skipped", reason: "not-due", state: { status: "missing" } });

  await box.write("_content/inbox/email/new/message.txt", "mail");
  const replacement = await measureBoxGrowthIfDue(box.root, { now: at("2026-08-05T13:00:00Z") });
  const NOTICE = "Box growth state disappeared after this scheduler previously measured the box; a new baseline was created";
  t.check(
    { status: replacement.status, notice: replacement.status === "measured" ? replacement.notice : undefined },
    { status: "measured", notice: NOTICE },
  );
  const followup = await measureBoxGrowthIfDue(box.root, { now: at("2026-08-05T14:00:00Z") });
  t.check(
    {
      status: followup.status,
      notice: followup.status === "measured" ? followup.notice : undefined,
      lastNotice: followup.status === "measured" && followup.state.status === "measured" ? followup.state.lastNotice : undefined,
    },
    { status: "measured", notice: null, lastNotice: NOTICE },
  );
  const replacementHealth = await boxGrowthHealthCheck(box.root, {
    now: at("2026-08-05T14:00:00Z"),
    schedulerStatus: "running",
  });
  t.check(replacementHealth, {
    name: "box-growth",
    ok: false,
    message: `Box growth warning: ${NOTICE}`,
    severity: "warning",
    actions: ["acknowledge-box-growth"],
  });
  const accepted = await acknowledgeCurrentBoxGrowth(box.root);
  assert(accepted.status === "measured");
  t.check(
    { previousIsCurrent: accepted.previous, rateExpectations: accepted.rateExpectations },
    { previousIsCurrent: accepted.current, rateExpectations: [] },
  );
  const health = await boxGrowthHealthCheck(box.root, { now: at("2026-08-05T14:01:00Z"), schedulerStatus: "running" });
  t.check(health, { name: "box-growth", ok: true, message: "Box growth is within accepted limits", severity: "warning" });
});

// ## Corrupt state and failed scan stay visible
void test("Corrupt state and failed scan stay visible", async (t) => {
  t.teardown(async () => {
    try {
      await corrupt.cleanup();
      await failedBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const corrupt = await makeTmpBox();
  await fs.mkdir(path.dirname(boxGrowthStatePath(corrupt.root)), { recursive: true });
  await fs.writeFile(boxGrowthStatePath(corrupt.root), "not json");
  const corruptHealth = await boxGrowthHealthCheck(corrupt.root, {
    now: at("2026-08-05T12:00:00Z"),
    schedulerStatus: "running",
  });
  t.check(corruptHealth, {
    name: "box-growth",
    ok: false,
    message: "Invalid growth state JSON: Unexpected token 'o', \"not json\" is not valid JSON",
    severity: "warning",
  });

  const invalidAttempt = await measureBoxGrowthIfDue(corrupt.root, {
    now: at("2026-08-05T13:00:00Z"),
  });
  t.check(invalidAttempt, {
    status: "skipped",
    reason: "invalid-state",
    state: { status: "invalid", error: "Invalid growth state JSON: Unexpected token 'o', \"not json\" is not valid JSON" },
  });

  const failedBox = await makeTmpBox();
  const failed = await measureBoxGrowthIfDue(failedBox.root, {
    now: at("2026-08-05T13:00:00Z"),
    maxDurationMs: 0,
  });
  t.check(failed.status, "measured");
  const failedState = await readBoxGrowthState(failedBox.root);
  assert(failedState.status === "measured");
  t.check(failedState.current, {
    measuredAt: "2026-08-05T13:00:00.000Z",
    complete: false,
    filesystemError: "Box growth scan exceeded its time budget",
    counts: { directories: 0, files: 0 },
    skippedDirectories: 0,
    largestSubtrees: [],
    history: { status: "unavailable", error: "Git history was not measured because the filesystem scan was incomplete" },
    bytes: { status: "unavailable", error: "Disk use was not measured because the filesystem scan was incomplete" },
  });
});

// A traversal error also retains whatever the native walker reported instead of
// discarding the sample.
void test("A traversal error also retains whatever the native walker reported instead of...", async (t) => {
  const vanished = await makeTmpBox();
  const vanishedRoot = vanished.root;
  await vanished.cleanup();
  const vanishedMeasurement = await measureBoxGrowth(vanishedRoot, {
    now: at("2026-08-05T13:00:00Z"),
  });
  t.check(vanishedMeasurement, {
    measuredAt: "2026-08-05T13:00:00.000Z",
    complete: false,
    filesystemError: str`find failed: find: ${vanishedRoot}: No such file or directory`,
    counts: { directories: 0, files: 0 },
    skippedDirectories: 0,
    largestSubtrees: [],
    history: { status: "unavailable", error: "Git history was not measured because the filesystem scan was incomplete" },
    bytes: { status: "unavailable", error: "Disk use was not measured because the filesystem scan was incomplete" },
  });
});

// ## Missing and stale scheduler state stay explicit
//
// No scheduler heartbeat is normal for a local box. Once a scheduler is active,
// missing state is a warning rather than a silent pass.
void test("No scheduler heartbeat is normal for a local box.", async (t) => {
  t.teardown(async () => {
    try {
      await missing.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const missing = await makeTmpBox();
  const localHealth = await boxGrowthHealthCheck(missing.root, {
    now: at("2026-08-05T12:00:00Z"),
    schedulerStatus: "never",
  });
  const scheduledHealth = await boxGrowthHealthCheck(missing.root, {
    now: at("2026-08-05T12:00:00Z"),
    schedulerStatus: "running",
  });
  t.check({ local: localHealth, scheduled: scheduledHealth }, {
    local: { name: "box-growth", ok: true, message: "Box growth monitoring has never run", severity: "warning" },
    scheduled: { name: "box-growth", ok: false, message: "Box growth monitoring has not published a measurement", severity: "warning" },
  });
});

// A state file written before level findings were removed still carries
// `accepted` and `acknowledgedAt: null`, which used to pin a permanent warning
// on a large box. It now reads as healthy; the extra keys are dropped.
void test("A state file written before level findings were removed still carries accepte...", async (t) => {
  // That state predates disk-use measurement, so the green result says bytes were
  // not checked rather than implying they were. The next hourly measurement
  // records them.
  t.teardown(async () => {
    try {
      await warningBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const warningBox = await makeTmpBox();
  const warningMeasurement = {
    measuredAt: "2026-08-05T12:00:00.000Z",
    complete: true,
    counts: { directories: 20_000, files: 1_000 },
    history: { status: "available", gitHead: "head", commits: 10, gitObjects: 20, gitBytes: 30 },
    largestSubtrees: [{ path: "_content/inbox/email", directories: 19_000, files: 900, source: "connector", sourceLabel: "Gmail" }],
  };
  await fs.mkdir(path.dirname(boxGrowthStatePath(warningBox.root)), { recursive: true });
  await fs.writeFile(boxGrowthStatePath(warningBox.root), JSON.stringify({
    version: 1,
    status: "measured",
    accepted: warningMeasurement,
    previous: warningMeasurement,
    current: warningMeasurement,
    acknowledgedAt: null,
    lastAttemptAt: warningMeasurement.measuredAt,
    lastError: null,
  }));
  const warningHealth = await boxGrowthHealthCheck(warningBox.root, {
    now: at("2026-08-05T12:01:00Z"),
    schedulerStatus: "running",
  });
  t.check(warningHealth, {
    name: "box-growth",
    ok: true,
    message: "Box growth is within accepted limits; not measured: disk use (not measured)",
    severity: "warning",
  });
  const rewritten = await readBoxGrowthState(warningBox.root);
  // The rewritten state holds the whole measurement; the contract here is that the stale key is gone.
  t.check(
    { status: rewritten.status, hasAcknowledgedAt: "acknowledgedAt" in rewritten },
    { status: "measured", hasAcknowledgedAt: false },
  );
});

// Independent connector growth never hides a larger box-wide producer.
void test("Independent connector growth never hides a larger box-wide producer.", async (t) => {
  t.teardown(async () => {
    try {
      await mixedBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const mixedBox = await makeTmpBox();
  const mixedPrevious = {
    measuredAt: "2026-08-05T12:00:00.000Z",
    counts: { directories: 100, files: 100 },
    history: { status: "available", gitHead: "old", commits: 1, gitObjects: 1, gitBytes: 1 },
    largestSubtrees: [
      { path: "_content/inbox/email", directories: 10, files: 20, source: "connector", sourceLabel: "Gmail" },
      { path: "store/junk", directories: 0, files: 0, source: "unknown", sourceLabel: null },
    ],
  };
  const mixedCurrent = {
    ...mixedPrevious,
    measuredAt: "2026-08-05T13:00:00.000Z",
    counts: { directories: 100, files: 700 },
    largestSubtrees: [
      { ...mixedPrevious.largestSubtrees[0], files: 120 },
      { ...mixedPrevious.largestSubtrees[1], files: 500 },
    ],
  };
  await fs.mkdir(path.dirname(boxGrowthStatePath(mixedBox.root)), { recursive: true });
  await fs.writeFile(boxGrowthStatePath(mixedBox.root), JSON.stringify({
    version: 1,
    status: "measured",
    previous: mixedPrevious,
    current: mixedCurrent,
    lastAttemptAt: mixedCurrent.measuredAt,
    lastError: null,
    lastNotice: null,
  }));
  const mixedHealth = await boxGrowthHealthCheck(mixedBox.root, {
    now: at("2026-08-05T13:01:00Z"),
    schedulerStatus: "running",
  });
  t.check(mixedHealth, {
    name: "box-growth",
    ok: false,
    message: "Box growth warning: box grew by 600 files/hour (limit 25); fastest subtree: store/junk; _content/inbox/email grew by 100 files/hour (limit 10); disk use measurement failed: not measured",
    severity: "warning",
    actions: ["acknowledge-box-growth", "expect-box-growth-rates"],
  });
  const expectedRates = await expectCurrentBoxGrowthRates(mixedBox.root, {
    now: at("2026-08-05T13:01:00Z"),
  });
  assert(expectedRates.status === "measured");
  t.check(expectedRates.rateExpectations, [
    { kind: "rate-files", path: null, thresholdPerHour: 900, setAt: "2026-08-05T13:01:00.000Z" },
    { kind: "rate-connector-files", path: "_content/inbox/email", thresholdPerHour: 150, setAt: "2026-08-05T13:01:00.000Z" },
  ]);
  const repeatedCurrent: GrowthMeasurement = {
    ...expectedRates.current,
    measuredAt: "2026-08-05T14:00:00.000Z",
    counts: { directories: 100, files: 1_300 },
    largestSubtrees: [
      { path: "_content/inbox/email", directories: 10, files: 220, source: "connector", sourceLabel: "Gmail" },
      { path: "store/junk", directories: 0, files: 1_000, source: "unknown", sourceLabel: null },
    ],
  };
  t.check(evaluateBoxGrowth({
    ...expectedRates,
    previous: expectedRates.current,
    current: repeatedCurrent,
  }), []);
});

// Git history failure is reported as degraded measurement detail, not as box
// growth, when the filesystem counters remain healthy.
void test("Git history failure is reported as degraded measurement detail, not as box gr...", async (t) => {
  t.teardown(async () => {
    try {
      await noGitBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const noGitBox = await makeTmpBox({ git: "none" });
  const noGitMeasurement = {
    measuredAt: "2026-08-05T12:00:00.000Z",
    counts: { directories: 10, files: 20 },
    history: { status: "unavailable", error: "not a Git repository" },
    bytes: { status: "available", contentBytes: 4096, engineBytes: 0 },
    largestSubtrees: [],
  };
  await fs.mkdir(path.dirname(boxGrowthStatePath(noGitBox.root)), { recursive: true });
  await fs.writeFile(boxGrowthStatePath(noGitBox.root), JSON.stringify({
    version: 1,
    status: "measured",
    previous: noGitMeasurement,
    current: noGitMeasurement,
    lastAttemptAt: noGitMeasurement.measuredAt,
    lastError: null,
    lastNotice: null,
  }));
  const noGitHealth = await boxGrowthHealthCheck(noGitBox.root, {
    now: at("2026-08-05T12:01:00Z"),
    schedulerStatus: "running",
  });
  t.check(noGitHealth, {
    name: "box-growth",
    ok: true,
    message: "Box growth is within accepted limits; not measured: Git history",
    severity: "warning",
  });
});
