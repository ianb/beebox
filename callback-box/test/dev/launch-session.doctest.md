# Shared workstream session launcher

The launcher and `workstreams resume` share generated per-agent scripts. This
test keeps the refactor behavior pinned without opening real Terminal tabs.

```ts setup
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), "..");
const launchLib = join(repoRoot, "bin/lib/launch-session.sh");

async function buildScript(root: string, agent: "claude" | "codex") {
  const launchDir = join(root, agent);
  const promptFile = join(root, "prompt.txt");
  await writeFile(promptFile, "briefing");
  const command = [
    '. "$1"',
    'mkdir -p "$LS_LAUNCH_DIR"',
    "launch_session_build",
    'bash -n "$LS_LAUNCHER"',
    'printf "%s" "$LS_LAUNCHER"',
  ].join("; ");
  const result = await execFileAsync("bash", ["-c", command, "launch-test", launchLib], {
    env: {
      ...process.env,
      LS_AGENT: agent,
      LS_EMOJI: "🧵",
      LS_LAUNCH_DIR: launchDir,
      LS_MODEL: agent === "claude" ? "opus" : "gpt-test",
      LS_MONO: repoRoot,
      LS_PROMPT_FILE: promptFile,
      LS_REMOTE_CONTROL: "1",
      LS_SESSION_NAME: "🧵 seam",
      LS_WORKSTREAM: "seam",
    },
  });
  return readFile(result.stdout, "utf8");
}
```

## Claude preserves worktree, model, remote-control, and registry behavior

```ts
const root = await mkdtemp(join(tmpdir(), "launch-session-doctest-"));
const claudeScript = await buildScript(root, "claude");
JSON.stringify([
  claudeScript.includes('session_registry_merge "seam"'),
  claudeScript.includes('claude --worktree "seam" --name "🧵 seam" --model opus --remote-control seam'),
])
=> [true,true]
```

## Codex preserves creation, flags, and teardown behavior

```ts continue
const codexScript = await buildScript(root, "codex");
JSON.stringify([
  codexScript.includes('./bin/workstreams create "seam"'),
  codexScript.includes('-s danger-full-access -a never'),
  codexScript.includes('-m "gpt-test"'),
  codexScript.includes('bin/codex-session-end'),
])
=> [true,true,true,true]
```

```ts cleanup
await rm(root, { recursive: true, force: true });
```
