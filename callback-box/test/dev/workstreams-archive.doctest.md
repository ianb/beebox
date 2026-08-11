# Workstream archive state

Archiving is presentation state in the workstream registry. It does not remove
the checkout, branch, session, or box clone, and unarchiving removes only that
presentation marker.

```ts setup
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";

const repoRoot = path.resolve(process.cwd(), "..");
const workstreams = path.join(repoRoot, "bin/workstreams");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function registryRecord(file: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
  assert.ok(isRecord(parsed));
  return parsed;
}
```

Archive is idempotent: repeating it preserves the first archive time. An
unarchive writes the explicit `null` state expected by registry consumers.

```ts
const state = await fs.mkdtemp(path.join(os.tmpdir(), "workstreams-archive-"));
t.teardown(async () => await fs.rm(state, { recursive: true, force: true }));
const worktreeRoot = path.join(state, "worktrees");
const workstream = "synthetic-workstream";
await fs.mkdir(path.join(worktreeRoot, workstream), { recursive: true });
const env = {
  ...process.env,
  CALLBACK_STATE_DIR: state,
  CALLBACK_WORKTREE_ROOT: worktreeRoot,
};

await execa(workstreams, ["archive", workstream], { cwd: repoRoot, env });
const registryFile = path.join(state, "workstreams", `${workstream}.json`);
const archived = await registryRecord(registryFile);
assert.ok(isRecord(archived.archived));
assert.equal(typeof archived.archived.at, "string");
const firstArchivedAt = archived.archived.at;

await execa(workstreams, ["archive", workstream], { cwd: repoRoot, env });
const rearchived = await registryRecord(registryFile);
assert.ok(isRecord(rearchived.archived));
rearchived.archived.at === firstArchivedAt
=> true

await execa(workstreams, ["unarchive", workstream], { cwd: repoRoot, env });
(await registryRecord(registryFile)).archived
=> null
```

Recovery state must remain conspicuous. A workstream removed with unmerged work
cannot be archived, nor can a name absent from both registry and worktree root.

```ts
const state = await fs.mkdtemp(path.join(os.tmpdir(), "workstreams-archive-"));
t.teardown(async () => await fs.rm(state, { recursive: true, force: true }));
const worktreeRoot = path.join(state, "worktrees");
const workstream = "synthetic-workstream";
await fs.mkdir(path.join(worktreeRoot, workstream), { recursive: true });
const env = {
  ...process.env,
  CALLBACK_STATE_DIR: state,
  CALLBACK_WORKTREE_ROOT: worktreeRoot,
};
const registryFile = path.join(state, "workstreams", `${workstream}.json`);
await fs.mkdir(path.dirname(registryFile), { recursive: true });
await fs.writeFile(
  registryFile,
  JSON.stringify({
    removed: { at: new Date().toISOString(), merged: false },
  }),
);
await assert.rejects(
  execa(workstreams, ["archive", workstream], { cwd: repoRoot, env }),
  /refusing to hide recovery state/,
);

await assert.rejects(
  execa(workstreams, ["archive", "definitely-not-a-workstream"], {
    cwd: repoRoot,
    env,
  }),
  /unknown workstream/,
);
```
