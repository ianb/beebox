// # Workstream cull records
//
// Removal captures the branch tip before moving the worktree away. The recorded
// SHA is sufficient to recreate the exact tree later, while a merged verdict is
// kept distinct from forced removal.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface Failure { code: number; stdout: string; stderr: string }
function isFailure(value: unknown): value is Failure {
  return typeof value === "object" && value !== null && "code" in value && "stdout" in value && "stderr" in value;
}
/** Await a command that must exit non-zero and return its exit code and output. */
async function expectFailure(attempt: Promise<unknown>): Promise<Failure> {
  try {
    await attempt;
  } catch (error) {
    if (isFailure(error)) return error;
    throw error;
  }
  throw new Error("expected the command to fail");
}
const repoRoot = resolve(process.cwd(), "..");
const teardownLib = join(repoRoot, "bin/lib/worktree-teardown.sh");

async function git(cwd: string, ...args: string[]) {
  return execFileAsync("git", args, { cwd });
}

// ## A merged removal records a recreatable final SHA
void test("A merged removal records a recreatable final SHA", async (t) => {
  t.teardown(async () => {
    try {
      await rm(root, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const root = await mkdtemp(join(tmpdir(), "workstream-cull-test-"));
  const mono = join(root, "mono");
  const worktreeRoot = join(root, "worktrees");
  const worktree = join(worktreeRoot, "cull-fixture");
  const stateDir = join(root, "state");
  await execFileAsync("mkdir", ["-p", mono, worktreeRoot]);
  await git(mono, "init", "-b", "main");
  await git(mono, "config", "user.email", "test@example.com");
  await git(mono, "config", "user.name", "Cull Test");
  await execFileAsync("bash", ["-c", 'printf content > "$1/file.txt"', "fixture", mono]);
  await git(mono, "add", "file.txt");
  await git(mono, "commit", "-m", "fixture");
  await git(mono, "worktree", "add", "-b", "worktree-cull-fixture", worktree, "main");
  const finalSha = (await git(worktree, "rev-parse", "HEAD")).stdout.trim();

  const removeScript = [
    '. "$1"',
    'WT_MONO="$2"',
    'WT_ROOT="$3"',
    'WT_BOX_ROOT="$4"',
    'WT_STATE_DIR="$5"',
    'WT_LOG_FILE="$5/worktree-cleanup.log"',
    "WT_AHEAD=0",
    "WT_DIRTY=0",
    'wt_remove_now "$6" worktree-cull-fixture',
  ].join("; ");
  await execFileAsync("bash", ["-c", removeScript, "cull-test", teardownLib, mono, worktreeRoot, join(root, "boxes"), stateDir, worktree]);
  const record = JSON.parse(await readFile(join(stateDir, "workstreams/cull-fixture.json"), "utf8"));
  t.check({ finalSha: record.removed.finalSha === finalSha, merged: record.removed.merged }, {
    finalSha: true,
    merged: true,
  });

  const recreated = join(worktreeRoot, "recreated");
  await git(mono, "worktree", "add", "-b", "worktree-recreated", recreated, record.removed.finalSha);
  t.check((await readFile(join(recreated, "file.txt"), "utf8")), "content");

  const dirty = join(worktreeRoot, "dirty-fixture");
  await git(mono, "worktree", "add", "-b", "worktree-dirty-fixture", dirty, "main");
  const dirtyScript = [
    '. "$1"',
    'WT_MONO="$2"',
    'WT_ROOT="$3"',
    'WT_BOX_ROOT="$4"',
    'WT_STATE_DIR="$5"',
    'WT_LOG_FILE="$5/worktree-cleanup.log"',
    "WT_AHEAD=0",
    "WT_DIRTY=1",
    'wt_remove_now "$6" worktree-dirty-fixture',
  ].join("; ");
  await execFileAsync("bash", ["-c", dirtyScript, "cull-test", teardownLib, mono, worktreeRoot, join(root, "boxes"), stateDir, dirty]);
  const dirtyRecord = JSON.parse(await readFile(join(stateDir, "workstreams/dirty-fixture.json"), "utf8"));
  t.check(dirtyRecord.removed.merged, false);
});

// ## Managed Claude has a cwd-independent liveness marker
//
// The managed `--name <workstream>` argument is a second signal in front of
// destructive sweep. It remains live even if the process cwd cannot be associated
// with the worktree; a longer neighboring name does not collide.
void test("The managed --name <workstream> argument is a second signal in front of destr...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(leaseStateDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const livenessScript = [
    '. "$1"',
    "WT_SNAP_STATE=ok",
    'WT_SNAP_ARGS="123 /usr/local/bin/claude --name seam --model opus"',
    'WT_SNAP_CWDS="/unrelated"',
    "wt_other_agent_live /tmp/seam",
    'printf "%s|%s" "$WT_AGENT_STATE" "$WT_AGENT_REASON"',
  ].join("; ");
  t.check((await execFileAsync("bash", ["-c", livenessScript, "liveness", teardownLib])).stdout, "live|signal=argv pid=123");

  const neighborScript = [
    '. "$1"',
    "WT_SNAP_STATE=ok",
    'WT_SNAP_ARGS="123 /usr/local/bin/claude --name seam-other --model opus"',
    'WT_SNAP_CWDS="/unrelated"',
    "wt_other_agent_live /tmp/seam",
    'printf "%s" "$WT_AGENT_STATE"',
  ].join("; ");
  t.check((await execFileAsync("bash", ["-c", neighborScript, "liveness", teardownLib])).stdout, "none");

  // ## A launch lease bridges the process-observation gap
  //
  // The existing process signals keep precedence. When they prove no agent exists,
  // an active registry lease reports `launching`; expired leases stop blocking and
  // malformed leases fail closed.

  const leaseStateDir = await mkdtemp(join(tmpdir(), "workstream-launch-lease-test-"));
  await execFileAsync("bash", ["-c", '. "$1"; session_registry_begin_launch seam token-a', "lease", join(repoRoot, "bin/lib/session-registry.sh")], {
    env: { ...process.env, BBX_STATE_DIR: leaseStateDir },
  });
  const launchLeaseScript = [
    '. "$1"',
    'WT_SNAP_STATE="no-agents"',
    "wt_other_agent_live /tmp/seam",
    'printf "%s|%s" "$WT_AGENT_STATE" "$WT_AGENT_REASON"',
  ].join("; ");
  t.check(
    (await execFileAsync("bash", ["-c", launchLeaseScript, "lease", teardownLib], {
      env: { ...process.env, BBX_STATE_DIR: leaseStateDir },
    })).stdout,
    "launching|signal=launch-lease",
  );

  const processWinsScript = [
    '. "$1"',
    'WT_SNAP_STATE="ok"',
    'WT_SNAP_ARGS="123 /usr/local/bin/claude --name seam --model opus"',
    'WT_SNAP_CWDS="/unrelated"',
    "wt_other_agent_live /tmp/seam",
    'printf "%s|%s" "$WT_AGENT_STATE" "$WT_AGENT_REASON"',
  ].join("; ");
  t.check(
    (await execFileAsync("bash", ["-c", processWinsScript, "lease", teardownLib], {
      env: { ...process.env, BBX_STATE_DIR: leaseStateDir },
    })).stdout,
    "live|signal=argv pid=123",
  );

  await execFileAsync("bash", ["-c", ". \"$1\"; session_registry_merge seam '{\"launch\":{\"token\":\"old\",\"startedAt\":\"2026-01-01T00:00:00Z\"}}'", "lease", join(repoRoot, "bin/lib/session-registry.sh")], {
    env: { ...process.env, BBX_STATE_DIR: leaseStateDir },
  });
  t.check(
    (await execFileAsync("bash", ["-c", launchLeaseScript, "lease", teardownLib], {
      env: { ...process.env, BBX_STATE_DIR: leaseStateDir },
    })).stdout,
    "none|launch=expired",
  );

  await execFileAsync("bash", ["-c", ". \"$1\"; session_registry_merge seam '{\"launch\":null}'; session_registry_merge seam '{\"launch\":{\"token\":\"broken\"}}'", "lease", join(repoRoot, "bin/lib/session-registry.sh")], {
    env: { ...process.env, BBX_STATE_DIR: leaseStateDir },
  });
  t.check(
    (await execFileAsync("bash", ["-c", launchLeaseScript, "lease", teardownLib], {
      env: { ...process.env, BBX_STATE_DIR: leaseStateDir },
    })).stdout,
    "unknown|invalid-launch-record",
  );
});

// ## A failed trash move preserves the registered worktree and branch
//
// Removal stops immediately when the worktree directory cannot move into trash.
// It must not prune the registration or delete the branch after that failure.
void test("Removal stops immediately when the worktree directory cannot move into trash.", async (t) => {
  t.teardown(async () => {
    try {
      await rm(failureRoot, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const failureRoot = await mkdtemp(join(tmpdir(), "workstream-cull-failure-test-"));
  const failureMono = join(failureRoot, "mono");
  const failureWorktree = join(failureRoot, "worktrees/failure-fixture");
  const failureState = join(failureRoot, "state");
  await execFileAsync("mkdir", ["-p", failureMono, join(failureRoot, "worktrees"), failureState]);
  await git(failureMono, "init", "-b", "main");
  await git(failureMono, "config", "user.email", "test@example.com");
  await git(failureMono, "config", "user.name", "Cull Test");
  await execFileAsync("bash", ["-c", 'printf content > "$1/file.txt"', "fixture", failureMono]);
  await git(failureMono, "add", "file.txt");
  await git(failureMono, "commit", "-m", "fixture");
  await git(failureMono, "worktree", "add", "-b", "worktree-failure-fixture", failureWorktree, "main");
  const failureScript = [
    '. "$1"',
    'WT_MONO="$2"',
    'WT_ROOT="$3"',
    'WT_BOX_ROOT="$4"',
    'WT_STATE_DIR="$5"',
    'WT_LOG_FILE="$5/worktree-cleanup.log"',
    "WT_AHEAD=0",
    "WT_DIRTY=0",
    'FAIL_PATH="$7"',
    'GIT_CALLS="$6/git-calls"',
    'mv() { if [ "$1" = "$FAIL_PATH" ]; then echo "simulated move failure" >&2; return 1; fi; command mv "$@"; }',
    'git() { if { [ "$1" = worktree ] && [ "$2" = prune ]; } || { [ "$1" = branch ] && [ "$2" = -D ]; }; then printf "%s %s\n" "$1" "$2" >> "$GIT_CALLS"; fi; command git "$@"; }',
    'wt_remove_now "$7" worktree-failure-fixture',
  ].join("; ");
  const failure = await expectFailure(execFileAsync("bash", ["-c", failureScript, "failure-test", teardownLib, failureMono, join(failureRoot, "worktrees"), join(failureRoot, "boxes"), failureState, failureRoot, failureWorktree])
    );
  const registered = (await git(failureMono, "worktree", "list", "--porcelain")).stdout.includes("branch refs/heads/worktree-failure-fixture");
  const branchExists = await git(failureMono, "show-ref", "--verify", "refs/heads/worktree-failure-fixture")
    .then(() => true, () => false);
  const cleanupCalls = await readFile(join(failureRoot, "git-calls"), "utf8").catch(() => "");
  t.check({ code: failure.code, registered, branchExists, cleanupSkipped: cleanupCalls === "", reported: failure.stdout.includes("refusing branch cleanup") }, {
    code: 1,
    registered: true,
    branchExists: true,
    cleanupSkipped: true,
    reported: true,
  });
});

// ## A removal keeps scratch/ work outside the trash
//
// scratch/ is gitignored, so the worktree trash-mv used to delete it silently.
// A removal moves scratch/'s contents, less the tracked README, to the
// kept-scratch root and names the path; a README-only scratch/ is not kept.
// When the move fails, removal refuses before any destructive step.
void test("A removal moves scratch/'s contents, less the tracked README, to the kept-scr...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(scratchRoot, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const scratchRoot = await mkdtemp(join(tmpdir(), "workstream-cull-scratch-test-"));
  const mono = join(scratchRoot, "mono");
  const worktrees = join(scratchRoot, "worktrees");
  const state = join(scratchRoot, "state");
  await execFileAsync("mkdir", ["-p", mono, worktrees, state]);
  await git(mono, "init", "-b", "main");
  await git(mono, "config", "user.email", "test@example.com");
  await git(mono, "config", "user.name", "Cull Test");
  await execFileAsync("bash", ["-c", 'mkdir -p "$1/scratch" && printf readme > "$1/scratch/README.md"', "fixture", mono]);
  await git(mono, "add", "scratch/README.md");
  await git(mono, "commit", "-m", "fixture");
  const removeScript = (branch: string, stub: string) => [
    '. "$1"',
    'WT_MONO="$2"',
    'WT_ROOT="$3"',
    'WT_BOX_ROOT="$4"',
    'WT_STATE_DIR="$5"',
    'WT_LOG_FILE="$5/worktree-cleanup.log"',
    'WT_SCRATCH_KEEP_ROOT="$5/culled-scratch"',
    "WT_AHEAD=0",
    "WT_DIRTY=0",
    stub,
    `wt_remove_now "$6" ${branch}`,
  ].filter((line) => line !== "").join("; ");
  const run = async (worktree: string, removal: { branch: string; stub?: string }) =>
    execFileAsync("bash", ["-c", removeScript(removal.branch, removal.stub ?? ""), "scratch-test", teardownLib, mono, worktrees, join(scratchRoot, "boxes"), state, worktree]);
  const listKept = async () =>
    (await execFileAsync("bash", ["-c", 'ls "$1" 2>/dev/null || true', "ls", join(state, "culled-scratch")])).stdout.split("\n").filter((line) => line !== "");

  const kept = join(worktrees, "kept-fixture");
  await git(mono, "worktree", "add", "-b", "worktree-kept-fixture", kept, "main");
  await execFileAsync("bash", ["-c", 'mkdir -p "$1/scratch/tools" && printf work > "$1/scratch/tools/build.ts"', "fixture", kept]);
  const keptRun = await run(kept, { branch: "worktree-kept-fixture" });
  const keptNames = await listKept();
  const keptName = keptNames[0] ?? "";
  const keptFile = await readFile(join(state, "culled-scratch", keptName, "tools/build.ts"), "utf8").catch(() => "(missing)");
  const keptReadme = await readFile(join(state, "culled-scratch", keptName, "README.md"), "utf8").then(() => true, () => false);
  t.check({
    names: keptNames.length,
    named: /^kept-fixture-\d{8}T\d{6}Z$/.test(keptName),
    file: keptFile,
    keptReadme,
    reported: keptRun.stdout.includes("kept scratch/") && keptRun.stdout.includes(join(state, "culled-scratch", keptName)),
  }, { names: 1, named: true, file: "work", keptReadme: false, reported: true });

  const readmeOnly = join(worktrees, "readme-fixture");
  await git(mono, "worktree", "add", "-b", "worktree-readme-fixture", readmeOnly, "main");
  const readmeRun = await run(readmeOnly, { branch: "worktree-readme-fixture" });
  t.check({ names: (await listKept()).length, reported: readmeRun.stdout.includes("kept scratch/") }, { names: 1, reported: false });

  const refused = join(worktrees, "refused-fixture");
  await git(mono, "worktree", "add", "-b", "worktree-refused-fixture", refused, "main");
  await execFileAsync("bash", ["-c", 'printf work > "$1/scratch/notes.md"', "fixture", refused]);
  const failure = await expectFailure(run(refused, {
    branch: "worktree-refused-fixture",
    stub: 'mv() { case "$1" in */scratch/*) echo "simulated move failure" >&2; return 1 ;; esac; command mv "$@"; }',
  }));
  const notes = await readFile(join(refused, "scratch/notes.md"), "utf8").catch(() => "(missing)");
  const branchExists = await git(mono, "show-ref", "--verify", "refs/heads/worktree-refused-fixture").then(() => true, () => false);
  t.check({ code: failure.code, notes, branchExists, reported: failure.stdout.includes("refusing removal: scratch/") }, {
    code: 1,
    notes: "work",
    branchExists: true,
    reported: true,
  });

  // Native WorktreeRemove keeps scratch/ without removing the checkout, which
  // Git then removes only if it is clean: the tracked README must stay.
  await execFileAsync("bash", ["-c", '. "$1"; WT_STATE_DIR="$2"; WT_LOG_FILE="$2/worktree-cleanup.log"; WT_SCRATCH_KEEP_ROOT="$2/culled-scratch"; wt_scratch_retain "$3" refused-fixture', "retain", teardownLib, state, refused]);
  t.check({
    status: (await git(refused, "status", "--porcelain", "--untracked-files=all")).stdout,
    notesLeft: await readFile(join(refused, "scratch/notes.md"), "utf8").then(() => true, () => false),
    kept: (await listKept()).length,
  }, { status: "", notesLeft: false, kept: 2 });
});

// ## Sweep expires kept scratch copies after the retention window
//
// A kept copy older than the window moves to the trash for the reaper; a newer
// one stays. Dry-run only lists.
void test("A kept copy older than the window moves to the trash for the reaper; a newer ...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(pruneRoot, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const pruneRoot = await mkdtemp(join(tmpdir(), "workstream-scratch-prune-test-"));
  const keepRoot = join(pruneRoot, "culled-scratch");
  await execFileAsync("mkdir", ["-p", join(keepRoot, "old-20260101T000000Z"), join(keepRoot, "new-20260101T000000Z")]);
  await execFileAsync("touch", ["-t", "202601010000", join(keepRoot, "old-20260101T000000Z")]);
  const pruneScript = (flag: string) => [
    '. "$1"',
    'WT_STATE_DIR="$2"',
    'WT_TRASH="$2/trash"',
    'WT_LOG_FILE="$2/worktree-cleanup.log"',
    'WT_SCRATCH_KEEP_ROOT="$2/culled-scratch"',
    `wt_scratch_prune ${flag}`,
    'ls "$2/culled-scratch"',
    'ls "$2/trash" 2>/dev/null || true',
  ].join("; ");
  const dry = (await execFileAsync("bash", ["-c", pruneScript("--dry-run"), "prune", teardownLib, pruneRoot])).stdout;
  t.check(dry, `expired kept scratch: ${keepRoot}/old-20260101T000000Z\nnew-20260101T000000Z\nold-20260101T000000Z\n`);
  const real = (await execFileAsync("bash", ["-c", pruneScript(""), "prune", teardownLib, pruneRoot])).stdout;
  t.check(real, `expired kept scratch: ${keepRoot}/old-20260101T000000Z\nnew-20260101T000000Z\nscratch-old-20260101T000000Z\n`);
});
