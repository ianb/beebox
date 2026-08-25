# Workstream list registry projection

In-flight and failed launch records are visible before a worktree exists.
Removed workstreams remain opt-in ghost rows, and every registry-only shape
makes absence explicit.

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

async function listResult(stateDir: string, worktreeRoot: string) {
  return execFileAsync(workstreams, ["list", "--json"], {
    env: { ...process.env, CALLBACK_BOX_ROOT: join(stateDir, "boxes"), CALLBACK_STATE_DIR: stateDir, CALLBACK_WORKTREE_ROOT: worktreeRoot },
  });
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
await writeFile(join(stateDir, "workstreams/pending-launch.json"), JSON.stringify({
  name: "pending-launch",
  branch: "worktree-pending-launch",
  launch: { token: "pending-token", startedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") },
}));
await writeFile(join(stateDir, "workstreams/expired-launch.json"), JSON.stringify({
  name: "expired-launch",
  branch: "worktree-expired-launch",
  launch: { token: "expired-token", startedAt: "2026-01-01T00:00:00Z" },
}));
const ordinary = await list(stateDir, worktreeRoot, false);
JSON.stringify(ordinary.map((row: { name: string; agent: { state: string }; routing: { state: string; action: string } }) => [row.name, row.agent.state, row.routing.state, row.routing.action]))
=> [["expired-launch","none","uncertain","investigate"],["pending-launch","launching","launching","wait-for-launch"]]

const rows = await list(stateDir, worktreeRoot, true);
JSON.stringify(rows.find((row: { name: string }) => row.name === "culled"))
=> {"name":"culled","branch":"worktree-culled","path":null,"box":null,"url":null,"git":null,"runtime":{"state":"absent"},"agent":{"state":"none","reason":"no-worktree"},"session":{"agent":"claude","hasSession":true,"tty":null,"emoji":"🧵","baseSha":null,"removed":{"at":"2026-08-09T00:00:00Z","finalSha":"abc","merged":true},"archived":null,"description":null,"launch":{"state":"none","startedAt":null,"expiresAt":null,"failedAt":null,"reason":null}},"routing":{"state":"removed","action":"resume-with-briefing","lastActivityAt":"2026-08-09T00:00:00Z"},"boxState":{"testSetup":false,"keepUnmerged":false,"pristine":null},"schedule":null}
```

## Stray directories are visible anomalies, not rows

```ts continue
await mkdir(join(worktreeRoot, "scratch"));
const stray = await listResult(stateDir, worktreeRoot);
JSON.stringify({ rows: JSON.parse(stray.stdout).length, warned: stray.stderr.includes("ignoring non-worktree directory") })
=> {"rows":2,"warned":true}
```

```ts cleanup
await rm(root, { recursive: true, force: true });
```
