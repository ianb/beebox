# The recency feed (src/server/recency.ts)

The browser's front door (`docs/plans/general-browser.md`, Track 3). The
boxholder's rule is *"a file is interesting if it has been modified recently, in
any workstream"* — a feed, not a directory listing, which is why it is what the
browser opens on.

Three properties carry it: **in-progress work outranks committed history**
(otherwise the feed shows what people finished, not what they are doing), **a
checkout that cannot be scanned is reported rather than counted as quiet**, and
the feed carries its own `now` so relative times describe the data's age rather
than the moment of paint.

```ts setup
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";

import { collectRecentFiles } from "../src/server/recency.js";

async function git(cwd: string, args: string[]) {
  return execa("git", args, { cwd });
}

const mainRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recency-main-"));
await git(mainRoot, ["init", "-q", "-b", "main"]);
await git(mainRoot, ["config", "user.email", "t@example.com"]);
await git(mainRoot, ["config", "user.name", "Test"]);
await fs.writeFile(path.join(mainRoot, "old.md"), "# old\n");
await git(mainRoot, ["add", "-A"]);
await git(mainRoot, ["commit", "-qm", "base"]);

const wtRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recency-wt-"));
await git(wtRoot, ["clone", "-q", mainRoot, "."]);
await git(wtRoot, ["config", "user.email", "t@example.com"]);
await git(wtRoot, ["config", "user.name", "Test"]);
await git(wtRoot, ["checkout", "-q", "-b", "worktree-alpha"]);

const frozen = () => 1_800_000_000;
const feedFor = (roots: Map<string, string>) =>
  collectRecentFiles({ mainRoot, worktreeRoots: roots, now: frozen });
```

## The feed spans every checkout, newest first

A file changed in a worktree appears beside one changed on main, each labelled
with where it changed — that is the "in any workstream" half of the rule.

```ts
await fs.writeFile(path.join(wtRoot, "feature.ts"), "export const a = 1;\n");
await git(wtRoot, ["add", "-A"]);
await git(wtRoot, ["commit", "-qm", "alpha adds a feature"]);

const feed = await feedFor(new Map([["alpha", wtRoot]]));
const byPath = new Map(feed.files.map((f) => [`${f.workstream ?? "main"}:${f.relPath}`, f]));
const spans = {
  fromWorktree: byPath.has("alpha:feature.ts"),
  fromMain: byPath.has("main:old.md"),
  newestFirst: feed.files.every((f, i) => i === 0 || feed.files[i - 1]!.at >= f.at),
  carriesNow: feed.now === 1_800_000_000,
};
JSON.stringify(spans)
=> {"fromWorktree":true,"fromMain":true,"newestFirst":true,"carriesNow":true}
```

## A branch reports its OWN commits, not the history it inherited

A worktree shares main's history. Asking it for "everything recent" would return
main's month over again under the workstream's name — with twenty live worktrees
that is twenty copies of the same commits and a distribution claiming every
workstream did identical work. A branch is asked for `main..HEAD`; main is asked
for the window.

```ts continue
const inherited = feed.files.filter((f) => f.workstream === "alpha" && f.relPath === "old.md");
const own = feed.files.filter((f) => f.workstream === "alpha" && f.relPath === "feature.ts");
JSON.stringify({ reportsInheritedHistory: inherited.length > 0, reportsOwnCommit: own.length === 1 })
=> {"reportsInheritedHistory":false,"reportsOwnCommit":true}
```

## In-progress work is marked, and outranks its own committed history

An uncommitted edit to a file that was also committed appears once, with the
working-tree time, because that is the newer fact about it.

```ts continue
await fs.writeFile(path.join(wtRoot, "feature.ts"), "export const a = 2;\n");
await fs.writeFile(path.join(wtRoot, "scratchpad.md"), "# thinking\n");

const withEdits = await feedFor(new Map([["alpha", wtRoot]]));
const feature = withEdits.files.filter((f) => f.relPath === "feature.ts");
const scratch = withEdits.files.find((f) => f.relPath === "scratchpad.md");
const progress = {
  featureListedOnce: feature.length === 1,
  featureInProgress: feature[0]?.inProgress,
  untrackedIncluded: scratch !== undefined,
  untrackedInProgress: scratch?.inProgress,
};
JSON.stringify(progress)
=> {"featureListedOnce":true,"featureInProgress":true,"untrackedIncluded":true,"untrackedInProgress":true}
```

## The same path on two branches is two entries, not one

Collapsing them would hide the second — and "two workstreams are editing this"
is exactly what the feed exists to surface.

```ts continue
const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recency-other-"));
await git(otherRoot, ["clone", "-q", mainRoot, "."]);
await git(otherRoot, ["config", "user.email", "t@example.com"]);
await git(otherRoot, ["config", "user.name", "Test"]);
await git(otherRoot, ["checkout", "-q", "-b", "worktree-beta"]);
await fs.writeFile(path.join(otherRoot, "feature.ts"), "export const a = 3;\n");

const both = await feedFor(new Map([["alpha", wtRoot], ["beta", otherRoot]]));
const owners = both.files.filter((f) => f.relPath === "feature.ts").map((f) => f.workstream).toSorted();
JSON.stringify(owners)
=> ["alpha","beta"]
```

## Distribution answers "how much work comes from where"

The third view over one dataset, and the reason the feed does not need a
separate stats query.

```ts continue
const named = both.distribution.map((entry) => entry.workstream ?? "main").toSorted();
const counted = both.distribution.every((entry) => entry.count > 0);
JSON.stringify({ named, counted, total: both.distribution.length })
=> {"named":["alpha","beta","main"],"counted":true,"total":3}
```

## A checkout that cannot be scanned is named, not counted as quiet

An incomplete feed that looks complete would tell you nothing is happening in a
workstream that is busy.

```ts continue
const brokenRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recency-broken-"));
const withBroken = await feedFor(new Map([["alpha", wtRoot], ["broken", brokenRoot]]));
const reported = {
  named: [...withBroken.unavailable.keys()],
  hasReason: (withBroken.unavailable.get("broken")?.length ?? 0) > 0,
  othersStillScanned: withBroken.files.some((f) => f.workstream === "alpha"),
};
await Promise.all([
  fs.rm(brokenRoot, { recursive: true, force: true }),
  fs.rm(otherRoot, { recursive: true, force: true }),
]);
JSON.stringify(reported)
=> {"named":["broken"],"hasReason":true,"othersStillScanned":true}
```

## Truncation says so

A feed silently cut at a limit reads as "that is everything".

```ts continue
const limited = await collectRecentFiles({
  mainRoot,
  worktreeRoots: new Map([["alpha", wtRoot]]),
  limit: 1,
  now: frozen,
});
JSON.stringify({ files: limited.files.length, truncated: limited.truncated })
=> {"files":1,"truncated":true}
```

```ts cleanup
await Promise.all([
  fs.rm(mainRoot, { recursive: true, force: true }),
  fs.rm(wtRoot, { recursive: true, force: true }),
]);
```
