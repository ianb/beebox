# Exhibit store lifecycle (bin/lib/exhibits-store.sh)

The exhibit store is the third persistence class
(`docs/plans/workstream-exhibits.md` Track A): per-workstream directories
outside git and outside every worktree, symlink-mounted at
`<checkout>/exhibits`. These tests drive the sourced bash functions with
`WT_EXHIBITS_ROOT` pointed at a temp root — the same variable
`wt_paths_init` sets for real callers.

```ts setup
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, readFile, lstat, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), "..");
const lib = join(repoRoot, "bin/lib/exhibits-store.sh");
const root = await mkdtemp(join(tmpdir(), "exhibits-store-doctest-"));
const store = join(root, "workstream-exhibits");
const wt = join(root, "beebox-worktrees/demo");
await mkdir(wt, { recursive: true });

// Run a snippet with the lib sourced and the store root pinned. Returns
// { code, stderr } — the functions never print to stdout by contract.
async function sh(script: string) {
  try {
    const r = await execFileAsync("bash", ["-c", `set -u; . "$0"; ${script}`, lib], {
      env: { ...process.env, WT_EXHIBITS_ROOT: store },
    });
    return { code: 0, stderr: r.stderr };
  } catch (e) {
    const err = e as { code?: number; stderr?: string };
    return { code: err.code ?? 1, stderr: err.stderr ?? "" };
  }
}
```

A fresh mount creates the store root with its marker, the per-workstream
directory, and the symlink. Content written through the symlink lands in the
store; a simulated teardown (`mv` of the whole tree into trash — the exact
operation `wt_remove_now` performs) takes only the link, and a resume
re-mount makes the content reachable again.

```ts
const mount = await sh(`wt_exhibits_mount "${wt}" demo`);
const link = await readlink(join(wt, "exhibits"));
await writeFile(join(wt, "exhibits/note.md"), "kept\n");

const trash = join(root, "trash");
await mkdir(trash);
await execFileAsync("mv", [wt, join(trash, "wt-demo")]);
const survivedInStore = await readFile(join(store, "demo/note.md"), "utf8");

await mkdir(wt, { recursive: true });
const remount = await sh(`wt_exhibits_mount "${wt}" demo`);
const backThroughLink = await readFile(join(wt, "exhibits/note.md"), "utf8");
JSON.stringify({
  mounted: mount.code === 0,
  linkTarget: link === join(store, "demo"),
  markerExists: (await lstat(join(store, ".workstream-exhibits"))).isFile(),
  survivedInStore: survivedInStore === "kept\n",
  remounted: remount.code === 0,
  backThroughLink: backThroughLink === "kept\n",
})
=> {"mounted":true,"linkTarget":true,"markerExists":true,"survivedInStore":true,"remounted":true,"backThroughLink":true}
```

A real `exhibits/` directory (failed mount, then something wrote into the
tree) is rescued into the store by the next mount, and the mount ends up a
symlink. A rescue that would overwrite an existing store entry refuses
instead — fail closed, since the caller's next step is destructive.

```ts
const wt2 = join(root, "beebox-worktrees/demo2");
await mkdir(join(wt2, "exhibits"), { recursive: true });
await writeFile(join(wt2, "exhibits/stranded.md"), "rescued\n");
const rescueMount = await sh(`wt_exhibits_mount "${wt2}" demo2`);
const rescued = await readFile(join(store, "demo2/stranded.md"), "utf8");
const nowSymlink = (await lstat(join(wt2, "exhibits"))).isSymbolicLink();

const wt3 = join(root, "beebox-worktrees/demo2-again");
await mkdir(join(wt3, "exhibits"), { recursive: true });
await writeFile(join(wt3, "exhibits/stranded.md"), "conflicting\n");
const collision = await sh(`wt_exhibits_rescue "${wt3}" demo2`);
JSON.stringify({
  rescueMount: rescueMount.code === 0,
  rescued: rescued === "rescued\n",
  nowSymlink,
  collisionRefused: collision.code !== 0 && collision.stderr.includes("REFUSING rescue"),
  originalIntact: (await readFile(join(store, "demo2/stranded.md"), "utf8")) === "rescued\n",
})
=> {"rescueMount":true,"rescued":true,"nowSymlink":true,"collisionRefused":true,"originalIntact":true}
```

The guards: an unmarked directory at the store root is never adopted, and
`apps` is a reserved namespace (committed apps' runtime data), refused as a
workstream mount.

```ts
const bareRoot = join(root, "unmarked-store");
await mkdir(bareRoot);
const unmarked = await execFileAsync("bash", ["-c", 'set -u; . "$0"; wt_exhibits_ensure_root', lib], {
  env: { ...process.env, WT_EXHIBITS_ROOT: bareRoot },
}).then(() => ({ code: 0, stderr: "" }), (e: { code?: number; stderr?: string }) => ({ code: e.code ?? 1, stderr: e.stderr ?? "" }));
const apps = await sh(`wt_exhibits_mount "${wt}" apps`);
JSON.stringify({
  unmarkedRefused: unmarked.code !== 0 && unmarked.stderr.includes("without .workstream-exhibits"),
  appsRefused: apps.code !== 0 && apps.stderr.includes("reserved"),
})
=> {"unmarkedRefused":true,"appsRefused":true}
```

```ts cleanup
await rm(root, { recursive: true, force: true });
```
