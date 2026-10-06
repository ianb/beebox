# SessionStart workstream registry hook

Launcher-started Claude sessions report main-derived cwd and transcript paths,
so ancestor argv is the primary signal. Headless Claude processes must never
replace an interactive session record.

```ts setup
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), "..");
const hook = join(repoRoot, ".claude/hooks/session-start-registry.sh");

async function runHook(stateDir: string, worktreeRoot: string, command: string, sessionId: string) {
  const input = JSON.stringify({
    cwd: repoRoot,
    session_id: sessionId,
    transcript_path: join(tmpdir(), `${sessionId}.jsonl`),
    source: "startup",
  });
  return execFileAsync("bash", ["-c", 'printf "%s" "$1" | "$2"', "hook-test", input, hook], {
    env: {
      ...process.env,
      BBX_STATE_DIR: stateDir,
      BBX_WORKTREE_ROOT: worktreeRoot,
      SESSION_REGISTRY_TESTING: "1",
      SESSION_REGISTRY_TEST_ANCESTOR_COMMAND: command,
      SESSION_REGISTRY_TEST_ANCESTOR_TTY: "ttys099",
    },
  });
}
```

## Interactive ancestor wins over main cwd

```ts
const root = await mkdtemp(join(tmpdir(), "session-start-registry-doctest-"));
const stateDir = join(root, "state");
const worktreeRoot = join(root, "worktrees");
await mkdir(join(worktreeRoot, "foo"), { recursive: true });
await runHook(stateDir, worktreeRoot, "claude --worktree foo --name test", "interactive-id");
const record = JSON.parse(await readFile(join(stateDir, "workstreams/foo.json"), "utf8"));
JSON.stringify({ sessionId: record.sessionId, tty: record.tty, agent: record.agent })
=> {"sessionId":"interactive-id","tty":"/dev/ttys099","agent":"claude"}
```

## Headless ancestor writes nothing

```ts continue
await runHook(stateDir, worktreeRoot, "claude -p --worktree bar", "headless-id");
const headlessExists = await stat(join(stateDir, "workstreams/bar.json")).then(() => true, () => false);
headlessExists
=> false
```

```ts cleanup
await rm(root, { recursive: true, force: true });
```
