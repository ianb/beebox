# Comment-store mount (bin/lib/comments-store.sh)

The comment store lives outside git and outside every worktree, so a cull cannot
delete a remark. Each checkout gets a gitignored symlink at `<checkout>/comments`
pointing at the whole store — a **read convenience**, because `bin/comments` and
the app both derive the store root themselves. A failed mount therefore costs
convenience and never a comment.

These tests drive the sourced bash functions with `WT_COMMENTS_ROOT` pointed at
a temp root, the same variable `wt_paths_init` sets for real callers.

```ts setup
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, readFile, lstat, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), "..");
const lib = join(repoRoot, "bin/lib/comments-store.sh");
const root = await mkdtemp(join(tmpdir(), "comments-mount-doctest-"));
const store = join(root, "dev-comments");
const wt = join(root, "callback-worktrees/demo");
await mkdir(wt, { recursive: true });

// Run a snippet with the lib sourced and the store root pinned. Returns
// { code, stderr } — these functions never print to stdout by contract, because
// wt_create's stdout is a one-line path contract.
async function sh(script: string) {
  try {
    const r = await execFileAsync("bash", ["-c", `set -u; . "$0"; ${script}`, lib], {
      env: { ...process.env, WT_COMMENTS_ROOT: store },
    });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}
```

## A fresh mount creates the root, its marker, and the link

The whole store mounts, not a per-workstream directory — a comment belongs to a
document, and the namespaces inside the store do the separating.

```ts
const mount = await sh(`wt_comments_mount "${wt}"`);
const link = await readlink(join(wt, "comments"));
const marker = await lstat(join(store, ".dev-comments"));
const mounted = { code: mount.code, pointsAtStore: link === store, marker: marker.isFile(), quietStdout: mount.stdout === "" };
JSON.stringify(mounted)
=> {"code":0,"pointsAtStore":true,"marker":true,"quietStdout":true}
```

## The link survives a cull, because the content was never in the tree

Removing a worktree removes a symlink. This is the property the whole store
location exists for.

```ts continue
await writeFile(join(store, "tracked"), "");
await rm(join(store, "tracked"));
await mkdir(join(store, "tracked"), { recursive: true });
await writeFile(join(store, "tracked/note.md.comments.yaml"), "version: 1\ncomments: []\n");

const trash = join(root, "trash");
await mkdir(trash);
await execFileAsync("mv", [wt, join(trash, "wt-demo")]);
const survived = await readFile(join(store, "tracked/note.md.comments.yaml"), "utf8");

await mkdir(wt, { recursive: true });
const remount = await sh(`wt_comments_mount "${wt}"`);
const throughLink = await readFile(join(wt, "comments/tracked/note.md.comments.yaml"), "utf8");
const afterCull = {
  survivedInStore: survived.startsWith("version: 1"),
  remounted: remount.code === 0,
  readableThroughLink: throughLink === survived,
};
JSON.stringify(afterCull)
=> {"survivedInStore":true,"remounted":true,"readableThroughLink":true}
```

## Mounting is idempotent, and repoints a stale link

Resume runs the same call as create, so it has to self-heal rather than fail.

```ts continue
await execFileAsync("ln", ["-sfn", join(root, "somewhere-else"), join(wt, "comments")]);
const repoint = await sh(`wt_comments_mount "${wt}"`);
const healed = await readlink(join(wt, "comments"));
JSON.stringify({ code: repoint.code, healed: healed === store })
=> {"code":0,"healed":true}
```

## An unmarked root is refused, not adopted

A mistyped `CALLBACK_COMMENTS_ROOT` would otherwise scatter comment files
through an unrelated directory — the same posture the exhibits store takes.

```ts
const stranger = join(root, "someone-elses-dir");
await mkdir(stranger, { recursive: true });
const refused = await execFileAsync("bash", [
  "-c",
  `set -u; . "$0"; wt_comments_mount "${wt}"`,
  lib,
], { env: { ...process.env, WT_COMMENTS_ROOT: stranger } }).then(
  () => ({ code: 0, stderr: "" }),
  (e: { code?: number; stderr?: string }) => ({ code: e.code ?? 1, stderr: e.stderr ?? "" }),
);
JSON.stringify({ code: refused.code, named: refused.stderr.includes("not adopting an unrelated directory") })
=> {"code":1,"named":true}
```

## A real directory at the mount point is left alone

Nothing in this repo writes through the mount, so a real `comments/` directory
means something outside it put files there. Deleting or moving them is not the
mount's call to make: it refuses and says so, and the caller's mount is
best-effort, so the session continues.

```ts
const wt2 = join(root, "callback-worktrees/real-dir");
await mkdir(join(wt2, "comments"), { recursive: true });
await writeFile(join(wt2, "comments/someone-put-this-here.txt"), "keep me\n");
const blocked = await sh(`wt_comments_mount "${wt2}"`);
const stillThere = await readFile(join(wt2, "comments/someone-put-this-here.txt"), "utf8");
JSON.stringify({
  code: blocked.code,
  named: blocked.stderr.includes("is not a symlink"),
  untouched: stillThere === "keep me\n",
})
=> {"code":1,"named":true,"untouched":true}
```

## The gitignore entry has no trailing slash

A dir-only pattern (`comments/`) does not match a symlink, which would make the
mount stageable and let a comment reach git — the lesson recorded at
`.gitignore` for the exhibits mount.

```ts
const ignore = await readFile(join(repoRoot, ".gitignore"), "utf8");
const lines = ignore.split("\n");
JSON.stringify({ exact: lines.includes("/comments"), noSlashForm: !lines.includes("/comments/") })
=> {"exact":true,"noSlashForm":true}
```

Git agrees: the mount is ignored in a real checkout.

```ts continue
const checked = await execFileAsync("git", ["check-ignore", "-v", "comments"], { cwd: repoRoot })
  .then((r) => r.stdout.trim().endsWith("comments"), () => false);
checked
=> true
```

```ts cleanup
await rm(root, { recursive: true, force: true });
```
