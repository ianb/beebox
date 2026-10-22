// # SessionStart workstream registry hook
//
// Launcher-started Claude sessions report main-derived cwd and transcript paths,
// so ancestor argv is the primary signal. Headless Claude processes must never
// replace an interactive session record.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), "..");
const hook = join(repoRoot, ".claude/hooks/session-start-registry.sh");

async function runHook(run: { stateDir: string; worktreeRoot: string; command: string; sessionId: string }) {
  const input = JSON.stringify({
    cwd: repoRoot,
    session_id: run.sessionId,
    transcript_path: join(tmpdir(), `${run.sessionId}.jsonl`),
    source: "startup",
  });
  return execFileAsync("bash", ["-c", 'printf "%s" "$1" | "$2"', "hook-test", input, hook], {
    env: {
      ...process.env,
      BBX_STATE_DIR: run.stateDir,
      BBX_WORKTREE_ROOT: run.worktreeRoot,
      SESSION_REGISTRY_TESTING: "1",
      SESSION_REGISTRY_TEST_ANCESTOR_COMMAND: run.command,
      SESSION_REGISTRY_TEST_ANCESTOR_TTY: "ttys099",
    },
  });
}

// ## Interactive ancestor wins over main cwd
void test("Interactive ancestor wins over main cwd", async (t) => {
  t.teardown(async () => {
    try {
      await rm(root, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const root = await mkdtemp(join(tmpdir(), "session-start-registry-test-"));
  const stateDir = join(root, "state");
  const worktreeRoot = join(root, "worktrees");
  await mkdir(join(worktreeRoot, "foo"), { recursive: true });
  await runHook({ stateDir, worktreeRoot, command: "claude --worktree foo --name test", sessionId: "interactive-id" });
  const record = JSON.parse(await readFile(join(stateDir, "workstreams/foo.json"), "utf8"));
  t.check({ sessionId: record.sessionId, tty: record.tty, agent: record.agent }, {
    sessionId: "interactive-id",
    tty: "/dev/ttys099",
    agent: "claude",
  });

  // ## Headless ancestor writes nothing

  await runHook({ stateDir, worktreeRoot, command: "claude -p --worktree bar", sessionId: "headless-id" });
  const headlessExists = await stat(join(stateDir, "workstreams/bar.json")).then(() => true, () => false);
  t.check(headlessExists, false);
});
