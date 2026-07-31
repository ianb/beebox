/**
 * Guard against the `.frozen` class of bug.
 *
 * `ASSET_EXTENSIONS` is an allowlist, and an allowlist's failure mode is
 * omission: a new binary type lands in an attach scope, matches nothing, and
 * its bytes go straight into git's object database. That is not hypothetical —
 * it is how `page.frozen` snapshots (up to 41 MB apiece) reached box history
 * before 2026-07-19, and nothing reported it at the time.
 *
 * Under git-annex the same omission has the same consequence, so the allowlist
 * ships with this scan: a large file in an attach scope whose extension is
 * unlisted is a **blocking error**, not an advisory. The remedy is one of two
 * deliberate choices — add the extension to the list, or confirm the file
 * really belongs in git — and both are better than finding out months later
 * from a repository that will not shrink again.
 *
 * Deliberately size-gated rather than extension-blind: attach scopes hold
 * plenty of small committed text (cards, manifests, email bodies, `.csv`
 * exports), and flagging those would train everyone to ignore the check.
 */

import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import { isAssetExtension } from "../../lib/asset-extensions.js";
import { findAttachScopes } from "../../lib/attach-scopes.js";
import { errnoCode } from "../../lib/error-guards.js";

/**
 * Size above which an unlisted file in an attach scope is an error.
 *
 * 1 MB is chosen from the data: on the largest production box, every committed
 * non-allowlist file inside an attach scope is a `.csv` or `.xlsx` export
 * topping out at 58 KB, so the threshold clears existing content by more than
 * an order of magnitude while still catching the 41 MB case that motivated it.
 */
export const UNLISTED_BINARY_LIMIT_BYTES = 1024 * 1024;

/**
 * The scan could not see everything it needed to.
 *
 * A blocking guard that silently skips what it cannot read is not a guard: the
 * staged blob commits anyway and the check reports success. So an incomplete
 * scan is an error the caller must surface, never an empty result.
 */
export class UnlistedScanIncompleteError extends Error {
  readonly relPath: string;
  constructor(relPath: string, cause: unknown) {
    super(`could not scan ${relPath} for unlisted binaries`, { cause });
    this.name = "UnlistedScanIncompleteError";
    this.relPath = relPath;
  }
}

/** A file that would be committed to git as raw bytes without anyone deciding so. */
export interface UnlistedBinary {
  /** Path relative to the box root. */
  relPath: string;
  size: number;
  /** Lowercased extension, or "" when the file has none. */
  extension: string;
}

/** Files this scan never considers, regardless of size. */
function isControlFile(name: string): boolean {
  return name.endsWith(".card") || name === "manifest.json" || name === ".gitattributes";
}

/**
 * Walk every attach scope and report large files whose extension is not in the
 * asset allowlist. Read-only.
 *
 * Returns them rather than throwing so callers choose the severity: the
 * pre-commit hook blocks, `cb doctor annex` reports.
 */
export async function findUnlistedBinaries(boxRoot: string): Promise<UnlistedBinary[]> {
  const found: UnlistedBinary[] = [];
  const scopes = await findAttachScopes(boxRoot);

  for (const scope of scopes) {
    await walkScope({ absDir: scope.absPath, relPrefix: scope.relPath, found });
  }

  return found;
}

/**
 * Walk one attach scope, INCLUDING plain subdirectories.
 *
 * Recursing matters: real boxes keep assets in ordinary subdirectories inside a
 * scope — an email's `attachments/` folder is the common one — so a
 * direct-children-only scan would let exactly those files through. Nested
 * `.attach/` directories are skipped because `findAttachScopes` already returns
 * them as scopes in their own right.
 */
async function walkScope(args: {
  absDir: string;
  relPrefix: string;
  found: UnlistedBinary[];
}): Promise<void> {
  const { absDir, relPrefix, found } = args;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch (e) {
    // ENOENT is a scope that vanished mid-scan — genuinely nothing to report.
    // Anything else means we cannot see part of the tree, and this guard blocks
    // commits, so returning a clean result would be a lie with consequences.
    if (errnoCode(e) === "ENOENT") return;
    throw new UnlistedScanIncompleteError(relPrefix, e);
  }

  for (const entry of entries) {
    const rel = `${relPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name.endsWith(".attach")) continue; // its own scope
      await walkScope({ absDir: path.join(absDir, entry.name), relPrefix: rel, found });
      continue;
    }
    if (!entry.isFile()) continue;
    if (isControlFile(entry.name)) continue;
    if (isAssetExtension(entry.name)) continue;

    let stat;
    try {
      stat = await fs.stat(path.join(absDir, entry.name));
    } catch (e) {
      if (errnoCode(e) === "ENOENT") continue;
      throw new UnlistedScanIncompleteError(rel, e);
    }
    if (stat.size <= UNLISTED_BINARY_LIMIT_BYTES) continue;

    const dot = entry.name.lastIndexOf(".");
    found.push({
      relPath: rel,
      size: stat.size,
      extension: dot === -1 ? "" : entry.name.slice(dot + 1).toLowerCase(),
    });
  }
}

/**
 * Operator-facing report. Names both remedies, because which one is right is a
 * judgment the reader has to make and the message is the only place the choice
 * is presented.
 */
export function describeUnlistedBinaries(found: UnlistedBinary[]): string {
  const lines = found.map(
    (f) => `  ${f.relPath} (${Math.round(f.size / 1024)} KB, .${f.extension || "no extension"})`,
  );
  return [
    `${found.length} large file(s) in attach scopes have an extension git-annex is not`,
    "configured to annex, so their bytes would be committed into git history:",
    ...lines,
    "",
    "Either add the extension to ASSET_EXTENSIONS (src/lib/asset-extensions.ts) so it",
    "is annexed, or confirm the file belongs in git. This is the check that would have",
    "caught 41 MB .frozen pages before they entered history.",
  ].join("\n");
}
