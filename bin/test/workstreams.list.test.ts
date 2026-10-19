// # Workstream list registry projection
//
// In-flight and failed launch records are visible before a worktree exists.
// Removed workstreams remain opt-in ghost rows, and every registry-only shape
// makes absence explicit.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), "..");
const workstreams = join(repoRoot, "bin/workstreams");

async function list(stateDir: string, options: { worktreeRoot: string; includeRemoved: boolean }) {
  const args = ["list", "--json"];
  if (options.includeRemoved) args.push("--include-removed");
  const result = await execFileAsync(workstreams, args, {
    env: {
      ...process.env,
      BBX_BOX_ROOT: join(stateDir, "boxes"),
      BBX_STATE_DIR: stateDir,
      BBX_WORKTREE_ROOT: options.worktreeRoot,
    },
  });
  return JSON.parse(result.stdout);
}

async function listResult(stateDir: string, worktreeRoot: string) {
  return execFileAsync(workstreams, ["list", "--json"], {
    env: { ...process.env, BBX_BOX_ROOT: join(stateDir, "boxes"), BBX_STATE_DIR: stateDir, BBX_WORKTREE_ROOT: worktreeRoot },
  });
}

// ## Removed records appear only when requested
void test("Removed records appear only when requested", async (t) => {
  t.teardown(async () => {
    try {
      await rm(root, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const root = await mkdtemp(join(tmpdir(), "workstream-list-doctest-"));
  const stateDir = join(root, "state");
  const worktreeRoot = join(root, "worktrees");
  await mkdir(join(stateDir, "workstreams"), { recursive: true });
  await mkdir(worktreeRoot, { recursive: true });
  await writeFile(join(stateDir, "workstreams/culled.json"), JSON.stringify({
    name: "culled",
    branch: "worktree-culled",
    agent: "claude",
    sessionId: "session-id",
    updatedAt: "2026-08-09T00:00:00Z",
    removed: { at: "2026-08-09T00:00:00Z", finalSha: "abc", merged: true },
  }));
  const pendingStartedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  // The launch lease lasts one hour.
  const pendingExpiresAt = new Date(Date.parse(pendingStartedAt) + 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  await writeFile(join(stateDir, "workstreams/pending-launch.json"), JSON.stringify({
    name: "pending-launch",
    branch: "worktree-pending-launch",
    launch: { token: "pending-token", startedAt: pendingStartedAt },
  }));
  await writeFile(join(stateDir, "workstreams/expired-launch.json"), JSON.stringify({
    name: "expired-launch",
    branch: "worktree-expired-launch",
    launch: { token: "expired-token", startedAt: "2026-01-01T00:00:00Z" },
  }));
  const ordinary = await list(stateDir, { worktreeRoot, includeRemoved: false });
  const launchRows = [
    {
      name: "expired-launch",
      branch: "worktree-expired-launch",
      path: null,
      box: null,
      url: null,
      git: null,
      runtime: { state: "absent" },
      agent: { state: "none", reason: "launch=expired" },
      session: {
        agent: null,
        hasSession: false,
        tty: null,
        baseSha: null,
        removed: null,
        archived: null,
        description: null,
        launch: {
          state: "expired",
          startedAt: "2026-01-01T00:00:00Z",
          expiresAt: "2026-01-01T01:00:00Z",
          failedAt: null,
          reason: "launch-lease-expired",
        },
      },
      routing: { state: "uncertain", action: "investigate", lastActivityAt: null },
      boxState: { testSetup: false, keepUnmerged: false, pristine: null },
      schedule: null,
    },
    {
      name: "pending-launch",
      branch: "worktree-pending-launch",
      path: null,
      box: null,
      url: null,
      git: null,
      runtime: { state: "absent" },
      agent: { state: "launching", reason: "signal=launch-lease" },
      session: {
        agent: null,
        hasSession: false,
        tty: null,
        baseSha: null,
        removed: null,
        archived: null,
        description: null,
        launch: {
          state: "active",
          startedAt: pendingStartedAt,
          expiresAt: pendingExpiresAt,
          failedAt: null,
          reason: null,
        },
      },
      routing: { state: "launching", action: "wait-for-launch", lastActivityAt: null },
      boxState: { testSetup: false, keepUnmerged: false, pristine: null },
      schedule: null,
    },
  ];
  t.check(ordinary, launchRows);

  const rows = await list(stateDir, { worktreeRoot, includeRemoved: true });
  t.check(rows.find((row: { name: string }) => row.name === "culled"), {
    name: "culled",
    branch: "worktree-culled",
    path: null,
    box: null,
    url: null,
    git: null,
    runtime: {
      state: "absent",
    },
    agent: {
      state: "none",
      reason: "no-worktree",
    },
    session: {
      agent: "claude",
      hasSession: true,
      tty: null,
      baseSha: null,
      removed: {
        at: "2026-08-09T00:00:00Z",
        finalSha: "abc",
        merged: true,
      },
      archived: null,
      description: null,
      launch: {
        state: "none",
        startedAt: null,
        expiresAt: null,
        failedAt: null,
        reason: null,
      },
    },
    routing: {
      state: "removed",
      action: "resume-with-briefing",
      lastActivityAt: "2026-08-09T00:00:00Z",
    },
    boxState: {
      testSetup: false,
      keepUnmerged: false,
      pristine: null,
    },
    schedule: null,
  });

  // ## Stray directories are visible anomalies, not rows

  await mkdir(join(worktreeRoot, "scratch"));
  const stray = await listResult(stateDir, worktreeRoot);
  t.check({ rows: JSON.parse(stray.stdout), stderr: stray.stderr }, {
    rows: launchRows,
    stderr: `workstreams list: ignoring non-worktree directory: ${join(worktreeRoot, "scratch")}\n`,
  });
});
