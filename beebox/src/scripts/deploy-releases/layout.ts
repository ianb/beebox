// Release layout and switching for production deploys; see cli.ts.
import * as fs from "node:fs";
import * as path from "node:path";

export const FAILED_MARK = ".bbx-release-failed";
export const PREVIOUS = "previous";

export interface Layout {
  installDir: string;
  releasesDir: string;
  previousLink: string;
}

export function layoutFor(installDir: string): Layout {
  const releasesDir = `${installDir}.releases`;
  return { installDir, releasesDir, previousLink: path.join(releasesDir, PREVIOUS) };
}

const USAGE = "prepare --stage S --name N -- <member>... | switch --to R | rollback --boxes-root B [--from R] [--check] | status, each with --install-dir D";

export type Refusal =
  | { kind: "usage"; command: string | undefined }
  | { kind: "invalid-name"; name: string }
  | { kind: "missing-member"; source: string }
  | { kind: "release-exists"; release: string }
  | { kind: "deploy-info"; file: string }
  | { kind: "outside-releases"; release: string; releasesDir: string }
  | { kind: "incomplete"; release: string }
  | { kind: "install-dir-kind"; installDir: string }
  | { kind: "rollback"; reason: string };

function describeRefusal(refusal: Refusal): string {
  switch (refusal.kind) {
    case "usage": return `unknown or incomplete command ${refusal.command ?? "(none)"}; usage: ${USAGE}`;
    case "invalid-name": return `invalid release name: ${refusal.name}`;
    case "missing-member": return `stage member missing: ${refusal.source}`;
    case "release-exists": return `release ${refusal.release} already exists`;
    case "deploy-info": return `${refusal.file} is missing or not a JSON object`;
    case "outside-releases": return `${refusal.release} is not in ${refusal.releasesDir}`;
    case "incomplete": return `${refusal.release} has no beebox/dist/cli.mjs or node_modules; not switching`;
    case "install-dir-kind": return `${refusal.installDir} is neither a directory nor a link`;
    case "rollback": return `rollback refused: ${refusal.reason}`;
  }
}

/** A request this helper refuses; the message says why and what to do instead. */
export class ReleaseRefusedError extends Error {
  readonly refusal: Refusal;
  constructor(refusal: Refusal) {
    super(describeRefusal(refusal));
    this.name = "ReleaseRefusedError";
    this.refusal = refusal;
  }
}

export function realOrNull(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch (e) {
    if (isErrno(e, "ENOENT")) return null;
    throw e;
  }
}

function isErrno(e: unknown, code: string): boolean {
  return e instanceof Error && "code" in e && e.code === code;
}

/** The live release, or null while the install dir is a real directory or absent. */
export function liveRelease(layout: Layout): string | null {
  const stat = lstatOrNull(layout.installDir);
  if (!stat?.isSymbolicLink()) return null;
  return realOrNull(layout.installDir);
}

export function previousRelease(layout: Layout): string | null {
  return realOrNull(layout.previousLink);
}

function lstatOrNull(p: string): fs.Stats | null {
  try {
    return fs.lstatSync(p);
  } catch (e) {
    if (isErrno(e, "ENOENT")) return null;
    throw e;
  }
}

export function isComplete(release: string): boolean {
  return fs.existsSync(path.join(release, "beebox", "dist", "cli.mjs"))
    && fs.statSync(path.join(release, "node_modules"), { throwIfNoEntry: false })?.isDirectory() === true;
}

/**
 * Names of releases a running process was started from. `bin/bbx` execs node
 * on the bundle's real path, so a process's command line names its release.
 * A backup or scheduler pass is not stopped by a deploy and can outlive two
 * of them. Empty where there is no /proc.
 */
export function releasesInUse(layout: Layout): Set<string> {
  if (!fs.existsSync("/proc/self/cmdline") || !fs.existsSync(layout.releasesDir)) return new Set();
  const dirs = [layout.releasesDir, fs.realpathSync(layout.releasesDir)];
  const cmdlines: string[] = [];
  for (const pid of fs.readdirSync("/proc").filter((entry) => /^\d+$/.test(entry))) {
    try {
      cmdlines.push(fs.readFileSync(`/proc/${pid}/cmdline`, "utf8"));
    } catch (_e) {
      continue; // the process exited between the listing and the read
    }
  }
  return releasesNamedIn(cmdlines, dirs);
}

/** Release names that NUL-separated command lines run from, given the releases dir's spellings. */
export function releasesNamedIn(cmdlines: string[], releasesDirs: string[]): Set<string> {
  const prefixes = [...new Set(releasesDirs)].map((dir) => `${dir}/`);
  const names = new Set<string>();
  for (const arg of cmdlines.flatMap((cmdline) => cmdline.split("\0"))) {
    const prefix = prefixes.find((p) => arg.startsWith(p));
    const name = prefix === undefined ? "" : arg.slice(prefix.length).split("/")[0];
    if (name !== undefined && name !== "") names.add(name);
  }
  return names;
}

/** Delete every entry of the releases dir except the live and previous releases and any in use. Returns the names removed. */
export function pruneReleases(layout: Layout, inUse: Set<string>): string[] {
  if (!fs.existsSync(layout.releasesDir)) return [];
  const keep = new Set([PREVIOUS, ...inUse]);
  for (const release of [liveRelease(layout), previousRelease(layout), realOrNull(layout.installDir)]) {
    if (release !== null && path.dirname(release) === fs.realpathSync(layout.releasesDir)) keep.add(path.basename(release));
  }
  const removed: string[] = [];
  for (const name of fs.readdirSync(layout.releasesDir).toSorted()) {
    if (keep.has(name)) continue;
    fs.rmSync(path.join(layout.releasesDir, name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}
function replaceLink(link: string, target: string): void {
  const tmp = path.join(path.dirname(link), `.${path.basename(link)}.tmp-${String(process.pid)}`);
  fs.rmSync(tmp, { force: true });
  fs.symlinkSync(target, tmp);
  // rename(2) replaces the old link in one step: a reader sees the old
  // target or the new one, never a missing path.
  fs.renameSync(tmp, link);
}

function stamp(): string {
  return new Date().toISOString().replace(/[:-]/g, "").replace(/\.\d+Z$/, "Z");
}

/** Point the install dir at `to`. Returns the release it replaced, if any. */
export function switchRelease(layout: Layout, to: string): string | null {
  const target = fs.realpathSync(to);
  if (path.dirname(target) !== fs.realpathSync(layout.releasesDir)) throw new ReleaseRefusedError({ kind: "outside-releases", release: to, releasesDir: layout.releasesDir });
  if (!isComplete(target)) throw new ReleaseRefusedError({ kind: "incomplete", release: to });
  const stat = lstatOrNull(layout.installDir);
  const restorePrevious = previousRestorer(layout.previousLink);
  if (stat?.isSymbolicLink()) {
    const from = realOrNull(layout.installDir);
    // The rollback target is recorded before live changes. If the live link
    // then cannot change, the old target comes back, so a failed switch
    // leaves both links as they were.
    if (from !== null && from !== target) replaceLink(layout.previousLink, from);
    try {
      replaceLink(layout.installDir, target);
    } catch (e) {
      restorePrevious();
      throw e;
    }
    return from;
  }
  if (stat === null) {
    replaceLink(layout.installDir, target);
    return null;
  }
  if (!stat.isDirectory()) throw new ReleaseRefusedError({ kind: "install-dir-kind", installDir: layout.installDir });
  if (fs.readdirSync(layout.installDir).length === 0) {
    fs.rmdirSync(layout.installDir);
    replaceLink(layout.installDir, target);
    return null;
  }
  // The legacy tree: a real directory cannot be replaced by a link in one
  // rename, so the path is absent between these two renames. This happens
  // once per host, inside the deploy window with the services stopped.
  const legacy = path.join(layout.releasesDir, `legacy-${stamp()}`);
  fs.renameSync(layout.installDir, legacy);
  try {
    replaceLink(layout.previousLink, legacy);
    replaceLink(layout.installDir, target);
  } catch (e) {
    restorePrevious();
    fs.renameSync(legacy, layout.installDir);
    throw e;
  }
  return legacy;
}

/** A function that puts the `previous` link back as it is now (absent, or its current target). */
function previousRestorer(previousLink: string): () => void {
  const target = lstatOrNull(previousLink)?.isSymbolicLink() === true ? fs.readlinkSync(previousLink) : null;
  return () => {
    try {
      if (target === null) fs.rmSync(previousLink, { force: true });
      else replaceLink(previousLink, target);
    } catch (e) {
      console.error(`  could not restore ${previousLink}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
}
