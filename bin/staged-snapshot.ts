/**
 * The staged snapshot: a directory holding exactly the commit index's files,
 * so the root pre-commit hook's checks read what the commit records and not
 * the shared working tree, where another agent's unstaged deletion, rename,
 * half-written file, or unregistered doc would otherwise fail or pass them.
 *
 *   node --import tsx bin/staged-snapshot.ts sync --owner <hook pid>
 *       prints "<tree dir>\t<snapshot index>\t<captured tree id>"
 *   node --import tsx bin/staged-snapshot.ts finish --owner <pid> --tree <id>
 *       --index <commit index> --status <hook exit status>
 *
 * Layout under `$BBX_STATE_DIR` (default `~/.cache/beebox`):
 * `staged-snapshots/<basename>-<sha1(top level)[0:8]>/` with `tree/` (the
 * files, plus a `.git` file naming the checkout's git dir), `index` (a
 * private index whose stat data matches `tree/`), `lock/`, and `toplevel`.
 * It persists between commits, so a sync rewrites only what changed.
 *
 * `node_modules/` directories are the one working-tree input: each is a real
 * directory of symlinks to the checkout's entries, except that a workspace
 * link (one that resolves inside the checkout) points at the snapshot's copy.
 * Every other untracked or ignored file is removed on each sync, so no build
 * output carries over from an earlier commit.
 *
 * Fails closed: any git or filesystem error exits nonzero and the hook stops
 * the commit. Plan: beebox/docs/plans/staged-commit-checks.md.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

// ── pure rules (bin/staged-snapshot.test.ts) ────────────────────────────────

/** `<basename>-<first 8 hex of sha1(top level)>`: readable, and distinct for two checkouts sharing a basename. */
export function snapshotDirName(toplevel: string): string {
  return `${basename(toplevel)}-${createHash("sha1").update(toplevel).digest("hex").slice(0, 8)}`;
}

export function snapshotsRoot(env: NodeJS.ProcessEnv): string {
  return join(env.BBX_STATE_DIR ?? join(homedir(), ".cache", "beebox"), "staged-snapshots");
}

/**
 * Where the snapshot's copy of one `node_modules` entry should point. A
 * symlink that resolves inside the checkout and outside every `node_modules/`
 * is a workspace link (`beebox/node_modules/@ianbicking/tap-check ->
 * ../../../tap-check`); it maps to the same path in the snapshot, so a staged
 * check never reads another package's unstaged source or lint rules. Anything
 * else points at the real entry.
 */
export function linkTarget(params: { realEntry: string; resolved: string | null; toplevel: string; snapTop: string }): string {
  const { realEntry, resolved, toplevel, snapTop } = params;
  if (resolved === null) return realEntry;
  const rel = relative(toplevel, resolved);
  const inside = rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep);
  if (!inside || rel.split(sep).includes("node_modules")) return realEntry;
  return join(snapTop, rel);
}

export type LockStep = "acquired" | "wait" | "take-over";

/** What to do about an existing lock: its owner pid, or null when unreadable. */
export function lockStep(params: { owner: number | null; ownerAlive: boolean; self: number }): LockStep {
  if (params.owner === params.self) return "acquired";
  if (params.owner === null || !params.ownerAlive) return "take-over";
  return "wait";
}

// ── the I/O shell ───────────────────────────────────────────────────────────

class GitFailedError extends Error {
  public readonly command: string;
  public readonly status: number;
  public constructor(command: string, status: number) {
    super("a git command failed");
    this.name = "GitFailedError";
    this.command = command;
    this.status = status;
  }
}

class LockHeldError extends Error {
  public readonly owner: number | null;
  public readonly lockDir: string;
  public constructor(owner: number | null, lockDir: string) {
    super("another commit's checks hold the snapshot lock; retry when they finish");
    this.name = "LockHeldError";
    this.owner = owner;
    this.lockDir = lockDir;
  }
}

/** One line for the hook's output: the fixed message plus the error's fields. */
function describe(e: unknown): string {
  if (e instanceof GitFailedError) return `${e.message}: git ${e.command} (exit ${e.status})`;
  if (e instanceof LockHeldError) return `${e.message} (pid ${String(e.owner)}, ${e.lockDir})`;
  return e instanceof Error ? e.message : String(e);
}

interface GitCall {
  args: string[];
  cwd: string;
  index?: string;
}

/** Run git; a nonzero exit throws with git's stderr. `index` overrides `GIT_INDEX_FILE`. */
function runGit(call: GitCall): { stdout: string; status: number } {
  const env = { ...process.env };
  if (call.index !== undefined) env.GIT_INDEX_FILE = call.index;
  const result = spawnSync("git", call.args, { cwd: call.cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error !== undefined) throw result.error;
  return { stdout: result.stdout.replace(/\n$/, ""), status: result.status ?? 1 };
}

function gitOk(call: GitCall): string {
  const result = runGit(call);
  if (result.status !== 0) throw new GitFailedError(call.args.join(" "), result.status);
  return result.stdout;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e instanceof Error && "code" in e && e.code === "EPERM";
  }
}

function readOwner(lockDir: string): number | null {
  try {
    const value = Number.parseInt(readFileSync(join(lockDir, "owner"), "utf8"), 10);
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch (_e) {
    return null;
  }
}

const LOCK_WAIT_MS = 120_000;
const LOCK_POLL_MS = 200;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Hold `lock/` for the whole hook. A plain `git commit` releases index.lock
 * before pre-commit runs, so two hooks in one checkout can overlap.
 */
function acquireLock(lockDir: string, self: number): void {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, "owner"), `${self}\n`);
      return;
    } catch (e) {
      if (!(e instanceof Error && "code" in e && e.code === "EEXIST")) throw e;
    }
    const owner = readOwner(lockDir);
    const step = lockStep({ owner, ownerAlive: owner !== null && pidAlive(owner), self });
    if (step === "acquired") return;
    if (step === "take-over") {
      rmSync(lockDir, { recursive: true, force: true });
      continue;
    }
    if (Date.now() > deadline) throw new LockHeldError(owner, lockDir);
    sleep(LOCK_POLL_MS);
  }
}

function releaseLock(lockDir: string, self: number): void {
  if (readOwner(lockDir) === self) rmSync(lockDir, { recursive: true, force: true });
}

/** Make `path` a symlink to `target`, replacing whatever is there unless it already is one. */
function ensureSymlink(path: string, target: string): void {
  try {
    if (lstatSync(path).isSymbolicLink() && readlinkSync(path) === target) return;
    rmSync(path, { recursive: true, force: true });
  } catch (_e) {
    // absent: create below
  }
  symlinkSync(target, path);
}

interface LinkContext {
  toplevel: string;
  snapTop: string;
}

function resolvedLink(path: string): string | null {
  return lstatSync(path).isSymbolicLink() ? resolve(dirname(path), readlinkSync(path)) : null;
}

/** True when a scope directory (`@ianbicking/`) holds a workspace link, so it must be rebuilt rather than linked whole. */
function holdsWorkspaceLink(ctx: LinkContext, realDir: string): boolean {
  return readdirSync(realDir).some((name) => {
    const realEntry = join(realDir, name);
    return linkTarget({ realEntry, resolved: resolvedLink(realEntry), ...ctx }) !== realEntry;
  });
}

/** Mirror one `node_modules` directory (or a scope inside one) as symlinks, pruning entries the real one lacks. */
function mirrorModules(ctx: LinkContext, dirs: { realDir: string; snapDir: string }): void {
  const { realDir, snapDir } = dirs;
  if (existsSync(snapDir) && lstatSync(snapDir).isSymbolicLink()) rmSync(snapDir);
  mkdirSync(snapDir, { recursive: true });
  const realNames = new Set<string>();
  for (const entry of readdirSync(realDir, { withFileTypes: true })) {
    realNames.add(entry.name);
    const realEntry = join(realDir, entry.name);
    const snapEntry = join(snapDir, entry.name);
    if (entry.isDirectory() && entry.name.startsWith("@") && holdsWorkspaceLink(ctx, realEntry)) {
      mirrorModules(ctx, { realDir: realEntry, snapDir: snapEntry });
      continue;
    }
    ensureSymlink(snapEntry, linkTarget({ realEntry, resolved: resolvedLink(realEntry), ...ctx }));
  }
  for (const name of readdirSync(snapDir)) {
    if (!realNames.has(name)) rmSync(join(snapDir, name), { recursive: true, force: true });
  }
}

interface Snapshot {
  dir: string;
  tree: string;
  index: string;
  lock: string;
}

function snapshotPaths(toplevel: string): Snapshot {
  const dir = join(snapshotsRoot(process.env), snapshotDirName(toplevel));
  return { dir, tree: join(dir, "tree"), index: join(dir, "index"), lock: join(dir, "lock") };
}

function checkout(): { toplevel: string; gitDir: string } {
  const cwd = process.cwd();
  return {
    toplevel: gitOk({ args: ["rev-parse", "--show-toplevel"], cwd }),
    gitDir: gitOk({ args: ["rev-parse", "--absolute-git-dir"], cwd }),
  };
}

function sync(owner: number): void {
  const { toplevel, gitDir } = checkout();
  const snap = snapshotPaths(toplevel);
  mkdirSync(snap.dir, { recursive: true });
  acquireLock(snap.lock, owner);
  // The commit index is whatever git handed the hook (GIT_INDEX_FILE).
  const captured = gitOk({ args: ["write-tree"], cwd: toplevel });
  const marker = join(snap.dir, "toplevel");
  if (!existsSync(marker) || readFileSync(marker, "utf8") !== toplevel) {
    rmSync(snap.tree, { recursive: true, force: true });
    rmSync(snap.index, { force: true });
    writeFileSync(marker, toplevel);
  }
  mkdirSync(snap.tree, { recursive: true });
  const inSnap = (args: string[]): string =>
    gitOk({ args: [`--git-dir=${gitDir}`, `--work-tree=${snap.tree}`, ...args], cwd: snap.tree, index: snap.index });
  inSnap(["read-tree", "--reset", "-u", captured]);
  inSnap(["clean", "-ffdqx", "-e", "node_modules"]);
  writeFileSync(join(snap.tree, ".git"), `gitdir: ${gitDir}\n`);
  const ctx: LinkContext = { toplevel, snapTop: snap.tree };
  const packageDirs = inSnap(["ls-files", "-z", "--", "package.json", "*/package.json"])
    .split("\0")
    .filter((path) => path !== "")
    .map(dirname);
  for (const pkg of packageDirs) {
    const realModules = join(toplevel, pkg, "node_modules");
    const snapModules = join(snap.tree, pkg, "node_modules");
    if (existsSync(realModules)) mirrorModules(ctx, { realDir: realModules, snapDir: snapModules });
    else rmSync(snapModules, { recursive: true, force: true });
  }
  process.stdout.write(`${snap.tree}\t${snap.index}\t${captured}\n`);
}

interface FinishArgs {
  owner: number;
  tree: string;
  commitIndex: string;
  status: number;
}

/**
 * After the checks: the commit index, the snapshot index, and the snapshot
 * files must all still be the captured tree. A plain commit rereads the index
 * after pre-commit, so a `git add` from another agent during the checks would
 * otherwise land unchecked; the window left is the moment after this returns.
 */
function finish(args: FinishArgs): number {
  const { toplevel, gitDir } = checkout();
  const snap = snapshotPaths(toplevel);
  try {
    if (args.status !== 0) return args.status;
    const problems: string[] = [];
    const commitTree = gitOk({ args: ["write-tree"], cwd: toplevel, index: args.commitIndex });
    if (commitTree !== args.tree) problems.push("the commit index changed while the checks ran (another `git add`?)");
    const inSnap = [`--git-dir=${gitDir}`, `--work-tree=${snap.tree}`];
    const snapTree = gitOk({ args: [...inSnap, "write-tree"], cwd: snap.tree, index: snap.index });
    if (snapTree !== args.tree) problems.push("a check changed the snapshot's index");
    const diff = runGit({ args: [...inSnap, "diff", "--quiet"], cwd: snap.tree, index: snap.index });
    if (diff.status !== 0) problems.push("a check changed tracked files in the snapshot");
    for (const problem of problems) console.error(`[pre-commit] staged snapshot: ${problem}; commit again`);
    return problems.length > 0 ? 1 : 0;
  } finally {
    releaseLock(snap.lock, args.owner);
  }
}

class UsageError extends Error {
  public constructor() {
    super(
      "usage: staged-snapshot.ts sync --owner <pid> | finish --owner <pid> --tree <id> --index <path> --status <n>",
    );
    this.name = "UsageError";
  }
}

function flag(argv: string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  if (value === undefined) throw new UsageError();
  return value;
}

function intFlag(argv: string[], name: string): number {
  const value = Number.parseInt(flag(argv, name), 10);
  if (!Number.isInteger(value)) throw new UsageError();
  return value;
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  if (command === "sync") {
    sync(intFlag(rest, "--owner"));
    return 0;
  }
  if (command === "finish") {
    return finish({
      owner: intFlag(rest, "--owner"),
      tree: flag(rest, "--tree"),
      commitIndex: flag(rest, "--index"),
      status: intFlag(rest, "--status"),
    });
  }
  throw new UsageError();
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`[pre-commit] staged snapshot: ${describe(e)}`);
    process.exitCode = 1;
  }
}
