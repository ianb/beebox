# Shared workstream session launcher

The launcher and `workstreams resume` share generated per-agent scripts. This
test keeps the refactor behavior pinned without opening real Terminal tabs.

```ts setup
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
const repoRoot = resolve(process.cwd(), "..");
const launchLib = join(repoRoot, "bin/lib/launch-session.sh");
const registryLib = join(repoRoot, "bin/lib/session-registry.sh");

async function beginLaunch(stateDir: string, name: string, token: string) {
  await execFileAsync("bash", ["-c", '. "$1"; session_registry_begin_launch "$2" "$3"', "registry-test", registryLib, name, token], {
    env: { ...process.env, CALLBACK_STATE_DIR: stateDir },
  });
}

async function launchState(stateDir: string, name: string) {
  const result = await execFileAsync("bash", ["-c", '. "$1"; session_registry_launch_status "$2"', "registry-test", registryLib, name], {
    env: { ...process.env, CALLBACK_STATE_DIR: stateDir },
  });
  return JSON.parse(result.stdout);
}

async function buildScript(
  root: string,
  options: {
    agent: "claude" | "codex";
    mono?: string;
    model?: string;
    resume: boolean;
    description?: string;
    issue?: string;
    worktreePath?: string;
  },
) {
  const { agent, resume } = options;
  const launchDir = join(root, `${agent}-${resume ? "resume" : "fresh"}`);
  const promptFile = join(root, "prompt.txt");
  await writeFile(promptFile, "briefing");
  const descriptionFile = join(root, `${agent}-${resume ? "resume" : "fresh"}-description.txt`);
  if (options.description !== undefined) await writeFile(descriptionFile, options.description);
  const command = [
    '. "$1"',
    'mkdir -p "$LS_LAUNCH_DIR"',
    "launch_session_build",
    'bash -n "$LS_LAUNCHER"',
    'printf "%s" "$LS_LAUNCHER"',
  ].join("; ");
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
```

## Claude uses the managed worktree without claiming native ownership

The launcher creates or reattaches through the agent-neutral CLI, changes into
that checkout, and starts ordinary Claude there. Omitting Claude's native
`--worktree` flag prevents its redundant keep/remove dialog at session exit;
the repository's SessionEnd hook and later sweep retain ownership of cleanup.

```ts
const root = await mkdtemp(join(tmpdir(), "launch-session-doctest-"));
const claudeScript = await buildScript(root, { agent: "claude", resume: false });
const issueScript = await buildScript(root, {
  agent: "claude",
  resume: false,
  issue: "issues/bugs/2026-08-11-example.md",
});
JSON.stringify([
  claudeScript.includes('./bin/workstreams create "seam"'),
  claudeScript.includes('cd "$wt_path"'),
  claudeScript.includes('session_registry_complete_launch "seam" "token-seam"'),
  claudeScript.includes('claude --name "seam" --model opus --remote-control seam'),
  !claudeScript.includes("claude --worktree"),
  claudeScript.includes("merge-base main HEAD"),
  claudeScript.indexOf('cd "$wt_path"') < claudeScript.indexOf('claude --name "seam"'),
  issueScript.includes("assign-issue-workstream.ts"),
  issueScript.includes("issues/bugs/2026-08-11-example.md"),
  issueScript.includes('if [ -n "issues/bugs/2026-08-11-example.md" ]'),
  claudeScript.includes('if [ -n "" ]'),
  issueScript.indexOf("assign-issue-workstream.ts") < issueScript.indexOf('claude --name "seam"'),
])
=> [true,true,true,true,true,true,true,true,true,true,true,true]
```

When the launch skill takes on an existing issue, the generated script assigns
that issue inside the new checkout before the agent starts.

Creation failures, including a broken zero-status/empty-stdout producer, stop
before Claude starts. A resumed session can instead consume the already
resolved path and therefore cannot recreate it with different base arguments.

```ts continue
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
await beginLaunch(invalidStateDir, "seam", "token-seam");
const invalid = await execFileAsync(invalidScriptPath, [], {
  env: { ...process.env, CALLBACK_STATE_DIR: invalidStateDir },
}).catch((error: unknown) => error as {
  code: number;
  stderr: string;
});
JSON.stringify({ code: invalid.code, message: invalid.stderr.includes("invalid worktree path"), launch: (await launchState(invalidStateDir, "seam")).state })
=> {"code":1,"message":true,"launch":"failed"}

const resolvedScript = await buildScript(root, {
  agent: "claude",
  resume: true,
  worktreePath: "/resolved/seam",
});
JSON.stringify([
  resolvedScript.includes('if [ -n "/resolved/seam" ]'),
  resolvedScript.includes('wt_path="/resolved/seam"'),
])
=> [true,true]
```

## Codex preserves creation, flags, and teardown behavior

```ts continue
const codexScript = await buildScript(root, { agent: "codex", resume: false });
const defaultCodexScript = await buildScript(root, {
  agent: "codex",
  model: "",
  resume: false,
});
JSON.stringify([
  codexScript.includes('./bin/workstreams create "seam"'),
  codexScript.includes('-s danger-full-access -a never'),
  codexScript.includes('-m "gpt-test"'),
  codexScript.includes('bin/codex-session-end'),
  defaultCodexScript.includes('-m "gpt-5.6-sol"'),
  defaultCodexScript.includes('--arg model "gpt-5.6-sol"'),
  codexScript.includes('session_registry_record_launch_session "seam" "token-seam"'),
  codexScript.indexOf('session_registry_complete_launch "seam" "token-seam"') > codexScript.indexOf('codex "${codex_args[@]}"'),
])
=> [true,true,true,true,true,true,true,true]

const codexResumeScript = await buildScript(root, { agent: "codex", resume: true });
JSON.stringify([
  codexResumeScript.includes('codex resume --last "${codex_args[@]}" "$(cat'),
  codexResumeScript.indexOf('codex resume --last') < codexResumeScript.indexOf('codex_status=$?'),
])
=> [true,true]

const describedScript = await buildScript(root, { agent: "codex", resume: false, description: "Workstream routing" });
const undescribedScript = await buildScript(root, { agent: "codex", resume: false });
JSON.stringify([
  describedScript.includes('if $description == "" then {} else {description:$description} end'),
  describedScript.includes("codex-fresh-description.txt"),
  undescribedScript.includes('if $description == "" then {} else {description:$description} end'),
])
=> [true,true,true]

const resolvedCodexScript = await buildScript(root, {
  agent: "codex",
  resume: true,
  worktreePath: "/resolved/seam",
});
resolvedCodexScript.includes('wt_path="/resolved/seam"')
=> true
```

## Completion is token-owned and happens at the agent boundary

The setup shell clears its own lease immediately before invoking the agent. A
script whose token has been superseded aborts at that boundary instead of
starting a second agent.

```ts continue
const validWorktree = join(root, "valid-worktree");
await mkdir(validWorktree);
await execFileAsync("git", ["init", "-b", "main"], { cwd: validWorktree });
await writeFile(join(validWorktree, "README.md"), "fixture\n");
await execFileAsync("git", ["add", "README.md"], { cwd: validWorktree });
await execFileAsync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture"], { cwd: validWorktree });

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
await beginLaunch(boundaryStateDir, "seam", "token-seam");
await execFileAsync(boundaryScriptPath, [], {
  env: { ...process.env, AGENT_OBSERVATION: observation, CALLBACK_STATE_DIR: boundaryStateDir, PATH: `${agentBin}:${process.env.PATH ?? ""}` },
});
const completedRecord = JSON.parse(await readFile(join(boundaryStateDir, "workstreams/seam.json"), "utf8"));
JSON.stringify({ observed: JSON.parse(await readFile(observation, "utf8")).state, storedLaunch: completedRecord.launch, agent: completedRecord.agent })
=> {"observed":"none","storedLaunch":null,"agent":"claude"}

const staleObservation = join(root, "stale-agent-observation.json");
await beginLaunch(boundaryStateDir, "seam", "newer-token");
const stale = await execFileAsync(boundaryScriptPath, [], {
  env: { ...process.env, AGENT_OBSERVATION: staleObservation, CALLBACK_STATE_DIR: boundaryStateDir, PATH: `${agentBin}:${process.env.PATH ?? ""}` },
}).catch((error: unknown) => error as { code: number; stderr: string });
const staleAgentStarted = await readFile(staleObservation).then(() => true, () => false);
JSON.stringify({ code: stale.code, superseded: stale.stderr.includes("was superseded"), agentStarted: staleAgentStarted, owner: JSON.parse(await readFile(join(boundaryStateDir, "workstreams/seam.json"), "utf8")).launch.token })
=> {"code":1,"superseded":true,"agentStarted":false,"owner":"newer-token"}

await writeFile(join(validWorktree, "AGENTS.md"), "fixture instructions\n");
const fakeCodex = join(agentBin, "codex");
await writeFile(fakeCodex, `#!/usr/bin/env bash
. "${registryLib}"
session_registry_launch_status seam > "$AGENT_OBSERVATION"
`);
await chmod(fakeCodex, 0o755);
const codexBoundaryScriptPath = join(root, "codex-boundary-launch.sh");
await writeFile(codexBoundaryScriptPath, await buildScript(root, { agent: "codex", mono: fakeMono, resume: false, worktreePath: validWorktree }));
await chmod(codexBoundaryScriptPath, 0o755);
const codexBoundaryStateDir = join(root, "codex-boundary-state");
const codexObservation = join(root, "codex-agent-observation.json");
await beginLaunch(codexBoundaryStateDir, "seam", "token-seam");
await execFileAsync(codexBoundaryScriptPath, [], {
  env: { ...process.env, AGENT_OBSERVATION: codexObservation, CALLBACK_STATE_DIR: codexBoundaryStateDir, PATH: `${agentBin}:${process.env.PATH ?? ""}` },
});
const codexCompletedRecord = JSON.parse(await readFile(join(codexBoundaryStateDir, "workstreams/seam.json"), "utf8"));
JSON.stringify({ whileRunning: JSON.parse(await readFile(codexObservation, "utf8")).state, afterExit: (await launchState(codexBoundaryStateDir, "seam")).state, agent: codexCompletedRecord.agent })
=> {"whileRunning":"active","afterExit":"none","agent":"codex"}

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
  env: { ...process.env, AGENT_OBSERVATION: join(root, "io-agent-observation"), CALLBACK_STATE_DIR: join(root, "io-state"), LAUNCH_FAILURE_MARKER: failureMarker, PATH: `${agentBin}:${process.env.PATH ?? ""}` },
});
JSON.stringify({ warned: ioFailure.stderr.includes("could not complete launch registry"), trapped: (await readFile(failureMarker, "utf8")).startsWith("setup-exited-status-") })
=> {"warned":true,"trapped":true}
```

Terminal automation failures must reach the CLI caller. In particular, the
web action depends on a nonzero exit to show an actionable flash instead of
claiming that a session launched when no tab opened.

```ts continue
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
  { env: { ...process.env, CALLBACK_STATE_DIR: openStateDir, PATH: `${observingBin}:${process.env.PATH ?? ""}` } },
);
JSON.stringify({ state: (await launchState(openStateDir, "pending-open")).state, agent: JSON.parse(await readFile(join(openStateDir, "workstreams/pending-open.json"), "utf8")).agent })
=> {"state":"active","agent":"claude"}

const failingBin = join(root, "failing-bin");
await mkdir(failingBin);
const failingOsascript = join(failingBin, "osascript");
await writeFile(
  failingOsascript,
  "#!/usr/bin/env bash\necho 'Terminal automation denied' >&2\nexit 17\n",
);
await chmod(failingOsascript, 0o755);
const failedOpen = await execFileAsync(
  "bash",
  [
    "-c",
    '. "$1"; LS_LAUNCHER=/tmp/not-run; LS_MONO="$2"; LS_AGENT=claude; LS_WORKSTREAM=failed-open; LS_LAUNCH_TOKEN=failed-token; launch_session_open',
    "launch-open-test",
    launchLib,
    repoRoot,
  ],
  { env: { ...process.env, CALLBACK_STATE_DIR: openStateDir, PATH: `${failingBin}:${process.env.PATH ?? ""}` } },
).catch((error: unknown) => error as { code: number; stderr: string });
JSON.stringify({
  code: failedOpen.code,
  message: failedOpen.stderr.includes("Terminal automation denied"),
  launch: (await launchState(openStateDir, "failed-open")).state,
})
=> {"code":17,"message":true,"launch":"failed"}

const blockedStatePath = join(root, "blocked-state");
await writeFile(blockedStatePath, "not a directory");
const markerBin = join(root, "marker-bin");
await mkdir(markerBin);
const openMarker = join(root, "terminal-opened");
await writeFile(join(markerBin, "osascript"), "#!/usr/bin/env bash\nprintf ran > \"$OPEN_MARKER\"\n");
await chmod(join(markerBin, "osascript"), 0o755);
const blockedOpen = await execFileAsync(
  "bash",
  ["-c", '. "$1"; LS_LAUNCHER=/tmp/not-run; LS_MONO="$2"; LS_AGENT=claude; LS_WORKSTREAM=blocked-open; LS_LAUNCH_TOKEN=blocked-token; launch_session_open', "launch-open-test", launchLib, repoRoot],
  { env: { ...process.env, CALLBACK_STATE_DIR: blockedStatePath, OPEN_MARKER: openMarker, PATH: `${markerBin}:${process.env.PATH ?? ""}` } },
).catch((error: unknown) => error as { code: number; stderr: string });
const terminalOpened = await readFile(openMarker).then(() => true, () => false);
JSON.stringify({ code: blockedOpen.code, refused: blockedOpen.stderr.includes("Terminal was not opened"), terminalOpened })
=> {"code":1,"refused":true,"terminalOpened":false}
```

```ts cleanup
await rm(root, { recursive: true, force: true });
```
