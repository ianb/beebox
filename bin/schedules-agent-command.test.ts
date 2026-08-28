/**
 * Track B chunk 2: the agent command `bin/lib/launch-headless.sh` assembles —
 * the sandbox, the prompt file, the session mode, and what it refuses.
 *
 *   node --import tsx --test bin/schedules-agent-command.test.ts
 *
 * Split out of bin/schedules.test.ts; fixtures are bin/schedules-test-support.ts.
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";
import * as path from "node:path";
import { execa } from "execa";

import { REPO, cleanupTempDirs, useTempRegistryStateDir } from "./schedules-test-support.js";

after(cleanupTempDirs);
await useTempRegistryStateDir();

const LAUNCH_HEADLESS = path.join(import.meta.dirname, "lib", "launch-headless.sh");

/** The agent command as the one shell library assembles it. */
async function headlessArgv(env: NodeJS.ProcessEnv): Promise<{ exitCode: number; argv: string[]; stderr: string }> {
  const result = await execa(LAUNCH_HEADLESS, [], { reject: false, env: { ...process.env, ...env } });
  return {
    exitCode: result.exitCode ?? -1,
    argv: result.stdout.split("\n").filter((line) => line !== ""),
    stderr: result.stderr,
  };
}

const CLAUDE_ENV = {
  LH_AGENT: "claude",
  LH_WORKSTREAM: "knip-sweep",
  LH_MODEL: "opus",
  LH_PERMISSION_MODE: "dontAsk",
  LH_SYSTEM_PROMPT_FILE: path.join(REPO, "package.json"),
  LH_SESSION: "fresh",
};

test("the claude command carries the sandbox, the prompt file, and a fresh session", async () => {
  const built = await headlessArgv({
    ...CLAUDE_ENV,
    LH_TOOLS: "Read\nGrep\nEdit",
    LH_ALLOWED_TOOLS: "Edit(issues/**)\nRead(bin/**)",
    LH_DISALLOWED_TOOLS: "Read(private-issues/**)",
    LH_MAX_BUDGET_USD: "2",
  });
  assert.equal(built.exitCode, 0, built.stderr);
  assert.deepEqual(built.argv, [
    "claude", "-p", "--brief", "--name", "knip-sweep", "--model", "opus",
    "--permission-mode", "dontAsk", "--setting-sources", "user", "--disable-slash-commands",
    "--append-system-prompt-file", path.join(REPO, "package.json"),
    "--tools", "Read", "Grep", "Edit",
    "--allowedTools", "Edit(issues/**)", "Read(bin/**)",
    "--disallowedTools", "Read(private-issues/**)",
    "--max-budget-usd", "2",
    "--no-session-persistence",
  ]);
});

test("effort rides the claude command and is refused for codex", async () => {
  const built = await headlessArgv({ ...CLAUDE_ENV, LH_EFFORT: "high" });
  assert.equal(built.exitCode, 0, built.stderr);
  assert.deepEqual(built.argv.slice(0, 9), [
    "claude", "-p", "--brief", "--name", "knip-sweep", "--model", "opus", "--effort", "high",
  ]);
  // Absent means absent: the CLI's own default is what an unstated effort means.
  const bare = await headlessArgv({ ...CLAUDE_ENV, LH_EFFORT: "" });
  assert.equal(bare.argv.includes("--effort"), false);

  const codex = await headlessArgv({
    LH_AGENT: "codex", LH_WORKSTREAM: "sdk-update", LH_PERMISSION_MODE: "dontAsk",
    LH_SESSION: "fresh", LH_CWD: "/tmp/wt", LH_EFFORT: "max",
  });
  assert.notEqual(codex.exitCode, 0);
  assert.match(codex.stderr, /no equivalent for: effort/u);
});

test("a persistent claude session mints an id on the first run and resumes it afterwards", async () => {
  const first = await headlessArgv({ ...CLAUDE_ENV, LH_SESSION: "persistent", LH_SESSION_ID: "abc-123", LH_SESSION_RESUME: "0" });
  assert.deepEqual(first.argv.slice(-2), ["--session-id", "abc-123"]);
  const later = await headlessArgv({ ...CLAUDE_ENV, LH_SESSION: "persistent", LH_SESSION_ID: "abc-123", LH_SESSION_RESUME: "1" });
  assert.deepEqual(later.argv.slice(-2), ["--resume", "abc-123"]);
  const refused = await headlessArgv({ ...CLAUDE_ENV, LH_SESSION: "persistent" });
  assert.notEqual(refused.exitCode, 0);
  assert.match(refused.stderr, /LH_SESSION_ID is required/u);
});

test("the codex command maps the sandbox and refuses constraints it cannot honor", async () => {
  const bypass = await headlessArgv({
    LH_AGENT: "codex", LH_WORKSTREAM: "sdk-update", LH_MODEL: "gpt-5.6-sol",
    LH_PERMISSION_MODE: "bypassPermissions", LH_SESSION: "fresh", LH_CWD: "/tmp/wt",
  });
  assert.equal(bypass.exitCode, 0, bypass.stderr);
  assert.deepEqual(bypass.argv, [
    "codex", "exec", "-s", "danger-full-access",
    "-c", 'projects."/tmp/wt".trust_level="trusted"', "-c", "project_doc_max_bytes=131072",
    "-m", "gpt-5.6-sol",
  ]);

  const resumed = await headlessArgv({
    LH_AGENT: "codex", LH_WORKSTREAM: "sdk-update", LH_PERMISSION_MODE: "dontAsk",
    LH_SESSION: "persistent", LH_SESSION_RESUME: "1", LH_CWD: "/tmp/wt",
  });
  assert.deepEqual(resumed.argv.slice(0, 6), ["codex", "exec", "resume", "--last", "-s", "workspace-write"]);

  // A declared sandbox codex cannot express is a refusal, never a silently
  // unconstrained agent.
  const constrained = await headlessArgv({
    LH_AGENT: "codex", LH_WORKSTREAM: "sdk-update", LH_PERMISSION_MODE: "dontAsk",
    LH_SESSION: "fresh", LH_CWD: "/tmp/wt", LH_ALLOWED_TOOLS: "Edit(issues/**)", LH_MAX_BUDGET_USD: "2",
  });
  assert.notEqual(constrained.exitCode, 0);
  assert.match(constrained.stderr, /no equivalent for: allowedTools maxBudgetUsd/u);
});
