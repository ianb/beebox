/**
 * Resolve `file:` URLs to on-disk paths and compute version markers for the
 * commentary surface's live wrapper (see `docs/plans/box-commentary-surface.md`
 * Track B). **Dev-only** — the route that exposes this is mounted only behind a
 * dev flag; the boxholder already runs agents with full machine read access, so
 * the allowlist + realpath guard here is hygiene (keep the route's intent
 * honest, catch accidental traversal), not a hardened security boundary.
 *
 * `resolveExternalRef` is the *only* code that turns a `file:` URL into a
 * filesystem path; callers never construct paths themselves.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Base for every external-ref resolution failure; carries the offending value. */
export class ExternalRefError extends Error {
  readonly value: string;
  constructor(message: string, value: string) {
    super(message);
    this.name = "ExternalRefError";
    this.value = value;
  }
}

export class MalformedUrlError extends ExternalRefError {
  constructor(href: string) {
    super("Malformed URL", href);
    this.name = "MalformedUrlError";
  }
}
export class NotFileUrlError extends ExternalRefError {
  constructor(href: string) {
    super("Not a file: URL", href);
    this.name = "NotFileUrlError";
  }
}
class TargetNotFoundError extends ExternalRefError {
  constructor(absPath: string) {
    super("Target not found", absPath);
    this.name = "TargetNotFoundError";
  }
}
class PathNotAllowedError extends ExternalRefError {
  constructor(absPath: string) {
    super("Path is not under an allowed root", absPath);
    this.name = "PathNotAllowedError";
  }
}
class DeniedPathError extends ExternalRefError {
  constructor(absPath: string) {
    super("Denied path", absPath);
    this.name = "DeniedPathError";
  }
}

/** The `rel` path under the first matching root, or null if under none. */
function relUnderRoot(real: string, roots: string[]): string | null {
  for (const root of roots) {
    const rel = path.relative(root, real);
    // `path.relative` (not `startsWith`): `/foo` does not "contain" `/foobar`.
    // In-bounds iff the rel path stays inside the root.
    if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
  }
  return null;
}

function isDeniedRel(rel: string, basename: string): boolean {
  const segments = rel.split(path.sep);
  if (segments.some((seg) => seg === ".git" || seg === "node_modules")) return true;
  return /^\.env(\.|$)/.test(basename);
}

/**
 * Resolve a `file:` href to a real, allowlisted, read-only-safe absolute path.
 * Throws `ExternalRefError` for: a non-`file:` URL, a malformed URL, a missing
 * target, a path outside every allowed root (after `realpath`, so symlink
 * escapes are caught), or a denylisted path (`.git/`, `node_modules`, `.env*`).
 */
export async function resolveExternalRef(href: string, opts: { roots: string[] }): Promise<string> {
  let url: URL;
  try {
    url = new URL(href);
  } catch (_e) {
    throw new MalformedUrlError(href);
  }
  if (url.protocol !== "file:") {
    throw new NotFileUrlError(href);
  }
  // `url.pathname` already drops any query/fragment (the Vite `?raw` lesson).
  const abs = decodeURIComponent(url.pathname);

  let real: string;
  try {
    real = await fs.realpath(abs);
  } catch (_e) {
    throw new TargetNotFoundError(abs);
  }

  const rel = relUnderRoot(real, opts.roots);
  if (rel === null) {
    throw new PathNotAllowedError(real);
  }
  if (isDeniedRel(rel, path.basename(real))) {
    throw new DeniedPathError(real);
  }
  return real;
}

/** Last commit that modified `absPath` (short hash), or null if untracked / no repo. */
function lastModifyingCommit(absPath: string): string | null {
  try {
    const out = execFileSync(
      "git",
      ["-C", path.dirname(absPath), "log", "-1", "--format=%h", "--", path.basename(absPath)],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return out === "" ? null : out;
  } catch (_e) {
    return null;
  }
}

/**
 * Version markers for `absPath`, space-separated `kind:value`:
 *  - `sha256:<short-hex>` of the current on-disk bytes — the **drift primary**
 *    (the only marker that pins a dirty/uncommitted file's exact state).
 *  - `git:<rev>` = the last commit that modified the path — **supplementary,
 *    for diffing only** (omitted when the file is untracked). A worktree HEAD is
 *    deliberately not used: it changes when any file commits and doesn't change
 *    on a dirty edit, so it's wrong as a drift signal.
 */
export async function buildVersionMarkers(absPath: string): Promise<string> {
  const bytes = await fs.readFile(absPath);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const markers = [`sha256:${hash}`];
  const rev = lastModifyingCommit(absPath);
  if (rev !== null) markers.push(`git:${rev}`);
  return markers.join(" ");
}

/** The full stamped state of an external file: drift markers + size + mtime. */
export interface ExternalStamp {
  /** `buildVersionMarkers` output — `sha256:<hex>` (drift primary) + optional `git:<rev>`. */
  version: string;
  /** File size in bytes. */
  size: number;
  /** File mtime as a full ISO instant. */
  mtime: string;
}

/**
 * Build the full stamp an extfile card records: the version markers (the drift
 * signal) plus `size`/`mtime` (informational). One definition of "the file's
 * stamped state" so `bbx extfile sync` and any future stamper agree.
 */
export async function buildExternalStamp(absPath: string): Promise<ExternalStamp> {
  const version = await buildVersionMarkers(absPath);
  const stat = await fs.stat(absPath);
  return { version, size: stat.size, mtime: stat.mtime.toISOString() };
}
