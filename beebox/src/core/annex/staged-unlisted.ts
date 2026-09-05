/**
 * The commit-time half of the unlisted-binary guard, reframed from a box-wide
 * filesystem walk (`unlisted-binaries.ts`, still used by `bbx doctor annex` and
 * `attachments verify`) to an **index-based** check.
 *
 * Bytes enter history only via staged blobs, so looking at the index instead of
 * the tree is both faster (no walk — cost scales with the commit, not the box)
 * and better targeted: the check fires at exactly the commit that would embed
 * the bytes, and pre-existing on-disk debris stops blocking unrelated commits.
 *
 * Sizing the **staged blob** rather than the working file also fixes two things
 * the walk got wrong in opposite directions: an annexed file's staged blob is a
 * tiny pointer, so correctly-annexed assets pass naturally; and an allowlisted
 * extension staged as raw bytes — annex misconfigured, the filter not running —
 * is caught instead of waved through by its extension.
 */

import { spawn } from "node:child_process";
import * as path from "node:path";
import { isAssetExtension } from "../../lib/asset-extensions.js";
import { isInAttachScope } from "../../lib/attach-scopes.js";
import { listStagedRelPaths } from "../../lib/staged-files.js";
import {
  UNLISTED_BINARY_LIMIT_BYTES,
  isControlFile,
  type UnlistedBinary,
} from "./unlisted-binaries.js";

/** `git cat-file --batch-check` could not report the staged blob sizes. */
class StagedBlobSizeError extends Error {
  constructor(detail: string) {
    super(`could not read staged blob sizes: ${detail}`);
    this.name = "StagedBlobSizeError";
  }
}

/**
 * A staged path contains a newline, which the newline-delimited
 * `cat-file --batch-check` input cannot express — see `stagedBlobSizes`.
 */
class NewlineStagedPathError extends Error {
  readonly relPath: string;
  constructor(relPath: string) {
    super("staged path contains a newline; the unlisted-binary guard cannot size it");
    this.name = "NewlineStagedPathError";
    this.relPath = relPath;
  }
}

/** A staged blob whose bytes would enter git history unannexed. */
export interface StagedUnlistedBinary extends UnlistedBinary {
  /**
   * True when the extension IS on the asset allowlist yet the staged blob holds
   * the raw bytes anyway — annex should have replaced them with a pointer, so
   * this is a misconfiguration rather than a missing allowlist entry.
   */
  allowlisted: boolean;
}

/**
 * Staged files inside attach scopes whose staged blob exceeds
 * {@link UNLISTED_BINARY_LIMIT_BYTES}. Read-only; returns findings rather than
 * throwing so the caller picks the severity.
 */
export async function findStagedUnlistedBinaries(boxRoot: string): Promise<StagedUnlistedBinary[]> {
  // `T` (typechange) included alongside ACMR: replacing a symlink with a real
  // >1MB file stages a blob whose bytes would enter history exactly like an
  // addition, but git reports it as a type change, not an A or M.
  const candidates = (await listStagedRelPaths(boxRoot, { diffFilter: "ACMRT" })).filter(
    (rel) => isInAttachScope(rel) && !isControlFile(path.basename(rel))
  );
  if (candidates.length === 0) return [];

  const sizes = await stagedBlobSizes(boxRoot, candidates);
  const found: StagedUnlistedBinary[] = [];
  for (const [index, relPath] of candidates.entries()) {
    const size = sizes[index];
    if (size === undefined || size <= UNLISTED_BINARY_LIMIT_BYTES) continue;
    const dot = path.basename(relPath).lastIndexOf(".");
    found.push({
      relPath,
      size,
      extension: dot === -1 ? "" : path.basename(relPath).slice(dot + 1).toLowerCase(),
      allowlisted: isAssetExtension(relPath),
    });
  }
  return found;
}

/**
 * Sizes of the staged (`:0:`) blobs for `relPaths`, positionally aligned with
 * the input; `undefined` where git reports the object missing.
 *
 * One `git cat-file --batch-check` process for the whole list, not one per
 * file: this runs inside the pre-commit hook, where a process spawn per staged
 * asset would cost more than the check saves. The `./` prefix makes each object
 * name resolve relative to `boxRoot` rather than the repository root — the same
 * v2 concern `--relative` handles for the diff.
 */
async function stagedBlobSizes(boxRoot: string, relPaths: string[]): Promise<(number | undefined)[]> {
  // Batch input is newline-delimited, so a path containing a newline would
  // split into two queries and misalign the positional parse below — every
  // size after it would be attributed to the wrong file. Fail closed instead:
  // this guard blocks commits, and a silently wrong answer is worse than a
  // rejected exotic filename.
  const unbatchable = relPaths.find((rel) => rel.includes("\n"));
  if (unbatchable !== undefined) {
    throw new NewlineStagedPathError(unbatchable);
  }
  const stdout = await batchCheck(boxRoot, relPaths.map((rel) => `:0:./${rel}\n`).join(""));
  return stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const fields = line.split(" ");
      const size = Number(fields[2]);
      return fields[1] === "blob" && Number.isFinite(size) ? size : undefined;
    });
}

function batchCheck(boxRoot: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["cat-file", "--batch-check"], { cwd: boxRoot });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { out += chunk; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { err += chunk; });
    child.on("error", (e) => { reject(new StagedBlobSizeError(e.message)); });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(out);
        return;
      }
      const detail = err.trim() === "" ? `git cat-file exited ${String(code)}` : err.trim();
      reject(new StagedBlobSizeError(detail));
    });
    child.stdin.end(input);
  });
}

function describeOne(f: StagedUnlistedBinary): string {
  return `  ${f.relPath} (${Math.round(f.size / 1024)} KB, .${f.extension || "no extension"})`;
}

/**
 * Operator-facing report, split by which of the two problems each finding is.
 * Both remedies are named for the allowlist case, because which one is right is
 * a judgment the reader has to make and this message is the only place the
 * choice is presented.
 */
export function describeStagedUnlistedBinaries(found: StagedUnlistedBinary[]): string {
  const unlisted = found.filter((f) => !f.allowlisted);
  const rawAssets = found.filter((f) => f.allowlisted);
  const sections: string[] = [];

  if (unlisted.length > 0) {
    sections.push([
      `${unlisted.length} staged file(s) in attach scopes have an extension git-annex is not`,
      "configured to annex, so their bytes would be committed into git history:",
      ...unlisted.map(describeOne),
      "",
      "Either add the extension to ASSET_EXTENSIONS (src/lib/asset-extensions.ts) so it",
      "is annexed, or confirm the file belongs in git. This is the check that would have",
      "caught 41 MB .frozen pages before they entered history.",
    ].join("\n"));
  }

  if (rawAssets.length > 0) {
    sections.push([
      `${rawAssets.length} staged file(s) have an annexed extension but were staged as RAW BYTES,`,
      "not as an annex pointer — git-annex is not filtering them:",
      ...rawAssets.map(describeOne),
      "",
      "That is a misconfiguration, not a missing allowlist entry. Run `bbx doctor annex`",
      "to restore the annex filter, then unstage and re-add the file(s).",
    ].join("\n"));
  }

  return sections.join("\n\n");
}
