// # Exhibit store lifecycle (bin/lib/exhibits-store.sh)
//
// The exhibit store is the third persistence class
// (`docs/implemented-plans/workstream-exhibits.md` Track A): per-workstream directories
// outside git and outside every worktree, symlink-mounted at
// `<checkout>/exhibits`. These tests drive the sourced bash functions with
// `WT_EXHIBITS_ROOT` pointed at a temp root — the same variable
// `wt_paths_init` sets for real callers.

import { test } from "tap";
import "agent-doctest/tap";
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
// Exit code and stderr from a rejected execFile call; a generic failure when the
// error carries neither.
function failureDetails(error: unknown): { code: number; stderr: string } {
  const record: object = typeof error === "object" && error !== null ? error : {};
  const code = "code" in record && typeof record.code === "number" ? record.code : 1;
  const stderr = "stderr" in record && typeof record.stderr === "string" ? record.stderr : "";
  return { code, stderr };
}

async function sh(script: string) {
  try {
    const r = await execFileAsync("bash", ["-c", `set -u; . "$0"; ${script}`, lib], {
      env: { ...process.env, WT_EXHIBITS_ROOT: store },
    });
    return { code: 0, stderr: r.stderr };
  } catch (error) {
    return failureDetails(error);
  }
}

// A fresh mount creates the store root with its marker, the per-workstream
// directory, and the symlink. Content written through the symlink lands in the
// store; a simulated teardown (`mv` of the whole tree into trash — the exact
// operation `wt_remove_now` performs) takes only the link, and a resume
// re-mount makes the content reachable again.
void test("A fresh mount creates the store root with its marker, the per-workstream dire...", async (t) => {
  // doctest:L47
  const mount = await sh(`wt_exhibits_mount "${wt}" demo`);
  const link = await readlink(join(wt, "exhibits"));
  await writeFile(join(wt, "exhibits/note.md"), "kept\n");

  // doctest:L51
  const trash = join(root, "trash");
  await mkdir(trash);
  await execFileAsync("mv", [wt, join(trash, "wt-demo")]);
  const survivedInStore = await readFile(join(store, "demo/note.md"), "utf8");

  // doctest:L56
  await mkdir(wt, { recursive: true });
  const remount = await sh(`wt_exhibits_mount "${wt}" demo`);
  const backThroughLink = await readFile(join(wt, "exhibits/note.md"), "utf8");
  t.check(
    {
      mounted: mount.code === 0,
      linkTarget: link === join(store, "demo"),
      markerExists: (await lstat(join(store, ".workstream-exhibits"))).isFile(),
      survivedInStore: survivedInStore === "kept\n",
      remounted: remount.code === 0,
      backThroughLink: backThroughLink === "kept\n",
    },
    {
    mounted: true,
    linkTarget: true,
    markerExists: true,
    survivedInStore: true,
    remounted: true,
    backThroughLink: true,
  },
  );
});

// A real `exhibits/` directory (failed mount, then something wrote into the
// tree) is rescued into the store by the next mount, and the mount ends up a
// symlink. A rescue that would overwrite an existing store entry refuses
// instead — fail closed, since the caller's next step is destructive.
void test("A real exhibits/ directory (failed mount, then something wrote into the tree)...", async (t) => {
  // doctest:L76
  const wt2 = join(root, "beebox-worktrees/demo2");
  await mkdir(join(wt2, "exhibits"), { recursive: true });
  await writeFile(join(wt2, "exhibits/stranded.md"), "rescued\n");
  const rescueMount = await sh(`wt_exhibits_mount "${wt2}" demo2`);
  const rescued = await readFile(join(store, "demo2/stranded.md"), "utf8");
  const nowSymlink = (await lstat(join(wt2, "exhibits"))).isSymbolicLink();

  // doctest:L83
  const wt3 = join(root, "beebox-worktrees/demo2-again");
  await mkdir(join(wt3, "exhibits"), { recursive: true });
  await writeFile(join(wt3, "exhibits/stranded.md"), "conflicting\n");
  const collision = await sh(`wt_exhibits_rescue "${wt3}" demo2`);
  t.check(
    {
      rescueMount: rescueMount.code === 0,
      rescued: rescued === "rescued\n",
      nowSymlink,
      collisionRefused: collision.code !== 0 && collision.stderr.includes("REFUSING rescue"),
      originalIntact: (await readFile(join(store, "demo2/stranded.md"), "utf8")) === "rescued\n",
    },
    {
    rescueMount: true,
    rescued: true,
    nowSymlink: true,
    collisionRefused: true,
    originalIntact: true,
  },
  );
});

// The guards: an unmarked directory at the store root is never adopted, and
// `apps` is a reserved namespace (committed apps' runtime data), refused as a
// workstream mount.
void test("The guards:", async (t) => {
  t.teardown(async () => {
    try {
      await rm(root, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L102
  const bareRoot = join(root, "unmarked-store");
  await mkdir(bareRoot);
  const unmarked = await execFileAsync("bash", ["-c", 'set -u; . "$0"; wt_exhibits_ensure_root', lib], {
    env: { ...process.env, WT_EXHIBITS_ROOT: bareRoot },
  }).then(() => ({ code: 0, stderr: "" }), failureDetails);
  const apps = await sh(`wt_exhibits_mount "${wt}" apps`);
  t.check(
    {
      unmarkedRefused: unmarked.code !== 0 && unmarked.stderr.includes("without .workstream-exhibits"),
      appsRefused: apps.code !== 0 && apps.stderr.includes("reserved"),
    },
    {
    unmarkedRefused: true,
    appsRefused: true,
  },
  );
});
