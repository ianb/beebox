// # Shared workstream session launcher
//
// The launcher and `workstreams resume` share generated per-agent scripts. This
// test keeps the refactor behavior pinned without opening real Terminal tabs.

import { test } from "tap";
import "agent-doctest/tap";
import { any, not } from "agent-doctest/check";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
/** A generated script that contains `text`. */
const has = (text: string) => any(String).includes(text);
const lacks = (text: string) => not(has(text));
/** The script text before the first `text`: what ran by the time `text` starts. */
const upTo = (script: string, text: string) => script.slice(0, script.indexOf(text));

const repoRoot = resolve(process.cwd(), "..");
const launchLib = join(repoRoot, "bin/lib/launch-session.sh");
const registryLib = join(repoRoot, "bin/lib/session-registry.sh");
// doctest:L122
const root = await mkdtemp(join(tmpdir(), "launch-session-doctest-"));

async function beginLaunch({ stateDir, name, token }: { stateDir: string; name: string; token: string }) {
  await execFileAsync("bash", ["-c", '. "$1"; session_registry_begin_launch "$2" "$3"', "registry-test", registryLib, name, token], {
    env: { ...process.env, BBX_STATE_DIR: stateDir },
  });
}

async function launchState(stateDir: string, name: string) {
  const result = await execFileAsync("bash", ["-c", '. "$1"; session_registry_launch_status "$2"', "registry-test", registryLib, name], {
    env: { ...process.env, BBX_STATE_DIR: stateDir },
  });
  return JSON.parse(result.stdout);
}

async function buildScript(
  dir: string,
  options: {
    agent: "claude" | "codex";
    mono?: string;
    model?: string;
    resume: boolean;
    claudeSession?: string;
    description?: string;
    issue?: string;
    worktreePath?: string;
  },
) {
  const { agent, resume } = options;
  const launchDir = join(dir, `${agent}-${resume ? "resume" : "fresh"}${options.claudeSession ?? ""}`);
  const promptFile = join(dir, "prompt.txt");
  await writeFile(promptFile, "briefing");
  const descriptionFile = join(dir, `${agent}-${resume ? "resume" : "fresh"}-description.txt`);
  if (options.description !== undefined) await writeFile(descriptionFile, options.description);
  const command = [
    '. "$1"',
    'mkdir -p "$LS_LAUNCH_DIR"',
    "launch_session_build",
    'bash -n "$LS_LAUNCHER"',
    'printf "%s" "$LS_LAUNCHER"',
    // `&&`, not `;`: a refused build must reach the caller as a non-zero exit
    // rather than being papered over by the printf that follows it.
  ].join(" && ");
  const result = await execFileAsync(
    "bash",
    ["-c", command, "launch-test", launchLib],
    {
      env: {
        ...process.env,
        LS_AGENT: agent,
        LS_CODEX_RESUME: resume ? "1" : "0",
        LS_EMOJI: "🧵",
        LS_LAUNCH_DIR: launchDir,
        LS_MODEL: options.model ?? (agent === "claude" ? "opus" : "gpt-test"),
        LS_MONO: options.mono ?? repoRoot,
        LS_PROMPT_FILE: promptFile,
        LS_REMOTE_CONTROL: "1",
        // Explicitly clear a caller's resumed-Claude value for a fresh launch.
        // A process-wide environment can carry it from an outer session.
        LS_CLAUDE_RESUME_SESSION: options.claudeSession ?? "",
        LS_SESSION_NAME: "🧵 seam",
        LS_LAUNCH_TOKEN: "token-seam",
        LS_DESCRIPTION_FILE: options.description === undefined ? "" : descriptionFile,
        LS_WORKSTREAM: "seam",
        ...(options.issue !== undefined ? { LS_ISSUE: options.issue } : {}),
        ...(options.worktreePath
          ? { LS_WORKTREE_PATH: options.worktreePath }
          : {}),
      },
    },
  );
  return readFile(result.stdout, "utf8");
}

// ## Claude uses the managed worktree without claiming native ownership
//
// The launcher creates or reattaches through the agent-neutral CLI, changes into
// that checkout, and starts ordinary Claude there. Omitting Claude's native
// `--worktree` flag prevents its redundant keep/remove dialog at session exit;
// the repository's SessionEnd hook and later sweep retain ownership of cleanup.
void test("Claude uses the managed worktree without claiming native ownership", async (t) => {
  const claudeScript = await buildScript(root, { agent: "claude", resume: false });
  const issueScript = await buildScript(root, {
    agent: "claude",
    resume: false,
    issue: "issues/bugs/2026-08-11-example.md",
  });
  t.check(claudeScript, has('./bin/workstreams create "seam"'));
  t.check(claudeScript, has('cd "$wt_path"'));
  t.check(claudeScript, has('session_registry_complete_launch "seam" "token-seam"'));
  t.check(claudeScript, has('claude --name "seam" --model opus --remote-control seam'));
  t.check(claudeScript, lacks("claude --worktree"));
  t.check(claudeScript, has("merge-base main HEAD"));
  t.check(upTo(claudeScript, 'claude --name "seam"'), has('cd "$wt_path"'));
  t.check(issueScript, has("assign-issue-workstream.ts"));
  t.check(issueScript, has("issues/bugs/2026-08-11-example.md"));
  t.check(issueScript, has('if [ -n "issues/bugs/2026-08-11-example.md" ]'));
  t.check(claudeScript, has('if [ -n "" ]'));
  t.check(upTo(issueScript, 'claude --name "seam"'), has("assign-issue-workstream.ts"));

  // When the launch skill takes on an existing issue, the generated script assigns
  // that issue inside the new checkout before the agent starts.
  //
  // Creation failures, including a broken zero-status/empty-stdout producer, stop
  // before Claude starts. A resumed session can instead consume the already
  // resolved path and therefore cannot recreate it with different base arguments.

  // doctest:L154
  const fakeMono = join(root, "fake-mono");
  await mkdir(join(fakeMono, "bin"), { recursive: true });
  await symlink(join(repoRoot, "bin/lib"), join(fakeMono, "bin/lib"), "dir");
  const fakeWorkstreams = join(fakeMono, "bin/workstreams");
  await writeFile(fakeWorkstreams, "#!/usr/bin/env bash\nexit 0\n");
  await chmod(fakeWorkstreams, 0o755);
  const invalidScriptPath = join(root, "invalid-launch.sh");
  await writeFile(
    invalidScriptPath,
    await buildScript(root, { agent: "claude", mono: fakeMono, resume: false }),
  );
  await chmod(invalidScriptPath, 0o755);
  const invalidStateDir = join(root, "invalid-state");
  await beginLaunch({ stateDir: invalidStateDir, name: "seam", token: "token-seam" });
  const invalid = await expectFailure(execFileAsync(invalidScriptPath, [], {
    env: { ...process.env, BBX_STATE_DIR: invalidStateDir },
  }));
  t.check({ code: invalid.code, stderr: invalid.stderr }, { code: 1, stderr: "launch-worktree-session: invalid worktree path for seam: ''\n" });
  t.check((await launchState(invalidStateDir, "seam")).state, "failed");

  // doctest:L174
  const resolvedScript = await buildScript(root, {
    agent: "claude",
    resume: true,
    worktreePath: "/resolved/seam",
  });
  t.check(resolvedScript, has('if [ -n "/resolved/seam" ]'));
  t.check(resolvedScript, has('wt_path="/resolved/seam"'));

});

// ## Claude continues a recorded conversation instead of starting one
//
// `LS_CLAUDE_RESUME_SESSION` turns the generated script's `claude` call into a
// `--resume`, with the briefing still the first message of the continued session.
// The id is interpolated unquoted and `--resume` takes an *optional* value, so
// anything that is not a uuid is refused before a script is written at all —
// otherwise a malformed id would consume the next flag, and an empty one would
// treat the briefing itself as the session to resume.
void test("Claude continues a recorded conversation instead of starting one", async (t) => {
  // doctest:L196
  const continuedScript = await buildScript(root, {
    agent: "claude",
    resume: false,
    claudeSession: "40009a22-c9b5-49f8-b166-f16937403e8d",
  });
  const freshScript = await buildScript(root, { agent: "claude", resume: false });
  t.check(continuedScript, has('claude --name "seam" --model opus --remote-control seam --resume 40009a22-c9b5-49f8-b166-f16937403e8d --dangerously-skip-permissions "$(cat'));
  t.check(upTo(continuedScript, "--resume 40009a22"), has('cd "$wt_path"'));
  t.check(freshScript, lacks('claude --name "seam" --model opus --remote-control seam --resume'));

  // doctest:L209
  const badSession = await expectFailure(buildScript(root, {
    agent: "claude",
    resume: false,
    claudeSession: "--dangerously-skip-permissions",
  }));
  t.check({ code: badSession.code, stderr: badSession.stderr }, { code: 1, stderr: "launch-session: LS_CLAUDE_RESUME_SESSION is not a uuid: --dangerously-skip-permissions\n" });

});

// ## Codex preserves creation, flags, and teardown behavior
void test("Codex preserves creation, flags, and teardown behavior", async (t) => {
  // doctest:L221
  const codexScript = await buildScript(root, { agent: "codex", resume: false });
  const defaultCodexScript = await buildScript(root, {
    agent: "codex",
    model: "",
    resume: false,
  });
  t.check(codexScript, has('./bin/workstreams create "seam"'));
  t.check(codexScript, has("-s danger-full-access -a never"));
  t.check(codexScript, has('-m "gpt-test"'));
  t.check(codexScript, has("bin/codex-session-end"));
  t.check(defaultCodexScript, has('-m "gpt-6-sol"'));
  t.check(defaultCodexScript, has('--arg model "gpt-6-sol"'));
  t.check(codexScript, has('session_registry_complete_launch "seam" "token-seam"'));
  t.check(upTo(codexScript, 'codex "${codex_args[@]}"'), has('session_registry_complete_launch "seam" "token-seam"'));

  // doctest:L239
  const codexResumeScript = await buildScript(root, { agent: "codex", resume: true });
  t.check(codexResumeScript, has('codex resume --last "${codex_args[@]}" "$(cat'));
  t.check(upTo(codexResumeScript, "codex_status=$?"), has("codex resume --last"));

  // doctest:L246
  const describedScript = await buildScript(root, { agent: "codex", resume: false, description: "Workstream routing" });
  const undescribedScript = await buildScript(root, { agent: "codex", resume: false });
  t.check(describedScript, has('if $description == "" then {} else {description:$description} end'));
  t.check(describedScript, has("codex-fresh-description.txt"));
  t.check(undescribedScript, has('if $description == "" then {} else {description:$description} end'));

  // doctest:L255
  const resolvedCodexScript = await buildScript(root, {
    agent: "codex",
    resume: true,
    worktreePath: "/resolved/seam",
  });
  t.check(resolvedCodexScript, has('wt_path="/resolved/seam"'));

});

// ## Completion is token-owned and happens at the agent boundary
//
// The setup shell clears its own lease immediately before invoking the agent. A
// script whose token has been superseded aborts at that boundary instead of
// starting a second agent.
void test("Completion is token-owned and happens at the agent boundary", async (t) => {
  // doctest:L271
  const validWorktree = join(root, "valid-worktree");
  await mkdir(validWorktree);
  await execFileAsync("git", ["init", "-b", "main"], { cwd: validWorktree });
  await writeFile(join(validWorktree, "README.md"), "fixture\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: validWorktree });
  await execFileAsync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture"], { cwd: validWorktree });

  // doctest:L278
  const agentBin = join(root, "agent-bin");
  await mkdir(agentBin);
  const fakeClaude = join(agentBin, "claude");
  await writeFile(fakeClaude, `#!/usr/bin/env bash
. "${registryLib}"
session_registry_launch_status seam > "$AGENT_OBSERVATION"
`);
  await chmod(fakeClaude, 0o755);
  const boundaryScriptPath = join(root, "boundary-launch.sh");
  await writeFile(boundaryScriptPath, await buildScript(root, { agent: "claude", resume: true, worktreePath: validWorktree }));
  await chmod(boundaryScriptPath, 0o755);

  const boundaryStateDir = join(root, "boundary-state");
  const observation = join(root, "agent-observation.json");
  await beginLaunch({ stateDir: boundaryStateDir, name: "seam", token: "token-seam" });
  await execFileAsync(boundaryScriptPath, [], {
    env: { ...process.env, AGENT_OBSERVATION: observation, BBX_STATE_DIR: boundaryStateDir, PATH: `${agentBin}:${process.env.PATH ?? ""}` },
  });
  const completedRecord = JSON.parse(await readFile(join(boundaryStateDir, "workstreams/seam.json"), "utf8"));
  // doctest:L290
  t.check({ observed: JSON.parse(await readFile(observation, "utf8")).state, storedLaunch: completedRecord.launch, agent: completedRecord.agent }, {
    observed: "none",
    storedLaunch: null,
    agent: "claude",
  });

});

void test("A superseded token aborts before the agent starts", async (t) => {
  const agentBin = join(root, "agent-bin");
  const boundaryScriptPath = join(root, "boundary-launch.sh");
  const boundaryStateDir = join(root, "boundary-state");
  // doctest:L300
  const staleObservation = join(root, "stale-agent-observation.json");
  await beginLaunch({ stateDir: boundaryStateDir, name: "seam", token: "newer-token" });
  const stale = await expectFailure(execFileAsync(boundaryScriptPath, [], {
    env: { ...process.env, AGENT_OBSERVATION: staleObservation, BBX_STATE_DIR: boundaryStateDir, PATH: `${agentBin}:${process.env.PATH ?? ""}` },
  }));
  const staleAgentStarted = await readFile(staleObservation).then(() => true, () => false);
  t.check({ code: stale.code, stderr: stale.stderr, agentStarted: staleAgentStarted, owner: JSON.parse(await readFile(join(boundaryStateDir, "workstreams/seam.json"), "utf8")).launch.token }, {
    code: 1,
    stderr: "session-registry: launch token for seam was superseded; refusing stale update\nlaunch-worktree-session: launch for seam was superseded — refusing to start a second agent\n",
    agentStarted: false,
    owner: "newer-token",
  });

});

void test("Codex launches with the worktree preamble and refuses unmirrored agents", async (t) => {
  const validWorktree = join(root, "valid-worktree");
  const agentBin = join(root, "agent-bin");
  const fakeMono = join(root, "fake-mono");
  // doctest:L309
  // The Codex launcher builds its preamble from the worktree's own script.
  await mkdir(join(validWorktree, "bin"), { recursive: true });
  await symlink(join(repoRoot, "bin/codex-preamble.ts"), join(validWorktree, "bin/codex-preamble.ts"));
  await symlink(join(repoRoot, "node_modules"), join(validWorktree, "node_modules"), "dir");
  const fakeCodex = join(agentBin, "codex");
  await writeFile(fakeCodex, `#!/usr/bin/env bash
. "${registryLib}"
session_registry_launch_status seam > "$AGENT_OBSERVATION"
printf '%s\n' "$@" > "$AGENT_OBSERVATION.args"
`);
  await chmod(fakeCodex, 0o755);
  const codexBoundaryScriptPath = join(root, "codex-boundary-launch.sh");
  await writeFile(codexBoundaryScriptPath, await buildScript(root, { agent: "codex", mono: fakeMono, resume: false, worktreePath: validWorktree }));
  await chmod(codexBoundaryScriptPath, 0o755);
  const codexBoundaryStateDir = join(root, "codex-boundary-state");
  const codexObservation = join(root, "codex-agent-observation.json");
  await beginLaunch({ stateDir: codexBoundaryStateDir, name: "seam", token: "token-seam" });
  await execFileAsync(codexBoundaryScriptPath, [], {
    env: { ...process.env, AGENT_OBSERVATION: codexObservation, BBX_STATE_DIR: codexBoundaryStateDir, PATH: `${agentBin}:${process.env.PATH ?? ""}` },
  });
  const codexCompletedRecord = JSON.parse(await readFile(join(codexBoundaryStateDir, "workstreams/seam.json"), "utf8"));
  t.check({ whileRunning: JSON.parse(await readFile(codexObservation, "utf8")).state, afterExit: (await launchState(codexBoundaryStateDir, "seam")).state, agent: codexCompletedRecord.agent }, {
    whileRunning: "none",
    afterExit: "none",
    agent: "codex",
  });

  // doctest:L333
  // Codex gets the session preamble as developer instructions, oriented to the
  // worktree.
  const codexArgs = await readFile(`${codexObservation}.args`, "utf8");
  // The preamble is a long generated document, so only its heading and the worktree path it names are pinned.
  t.check(codexArgs, has('developer_instructions="# Codex session preamble'));
  t.check(codexArgs, has("~/src/box-worktrees/seam/test1"));

  // doctest:L339
  // A tracked Claude subagent without a generated Codex mirror refuses the launch,
  // so a named agent such as `finish` never runs on the session's default model.
  await mkdir(join(validWorktree, ".claude/agents"), { recursive: true });
  await writeFile(join(validWorktree, ".claude/agents/finish.md"), "---\nname: finish\n---\n");
  const unmirroredObservation = join(root, "unmirrored-agent-observation.json");
  await beginLaunch({ stateDir: codexBoundaryStateDir, name: "seam", token: "token-seam" });
  const unmirrored = await expectFailure(execFileAsync(codexBoundaryScriptPath, [], {
    env: { ...process.env, AGENT_OBSERVATION: unmirroredObservation, BBX_STATE_DIR: codexBoundaryStateDir, PATH: `${agentBin}:${process.env.PATH ?? ""}` },
  }));
  const unmirroredStarted = await readFile(unmirroredObservation).then(() => true, () => false);
  await rm(join(validWorktree, ".claude"), { recursive: true });
  t.check({ code: unmirrored.code, stderr: unmirrored.stderr, agentStarted: unmirroredStarted }, {
    code: 1,
    stderr: "launch-worktree-session: missing Codex mirror for agent finish — refusing to launch codex without its pinned model\n",
    agentStarted: false,
  });

});

void test("A launch registry I/O failure is trapped and reported", async (t) => {
  const validWorktree = join(root, "valid-worktree");
  const agentBin = join(root, "agent-bin");
  // doctest:L353
  const ioMono = join(root, "io-mono");
  await mkdir(join(ioMono, "bin/lib"), { recursive: true });
  await writeFile(join(ioMono, "bin/lib/session-registry.sh"), `
session_registry_complete_launch() { return 1; }
session_registry_fail_launch() { printf '%s' "$3" > "$LAUNCH_FAILURE_MARKER"; }
`);
  const ioFailureScript = join(root, "io-failure-launch.sh");
  await writeFile(ioFailureScript, await buildScript(root, { agent: "claude", mono: ioMono, resume: true, worktreePath: validWorktree }));
  await chmod(ioFailureScript, 0o755);
  const failureMarker = join(root, "completion-io-failure");
  const ioFailure = await execFileAsync(ioFailureScript, [], {
    env: { ...process.env, AGENT_OBSERVATION: join(root, "io-agent-observation"), BBX_STATE_DIR: join(root, "io-state"), LAUNCH_FAILURE_MARKER: failureMarker, PATH: `${agentBin}:${process.env.PATH ?? ""}` },
  });
  t.checkText(ioFailure.stderr, "launch-worktree-session: could not complete launch registry for seam — starting agent with process liveness only");
  t.checkText(await readFile(failureMarker, "utf8"), "setup-exited-status-0");

});

// Terminal automation failures must reach the CLI caller. In particular, the
// web action depends on a nonzero exit to show an actionable flash instead of
// claiming that a session launched when no tab opened.
void test("Terminal automation failures reach the CLI caller", async (t) => {
  t.teardown(async () => {
    try {
      await rm(root, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L375
  const openStateDir = join(root, "open-state");
  const observingBin = join(root, "observing-bin");
  await mkdir(observingBin);
  const observingOsascript = join(observingBin, "osascript");
  await writeFile(
    observingOsascript,
    `#!/usr/bin/env bash
. "${registryLib}"
[ "$(session_registry_launch_status pending-open | jq -r .state)" = active ]
`,
  );
  await chmod(observingOsascript, 0o755);
  await execFileAsync(
    "bash",
    [
      "-c",
      '. "$1"; LS_LAUNCHER=/tmp/not-run; LS_MONO="$2"; LS_AGENT=claude; LS_WORKSTREAM=pending-open; LS_LAUNCH_TOKEN=open-token; launch_session_open',
      "launch-open-test",
      launchLib,
      repoRoot,
    ],
    { env: { ...process.env, BBX_STATE_DIR: openStateDir, PATH: `${observingBin}:${process.env.PATH ?? ""}` } },
  );
  t.check({ state: (await launchState(openStateDir, "pending-open")).state, agent: JSON.parse(await readFile(join(openStateDir, "workstreams/pending-open.json"), "utf8")).agent }, {
    state: "active",
    agent: "claude",
  });

  // doctest:L401
  const failingBin = join(root, "failing-bin");
  await mkdir(failingBin);
  const failingOsascript = join(failingBin, "osascript");
  await writeFile(
    failingOsascript,
    "#!/usr/bin/env bash\necho 'Terminal automation denied' >&2\nexit 17\n",
  );
  await chmod(failingOsascript, 0o755);
  const failedOpen = await expectFailure(execFileAsync(
    "bash",
    [
      "-c",
      '. "$1"; LS_LAUNCHER=/tmp/not-run; LS_MONO="$2"; LS_AGENT=claude; LS_WORKSTREAM=failed-open; LS_LAUNCH_TOKEN=failed-token; launch_session_open',
      "launch-open-test",
      launchLib,
      repoRoot,
    ],
    { env: { ...process.env, BBX_STATE_DIR: openStateDir, PATH: `${failingBin}:${process.env.PATH ?? ""}` } },
  ));
  t.check(
    {
      code: failedOpen.code,
      stderr: failedOpen.stderr,
      launch: (await launchState(openStateDir, "failed-open")).state,
    },
    {
    code: 17,
    stderr: "Terminal automation denied\nworkstreams launch: Terminal automation failed\n",
    launch: "failed",
  },
  );

  // doctest:L427
  const blockedStatePath = join(root, "blocked-state");
  await writeFile(blockedStatePath, "not a directory");
  const markerBin = join(root, "marker-bin");
  await mkdir(markerBin);
  const openMarker = join(root, "terminal-opened");
  await writeFile(join(markerBin, "osascript"), "#!/usr/bin/env bash\nprintf ran > \"$OPEN_MARKER\"\n");
  await chmod(join(markerBin, "osascript"), 0o755);
  const blockedOpen = await expectFailure(execFileAsync(
    "bash",
    ["-c", '. "$1"; LS_LAUNCHER=/tmp/not-run; LS_MONO="$2"; LS_AGENT=claude; LS_WORKSTREAM=blocked-open; LS_LAUNCH_TOKEN=blocked-token; launch_session_open', "launch-open-test", launchLib, repoRoot],
    { env: { ...process.env, BBX_STATE_DIR: blockedStatePath, OPEN_MARKER: openMarker, PATH: `${markerBin}:${process.env.PATH ?? ""}` } },
  ));
  const terminalOpened = await readFile(openMarker).then(() => true, () => false);
  t.check({ code: blockedOpen.code, stderr: blockedOpen.stderr, terminalOpened }, {
    code: 1,
    stderr: `mkdir: ${blockedStatePath}: Not a directory\nsession-registry: could not create registry directory ${blockedStatePath}/workstreams\nworkstreams launch: could not record launch intent; Terminal was not opened\n`,
    terminalOpened: false,
  });
});
