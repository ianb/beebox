# Migration: box-packageify — Claude Code project-dir continuity

`relocateClaudeProjectDir` (in `scripts/migrate/box-packageify.ts`) moves
`~/.claude/projects/<old-cwd-key>/` (Claude Code's session-transcript
directory, keyed by an encoding of the operating cwd — see
`encodeProjectDir` in `src/cli/lib/session.ts`) to the key for the box's
new operating cwd (`content/`) when `box-packageify` moves a box's
operating root. Silent memory/history loss on this exact rename is a named
failure mode in `docs/plans/boxes-as-packages-v2.md` ("Failure modes"
table). Split into its own file from `migrate-box-packageify.doctest.md`
(same migration, same fixture conventions) purely to keep each file's
`ts continue` chain short.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { relocateClaudeProjectDir, relocateAllClaudeProjectDirs } from "../../../scripts/migrate/box-packageify.js";
import { encodeProjectDir } from "../../../src/cli/lib/session.js";

const fakeClaudeProjectsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cb-claude-projects-"));
process.env.CB_CLAUDE_PROJECTS_DIR = fakeClaudeProjectsRoot;

async function exists(p) {
  try { await fs.access(p); return true; }
  catch (_e) { return false; }
}

function outcomesOf(results) {
  const outcomes = [];
  for (const result of results) {
    outcomes.push(result.outcome);
  }
  return outcomes;
}
```

## Moves a box's Claude Code session history to the new cwd's key

```ts
const oldCwd = "/tmp/fixture-box-old-cwd-example";
const newCwd = "/tmp/fixture-box-old-cwd-example/content";
const oldKeyDir = path.join(fakeClaudeProjectsRoot, encodeProjectDir(oldCwd));
await fs.mkdir(oldKeyDir, { recursive: true });
await fs.writeFile(path.join(oldKeyDir, "session-1.jsonl"), "{}\n");

const result = await relocateClaudeProjectDir({ oldCwd, newCwd });
result.outcome
=> moved
```

```ts continue
const newKeyDir = path.join(fakeClaudeProjectsRoot, encodeProjectDir(newCwd));
const oldGone = !(await exists(oldKeyDir));
const sessionMoved = await exists(path.join(newKeyDir, "session-1.jsonl"));
oldGone && sessionMoved
=> true
```

## A conflicting destination is never clobbered — both dirs survive, plus a marker symlink

```ts
const oldCwd2 = "/tmp/fixture-box-conflict-example";
const newCwd2 = "/tmp/fixture-box-conflict-example/content";
const oldKeyDir2 = path.join(fakeClaudeProjectsRoot, encodeProjectDir(oldCwd2));
const newKeyDir2 = path.join(fakeClaudeProjectsRoot, encodeProjectDir(newCwd2));
await fs.mkdir(oldKeyDir2, { recursive: true });
await fs.writeFile(path.join(oldKeyDir2, "old-session.jsonl"), "{}\n");
await fs.mkdir(newKeyDir2, { recursive: true });
await fs.writeFile(path.join(newKeyDir2, "new-session.jsonl"), "{}\n");

const conflictResult = await relocateClaudeProjectDir({ oldCwd: oldCwd2, newCwd: newCwd2 });
conflictResult.outcome
=> conflict
```

Both original directories are untouched, and a `.moved-to` marker symlink beside the old one points at the authoritative (new) directory:

```ts continue
const marker = `${oldKeyDir2}.moved-to`;
const markerTarget = await fs.readlink(marker);
const oldStillHasOldSession = await exists(path.join(oldKeyDir2, "old-session.jsonl"));
const newStillHasNewSession = await exists(path.join(newKeyDir2, "new-session.jsonl"));
const markerPointsAtNew = path.resolve(marker, "..", markerTarget) === newKeyDir2;
oldStillHasOldSession && newStillHasNewSession && markerPointsAtNew
=> true
```

## Landmark chat project dirs (cwd = a subdirectory of the box root) relocate alongside the box-root dir

A landmark chat started at `<boxRoot>/store/foo` gets its own `~/.claude/projects` key, munged from the full cwd — `encodeProjectDir` turns the path separator between the box root and the subdirectory into the same `-` it uses for everything else, so the landmark key is always `<box-root-key>-<munged-suffix>`. `relocateAllClaudeProjectDirs` finds every such key and moves it to the equivalent key under the new box-root key, in addition to the box-root key itself.

```ts
const oldCwd3 = "/tmp/fixture-box-landmarks-example";
const newCwd3 = "/tmp/fixture-box-landmarks-example/content";
const oldRootKeyDir3 = path.join(fakeClaudeProjectsRoot, encodeProjectDir(oldCwd3));
const oldLandmarkKeyDir3 = path.join(fakeClaudeProjectsRoot, encodeProjectDir(path.join(oldCwd3, "store", "foo")));
await fs.mkdir(oldRootKeyDir3, { recursive: true });
await fs.writeFile(path.join(oldRootKeyDir3, "root-session.jsonl"), "{}\n");
await fs.mkdir(oldLandmarkKeyDir3, { recursive: true });
await fs.writeFile(path.join(oldLandmarkKeyDir3, "landmark-session.jsonl"), "{}\n");

const results3 = await relocateAllClaudeProjectDirs({ oldCwd: oldCwd3, newCwd: newCwd3 });
JSON.stringify(outcomesOf(results3))
=> ["moved","moved"]
```

```ts continue
const newRootKeyDir3 = path.join(fakeClaudeProjectsRoot, encodeProjectDir(newCwd3));
const newLandmarkKeyDir3 = path.join(fakeClaudeProjectsRoot, encodeProjectDir(path.join(newCwd3, "store", "foo")));
const rootMoved = await exists(path.join(newRootKeyDir3, "root-session.jsonl"));
const landmarkMoved = await exists(path.join(newLandmarkKeyDir3, "landmark-session.jsonl"));
const oldRootGone = !(await exists(oldRootKeyDir3));
const oldLandmarkGone = !(await exists(oldLandmarkKeyDir3));
rootMoved && landmarkMoved && oldRootGone && oldLandmarkGone
=> true
```

An unrelated box (a genuinely different key, not merely an extension of the same path) is never touched:

```ts continue
const oldCwd4 = "/tmp/fixture-different-unrelated-box";
const oldOtherKeyDir4 = path.join(fakeClaudeProjectsRoot, encodeProjectDir(oldCwd4));
await fs.mkdir(oldOtherKeyDir4, { recursive: true });
await fs.writeFile(path.join(oldOtherKeyDir4, "other-session.jsonl"), "{}\n");

await relocateAllClaudeProjectDirs({ oldCwd: oldCwd3, newCwd: newCwd3 });
await exists(path.join(oldOtherKeyDir4, "other-session.jsonl"))
=> true
```
