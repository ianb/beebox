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
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), "..");
const launchLib = join(repoRoot, "bin/lib/launch-session.sh");

async function buildScript(
  root: string,
  options: {
    agent: "claude" | "codex";
    mono?: string;
    resume: boolean;
    worktreePath?: string;
  },
) {
  const { agent, resume } = options;
  const launchDir = join(root, `${agent}-${resume ? "resume" : "fresh"}`);
  const promptFile = join(root, "prompt.txt");
  await writeFile(promptFile, "briefing");
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
        LS_MODEL: agent === "claude" ? "opus" : "gpt-test",
        LS_MONO: options.mono ?? repoRoot,
        LS_PROMPT_FILE: promptFile,
        LS_REMOTE_CONTROL: "1",
        LS_SESSION_NAME: "🧵 seam",
        LS_WORKSTREAM: "seam",
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
JSON.stringify([
  claudeScript.includes('./bin/workstreams create "seam"'),
  claudeScript.includes('cd "$wt_path"'),
  claudeScript.includes('session_registry_merge "seam"'),
  claudeScript.includes('claude --name "seam" --model opus --remote-control seam'),
  !claudeScript.includes("claude --worktree"),
  claudeScript.includes("merge-base main HEAD"),
  claudeScript.indexOf('cd "$wt_path"') < claudeScript.indexOf("exec claude"),
])
=> [true,true,true,true,true,true,true]
```

Creation failures, including a broken zero-status/empty-stdout producer, stop
before Claude starts. A resumed session can instead consume the already
resolved path and therefore cannot recreate it with different base arguments.

```ts continue
const fakeMono = join(root, "fake-mono");
await mkdir(join(fakeMono, "bin"), { recursive: true });
const fakeWorkstreams = join(fakeMono, "bin/workstreams");
await writeFile(fakeWorkstreams, "#!/usr/bin/env bash\nexit 0\n");
await chmod(fakeWorkstreams, 0o755);
const invalidScriptPath = join(root, "invalid-launch.sh");
await writeFile(
  invalidScriptPath,
  await buildScript(root, { agent: "claude", mono: fakeMono, resume: false }),
);
await chmod(invalidScriptPath, 0o755);
const invalid = await execFileAsync(invalidScriptPath).catch((error: unknown) => error as {
  code: number;
  stderr: string;
});
JSON.stringify({ code: invalid.code, message: invalid.stderr.includes("invalid worktree path") })
=> {"code":1,"message":true}

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
JSON.stringify([
  codexScript.includes('./bin/workstreams create "seam"'),
  codexScript.includes('-s danger-full-access -a never'),
  codexScript.includes('-m "gpt-test"'),
  codexScript.includes('bin/codex-session-end'),
])
=> [true,true,true,true]

const codexResumeScript = await buildScript(root, { agent: "codex", resume: true });
codexResumeScript.includes('codex resume --last "${codex_args[@]}"')
=> true

const resolvedCodexScript = await buildScript(root, {
  agent: "codex",
  resume: true,
  worktreePath: "/resolved/seam",
});
resolvedCodexScript.includes('wt_path="/resolved/seam"')
=> true
```

```ts cleanup
await rm(root, { recursive: true, force: true });
```
