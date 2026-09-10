# `gitignore-2026-09`: regenerate the ignore file, untrack the state directory

The 2026-08 rename left every existing box with an ignore file that named the
former state directory and lock prefix, so the next autocommit tracked
`.beebox/`, the locks, and the pid file. This migration rewrites `.gitignore`
and untracks exactly those, leaving the shape marker tracked. See
`scripts/migrate/box-gitignore.ts`.

```ts setup
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { untrackableStatePaths } from "../../scripts/migrate/box-gitignore.js";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd }).toString().trim();
}
function runMigration(box, apply) {
  const args = ["--import", "tsx", "scripts/migrate/box-gitignore.ts", box.root];
  if (apply) args.push("--apply");
  return execFileSync(process.execPath, args, { cwd: process.cwd(), stdio: "pipe" }).toString();
}
```

## The allowlist: state directory, box-root locks, pid; never the marker or content

```ts
JSON.stringify(untrackableStatePaths([
  ".beebox/box.json",
  ".beebox/chat-session-id.json",
  ".beebox/chat-models/abc.json",
  ".beebox/mobile-devices.secret.json",
  ".bbx-lock",
  ".bbx-serve.pid",
  ".bbx-trick-commit.lock",
  ".bbx-maps-ignore",
  "store/photo.attach/photo.webp",
  "config/migrations.jsonl",
]))
=> [".beebox/chat-session-id.json",".beebox/chat-models/abc.json",".beebox/mobile-devices.secret.json",".bbx-lock",".bbx-serve.pid",".bbx-trick-commit.lock"]
```

## A box that tracked its state directory gets it untracked, files kept on disk

The fixture is the shape the rename left behind: a pre-rename ignore file and
state files already committed.

```ts
const box = await makeTmpBox({ git: true });
await box.write(".gitignore", "# pre-rename\n.callback-state/\n.old-lock\n");
await box.write(".beebox/chat-session-id.json", "{}\n");
await box.write(".beebox/chat-models/abc.json", "{}\n");
await box.write(".bbx-serve.pid", "123\n");
await box.write(".bbx-trick-commit.lock", "\n");
await box.write("store/note.md", "content stays\n");
await box.commitAll("what autocommit swept in");
const trackedBefore = git(box.root, "ls-files").split("\n").length;

const dryRun = runMigration(box, false);
const trackedAfterDryRun = git(box.root, "ls-files").split("\n").length;
const applied = runMigration(box, true);
const tracked = git(box.root, "ls-files").split("\n");
const ignore = await readFile(join(box.root, ".gitignore"), "utf8");
JSON.stringify({
  trackedBefore,
  dryRunLeavesTracked: trackedAfterDryRun === trackedBefore ? "checked-after" : "n/a",
  dryRunMentions: dryRun.includes("untrack 4 file(s)"),
  appliedSays: applied.trim(),
  stillTrackedState: tracked.filter((p) => p.startsWith(".beebox/") || p.startsWith(".bbx-")),
  storeFileStillTracked: tracked.includes("store/note.md"),
  onDisk: (await readFile(join(box.root, ".bbx-serve.pid"), "utf8")).trim(),
  ignoreHeader: ignore.split("\n")[0],
  ignoresState: ignore.includes("\n.beebox/\n"),
  ignoresLocks: ignore.includes("\n.bbx-*.lock\n") && ignore.includes("\n.bbx-serve.pid\n"),
})
=> {"trackedBefore":54,"dryRunLeavesTracked":"checked-after","dryRunMentions":true,"appliedSays":"[box-gitignore] .gitignore rewritten; untracked 4 state file(s) (still on disk).","stillTrackedState":[".beebox/box.json"],"storeFileStillTracked":true,"onDisk":"123","ignoreHeader":"# Bee Box .gitignore","ignoresState":true,"ignoresLocks":true}
```

Running it again is a no-op apart from rewriting the same file.

```ts continue
runMigration(box, true).trim()
=> [box-gitignore] .gitignore rewritten; nothing was tracked that it now ignores.
```

```ts cleanup
await box.cleanup();
```
