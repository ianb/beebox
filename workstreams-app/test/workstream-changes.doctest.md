# Which workstreams changed which files (src/server/workstream-changes.ts)

The cross-workstream lens (`docs/plans/general-browser.md`, Track 3a). One scan,
read both ways: a file says which workstreams have touched it — so you learn it
from the file rather than from a merge conflict — and a workstream lists what it
touched, which is the `?workstream=` filter.

The property that matters most: **unavailable is not none.** A workstream whose
diff cannot be read is reported, never silently counted as having changed
nothing.

```ts setup
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";

import { collectWorkstreamChanges, workstreamsForPath } from "../src/server/workstream-changes.js";

async function git(cwd: string, args: string[]) {
  return execa("git", args, { cwd });
}

// A main checkout with two branches taken from it, cloned rather than
// worktree'd so each has an independent HEAD and working tree.
const mainRoot = await fs.mkdtemp(path.join(os.tmpdir(), "changes-main-"));
await git(mainRoot, ["init", "-q", "-b", "main"]);
await git(mainRoot, ["config", "user.email", "t@example.com"]);
await git(mainRoot, ["config", "user.name", "Test"]);
await fs.mkdir(path.join(mainRoot, "src"), { recursive: true });
await fs.writeFile(path.join(mainRoot, "src/shared.ts"), "export const v = 1;\n");
await fs.writeFile(path.join(mainRoot, "src/quiet.ts"), "export const q = 1;\n");
await git(mainRoot, ["add", "-A"]);
await git(mainRoot, ["commit", "-qm", "base"]);

async function makeWorktree(name: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `changes-${name}-`));
  await git(root, ["clone", "-q", mainRoot, "."]);
  await git(root, ["config", "user.email", "t@example.com"]);
  await git(root, ["config", "user.name", "Test"]);
  await git(root, ["checkout", "-q", "-b", `worktree-${name}`]);
  return root;
}

const alphaRoot = await makeWorktree("alpha");
const betaRoot = await makeWorktree("beta");
```

## Committed, uncommitted, and untracked all count as "changed"

A branch's committed diff alone would miss what someone is doing right now,
which is the case you most want to see.

```ts
// alpha: one committed change and one uncommitted edit.
await fs.writeFile(path.join(alphaRoot, "src/shared.ts"), "export const v = 2;\n");
await git(alphaRoot, ["commit", "-qam", "alpha edits shared"]);
await fs.writeFile(path.join(alphaRoot, "src/inflight.ts"), "export const w = 1;\n");
await git(alphaRoot, ["add", "src/inflight.ts"]);

// beta: the same shared file, plus an untracked scratch note.
await fs.writeFile(path.join(betaRoot, "src/shared.ts"), "export const v = 3;\n");
await git(betaRoot, ["commit", "-qam", "beta edits shared"]);
await fs.writeFile(path.join(betaRoot, "notes.md"), "# scratch\n");

const changes = await collectWorkstreamChanges(new Map([["alpha", alphaRoot], ["beta", betaRoot]]));
const seen = {
  sharedChangedIn: workstreamsForPath(changes, "src/shared.ts"),
  quietChangedIn: workstreamsForPath(changes, "src/quiet.ts"),
  alphaSeesInflight: changes.byWorkstream.get("alpha")?.includes("src/inflight.ts") ?? false,
  betaSeesUntracked: changes.byWorkstream.get("beta")?.includes("notes.md") ?? false,
  unavailable: [...changes.unavailable.keys()],
};
JSON.stringify(seen)
=> {"sharedChangedIn":["alpha","beta"],"quietChangedIn":[],"alphaSeesInflight":true,"betaSeesUntracked":true,"unavailable":[]}
```

A file nobody has touched reports an empty list, which is a real answer — and it
is distinguishable from the unavailable case below because `unavailable` is
empty too.

## A workstream whose diff fails is reported, not counted as quiet

This is the whole reason the shape carries `unavailable`. A directory that is
not a git checkout stands in for a worktree mid-cull or a broken clone.

```ts continue
const brokenRoot = await fs.mkdtemp(path.join(os.tmpdir(), "changes-broken-"));
const withBroken = await collectWorkstreamChanges(
  new Map([["alpha", alphaRoot], ["broken", brokenRoot]]),
);
const reported = {
  unavailable: [...withBroken.unavailable.keys()],
  hasReason: (withBroken.unavailable.get("broken")?.length ?? 0) > 0,
  // The broken one contributes nothing to byPath — and the caller can tell,
  // because it is named in `unavailable` rather than simply absent.
  brokenInByWorkstream: withBroken.byWorkstream.has("broken"),
  alphaStillScanned: (withBroken.byWorkstream.get("alpha")?.length ?? 0) > 0,
};
await fs.rm(brokenRoot, { recursive: true, force: true });
JSON.stringify(reported)
=> {"unavailable":["broken"],"hasReason":true,"brokenInByWorkstream":false,"alphaStillScanned":true}
```

## Order is stable, and a path is listed once per workstream

The browser renders these names; churn in their order would make the same file
look like it changed when only the scan did.

```ts continue
const twice = await collectWorkstreamChanges(new Map([["beta", betaRoot], ["alpha", alphaRoot]]));
const stable = {
  sameOrder: JSON.stringify(workstreamsForPath(twice, "src/shared.ts")) === '["alpha","beta"]',
  noDuplicates:
    new Set(twice.byWorkstream.get("alpha") ?? []).size === (twice.byWorkstream.get("alpha") ?? []).length,
};
JSON.stringify(stable)
=> {"sameOrder":true,"noDuplicates":true}
```

## Three states, not two

"Scanned and changed nothing", "scan failed", and "not a live workstream" are
different answers. The service layer keeps them apart; conflating the last two
into an empty list would report "changed nothing" about something that does not
exist.

```ts continue
const scanned = await collectWorkstreamChanges(new Map([["alpha", alphaRoot]]));
const states = {
  scannedAndQuiet: scanned.byWorkstream.has("alpha"),
  neverScanned: scanned.byWorkstream.has("ghost"),
  notUnavailableEither: !scanned.unavailable.has("ghost"),
};
JSON.stringify(states)
=> {"scannedAndQuiet":true,"neverScanned":false,"notUnavailableEither":true}
```

## No worktrees is empty, not an error

The main checkout on its own is a legitimate state — nothing is in flight.

```ts continue
const none = await collectWorkstreamChanges(new Map());
JSON.stringify({ paths: none.byPath.size, workstreams: none.byWorkstream.size, unavailable: none.unavailable.size })
=> {"paths":0,"workstreams":0,"unavailable":0}
```

```ts cleanup
await Promise.all([
  fs.rm(mainRoot, { recursive: true, force: true }),
  fs.rm(alphaRoot, { recursive: true, force: true }),
  fs.rm(betaRoot, { recursive: true, force: true }),
]);
```
