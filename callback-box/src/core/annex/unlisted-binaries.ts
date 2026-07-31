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
import * as path from "node:path";
import { isAssetExtension } from "../../lib/asset-extensions.js";
import { findAttachScopes } from "../asset-manifest-scan.js";
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
    let entries: string[];
    try {
      entries = await fs.readdir(scope.absPath);
    } catch (e) {
      // A scope that vanished between listing and reading contributes nothing.
      // Anything other than that is worth surfacing rather than swallowing.
      if (errnoCode(e) !== "ENOENT") {
        console.warn(`Could not read attach scope ${scope.relPath} while scanning for unlisted binaries:`, e);
      }
      continue;
    }

    for (const name of entries) {
      if (isControlFile(name)) continue;
      if (isAssetExtension(name)) continue;

      const abs = path.join(scope.absPath, name);
      let stat;
      try {
        stat = await fs.stat(abs);
      } catch (e) {
        if (errnoCode(e) !== "ENOENT") {
          console.warn(`Could not stat ${scope.relPath}/${name}:`, e);
        }
        continue;
      }
      // Nested scopes are walked as their own scope by findAttachScopes.
      if (!stat.isFile()) continue;
      if (stat.size <= UNLISTED_BINARY_LIMIT_BYTES) continue;

      const dot = name.lastIndexOf(".");
      found.push({
        relPath: `${scope.relPath}/${name}`,
        size: stat.size,
        extension: dot === -1 ? "" : name.slice(dot + 1).toLowerCase(),
      });
    }
  }

  return found;
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
