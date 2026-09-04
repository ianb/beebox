# one-root migration: rollback restoration failures skip destructive cleanup

`rollbackMoveAndCommit` (`src/core/migrations/one-root-rollback.ts`) is what
`moveAndCommitBox`'s `catch` calls when a step before the migration's final
commit throws. Finding 1 (Track E hardening review, round 3): before this
fix, a failed restore-on-rollback (an untracked rename that couldn't be
undone, or `.beebox` itself failing to rename back) still fell through to
the destructive cleanup tail — stray package-root entry removal, then `git
clean -fd` via `revertToSnapshot` — which could delete whatever landed at
the un-restored destination (e.g. a secret that never made it back to its
pre-migration path). Now ANY restoration failure skips that whole tail and
throws `OneRootRollbackError` instead, leaving the tree exactly as the failed
restore left it.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { rollbackMoveAndCommit } from "../../../src/core/migrations/one-root-rollback.js";
import { OneRootRollbackError } from "../../../src/core/migrations/one-root-errors.js";

async function mkTmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bbx-rollback-"));
}
async function cleanup(root) {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
```

## A failed rename-back preserves the secret AND skips the destructive cleanup tail entirely

`oldAbs`'s parent (`blocked/content`) is occupied by a plain FILE, so the
rename-back's `fs.mkdir(dirname(oldAbs), { recursive: true })` fails and the
rename itself can never land — the secret stays exactly where the failed
migration left it (`newAbs`), and a marker file elsewhere in the package
root — the kind `git clean -fd` would otherwise sweep up — survives because
the cleanup tail never runs at all.

```ts
const root = await mkTmp();
await fs.writeFile(path.join(root, "blocked"), "not a directory\n");
await fs.mkdir(path.join(root, "_config"), { recursive: true });
await fs.writeFile(path.join(root, "_config", "secret.txt"), "shh\n");
await fs.mkdir(path.join(root, "stray-dir"), { recursive: true });
await fs.writeFile(path.join(root, "stray-dir", "marker.txt"), "would be swept by git clean\n");

const untrackedRenames = [
  {
    oldAbs: path.join(root, "blocked", "content", "secret.txt"),
    newAbs: path.join(root, "_config", "secret.txt"),
    wasIgnored: true,
  },
];
const err = await rollbackMoveAndCommit({
  packageRoot: root,
  contentRoot: path.join(root, "content"),
  preSha: "0000000000000000000000000000000000000000",
  beeboxMoved: false,
  originalMarkerBytes: null,
  originalHistoryBytes: null,
  untrackedRenames,
  error: new Error("induced migration failure"),
}).catch((e) => e);

JSON.stringify({
  isRollbackError: err instanceof OneRootRollbackError,
  causeMessage: err.cause?.message,
  mentionsSecretPath: err.message.includes(path.join(root, "_config", "secret.txt")),
})
=> {"isRollbackError":true,"causeMessage":"induced migration failure","mentionsSecretPath":true}
```

The secret is still on disk at its (failed-restore) destination, untouched:

```ts continue
await fs.readFile(path.join(root, "_config", "secret.txt"), "utf-8")
=> shh
```

The marker `git clean -fd` would have swept up survives — the destructive
cleanup tail never ran:

```ts continue
await fs.readFile(path.join(root, "stray-dir", "marker.txt"), "utf-8")
=> would be swept by git clean
```

```ts cleanup
await cleanup(root);
```

## When every restoration succeeds, an untracked symlink's ORIGINAL target is restored — not the migration's rewritten one

Finding 6: `newAbs` is a symlink already holding the migration's rewritten
(post-move-depth) target text. The journal entry's `originalLinkTarget` is
what `remapMovedSymlinkTargets` recorded before it rewrote that text —
rollback's job is to put the ORIGINAL back once the entry itself is renamed
back to its pre-migration path, not leave the migration's target sitting
there under a path that looks untouched.

```ts
const root2 = await mkTmp();
execSync(
  'git init -q -b main && git config user.email t@test.local && git config user.name Test',
  { cwd: root2, stdio: "pipe" },
);
await fs.writeFile(path.join(root2, ".gitignore"), "content/\n");
execSync('git add -A && git commit -q -m init', { cwd: root2, stdio: "pipe" });
const preSha = execSync("git rev-parse HEAD", { cwd: root2, encoding: "utf-8" }).trim();

await fs.mkdir(path.join(root2, "_content", "drive"), { recursive: true });
await fs.symlink("photo-NEW.bin", path.join(root2, "_content", "drive", "photo-link.bin"));

const journal2 = [
  {
    oldAbs: path.join(root2, "content", "store", "drive", "photo-link.bin"),
    newAbs: path.join(root2, "_content", "drive", "photo-link.bin"),
    wasIgnored: true,
    originalLinkTarget: "photo-ORIGINAL.bin",
  },
];
const err2 = await rollbackMoveAndCommit({
  packageRoot: root2,
  contentRoot: path.join(root2, "content"),
  preSha,
  beeboxMoved: false,
  originalMarkerBytes: null,
  originalHistoryBytes: null,
  untrackedRenames: journal2,
  error: new Error("induced migration failure 2"),
}).catch((e) => e);
err2.message
=> induced migration failure 2
```

The link is back at its pre-migration path, pointing at its ORIGINAL target
— not the rewritten `photo-NEW.bin`:

```ts continue
await fs.readlink(path.join(root2, "content", "store", "drive", "photo-link.bin"))
=> photo-ORIGINAL.bin
```

```ts cleanup
await cleanup(root2);
```
