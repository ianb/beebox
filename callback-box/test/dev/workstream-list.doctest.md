# Workstream list registry projection

Removed workstreams are opt-in ghost rows. Ordinary listing still enumerates
only attached worktrees, while the ghost shape makes absence explicit.

```ts setup
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), "..");
const workstreams = join(repoRoot, "bin/workstreams");

async function list(stateDir: string, worktreeRoot: string, includeRemoved: boolean) {
  const args = ["list", "--json"];
  if (includeRemoved) args.push("--include-removed");
  const result = await execFileAsync(workstreams, args, {
    env: {
      ...process.env,
      CALLBACK_BOX_ROOT: join(stateDir, "boxes"),
      CALLBACK_STATE_DIR: stateDir,
      CALLBACK_WORKTREE_ROOT: worktreeRoot,
    },
  });
  return JSON.parse(result.stdout);
}
```

## Removed records appear only when requested

```ts
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
  emoji: "🧵",
  updatedAt: "2026-08-09T00:00:00Z",
  removed: { at: "2026-08-09T00:00:00Z", finalSha: "abc", merged: true },
}));
(await list(stateDir, worktreeRoot, false)).length
=> 0

const rows = await list(stateDir, worktreeRoot, true);
JSON.stringify(rows[0])
=> {"name":"culled","branch":"worktree-culled","path":null,"box":null,"url":null,"git":null,"runtime":{"state":"absent"},"agent":{"state":"none","reason":"no-worktree"},"session":{"agent":"claude","hasSession":true,"tty":null,"emoji":"🧵","baseSha":null,"removed":{"at":"2026-08-09T00:00:00Z","finalSha":"abc","merged":true}},"boxState":{"testSetup":false,"keepUnmerged":false,"pristine":null}}
```

```ts cleanup
await rm(root, { recursive: true, force: true });
```
