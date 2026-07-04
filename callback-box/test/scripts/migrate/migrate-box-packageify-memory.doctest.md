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
import { relocateClaudeProjectDir } from "../../../scripts/migrate/box-packageify.js";
import { encodeProjectDir } from "../../../src/cli/lib/session.js";

const fakeClaudeProjectsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cb-claude-projects-"));
process.env.CB_CLAUDE_PROJECTS_DIR = fakeClaudeProjectsRoot;

async function exists(p) {
  try { await fs.access(p); return true; }
  catch (_e) { return false; }
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
