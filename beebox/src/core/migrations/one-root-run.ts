/**
 * The `one-root` migration's orchestration (Track E, `docs/plans/one-root-box-layout.md`).
 * Converts a v2 box (package root + nested `content/`) to v3 (one root) in
 * place, atomically, as one commit. `scripts/migrate/one-root.ts` is the thin
 * CLI wrapper; this module is importable directly so doctests exercise the
 * real logic without spawning a subprocess.
 *
 * Order (see the plan's numbered steps 1–8):
 *  1. Preflight: clean tree, no running processes (lock files), v2
 *     package-root closed-vocabulary check.
 *  2. `git mv` every `content/` file per `one-root-mapping.ts`; `content/CLAUDE.md`
 *     merges into the root `CLAUDE.md` instead of moving.
 *  3. `.beebox/` — filesystem rename, not git (gitignored runtime state).
 *  4. Marker bump to shapeVersion 3.
 *  5. `bbx init` tail: regenerates `.gitignore`/`.gitattributes` (the v3
 *     merged form), ensures directories, rules/guide/docs/search index.
 *  6. Ref rewrite across every card/doc (`one-root-ref-rewrite.ts`).
 *  7. Hard link gate (`one-root-link-gate.ts`) — refuses to commit on any
 *     dangling ref.
 *  8. `git add -A` + one commit `migrate: one-root`; THEN the external
 *     manifests (`hub.json`, `boxes.json`) are updated — outside the box's
 *     own repo, so they're touched only once the box's own commit is safe.
 *
 * Nothing commits until the very end, so rollback on any failure is: rename
 * `.beebox` back (if it moved), then `revertToSnapshot` (git reset --hard +
 * clean) to the pre-migration SHA. The external manifests are never touched
 * before the commit succeeds, so there's nothing to revert there.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getStatus, getHead, revertToSnapshot, stageAll, commit } from "../../lib/git.js";
import { initBox } from "../box/index.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import { getBoxTimeISO } from "../../lib/time.js";
import { runInit } from "../../cli/commands/init.js";
import { appendManifestEntry } from "../migration-run.js";
import { mapV2Path } from "./one-root-mapping.js";
import { rewriteOneRootRefs } from "./one-root-ref-rewrite.js";
import { runOneRootLinkGate } from "./one-root-link-gate.js";
import { updateManifestsForOneRoot } from "./one-root-manifests.js";

const execFileAsync = promisify(execFile);

/** v2 lock-file names, checked at the OLD operational root (`content/`) —
 * see `box/index.ts`'s `.gitignore` block for the current names. */
const V2_LOCK_FILES = [".bbx-lock", ".bbx-reactor.lock", ".bbx-serve.pid"];

/** The v2 package root's closed vocabulary (never formalized as data the way
 * `BOX_ROOT_VOCABULARY` is for v3 — this migration is the one place that
 * needs it, so it's inlined here rather than resurrecting a whole v2 spec
 * module for one check). */
const V2_PACKAGE_ROOT_VOCABULARY = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "tsconfig.json",
  "node_modules",
  ".git",
  ".gitignore",
  ".gitattributes",
  "CLAUDE.md",
  ".claude",
  "src",
  "content",
  "README.md",
  "views",
  ".DS_Store",
]);

export class OneRootPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OneRootPreflightError";
  }
}

export class OneRootLinkGateError extends Error {
  constructor(report: string) {
    super(report);
    this.name = "OneRootLinkGateError";
  }
}

async function preflight(params: { packageRoot: string; contentRoot: string }): Promise<void> {
  const status = await getStatus(params.packageRoot);
  if (!status.clean) {
    throw new OneRootPreflightError(
      params.packageRoot + ": working tree is not clean. Commit or stash before migrating.",
    );
  }

  for (const lockFile of V2_LOCK_FILES) {
    const exists = await fs
      .access(path.join(params.contentRoot, lockFile))
      .then(() => true)
      .catch(() => false);
    if (exists) {
      throw new OneRootPreflightError(
        params.contentRoot + "/" + lockFile +
          " is present — stop this box's serve/reactor/scheduler processes before migrating.",
      );
    }
  }

  const entries = await fs.readdir(params.packageRoot);
  const strays = entries.filter((e) => !V2_PACKAGE_ROOT_VOCABULARY.has(e));
  if (strays.length > 0) {
    throw new OneRootPreflightError(
      `${params.packageRoot}: unexpected package-root entries outside the v2 vocabulary: ${strays.join(", ")}. ` +
        "Reconcile by hand (compare against content/ and any diverged copies — do not blind-delete) before migrating.",
    );
  }
}

interface PlannedMove {
  contentRelPath: string;
  newRelPath: string;
}

/** Walk `content/` (skipping `.beebox/`) and map every file. Pure planning
 * pass — throws with the FULL unmapped list before any mutation happens. */
async function planMoves(contentRoot: string): Promise<{ moves: PlannedMove[]; claudeMdMerge: boolean }> {
  const moves: PlannedMove[] = [];
  let claudeMdMerge = false;
  const unmapped: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (dir === contentRoot && entry.name === ".beebox") continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const contentRelPath = path.relative(contentRoot, abs).split(path.sep).join("/");
      const mapped = mapV2Path(contentRelPath);
      switch (mapped.kind) {
        case "move":
          moves.push({ contentRelPath, newRelPath: mapped.newPath });
          break;
        case "merge-claude-md":
          claudeMdMerge = true;
          break;
        case "discard":
          break;
        case "unmapped":
          unmapped.push(contentRelPath);
          break;
      }
    }
  }
  await walk(contentRoot);

  if (unmapped.length > 0) {
    throw new OneRootPreflightError(
      `Found ${String(unmapped.length)} content/ file(s) with no v3 mapping — refusing to migrate rather than ` +
        "guess or drop data. Reconcile by hand, then re-run:\n  " +
        unmapped.join("\n  "),
    );
  }
  return { moves, claudeMdMerge };
}

async function executeMoves(params: { packageRoot: string; contentRoot: string; moves: PlannedMove[] }): Promise<void> {
  for (const move of params.moves) {
    const oldAbs = path.join(params.contentRoot, move.contentRelPath);
    const newAbs = path.join(params.packageRoot, move.newRelPath);
    await fs.mkdir(path.dirname(newAbs), { recursive: true });
    await execFileAsync("git", ["mv", oldAbs, newAbs], { cwd: params.packageRoot });
  }
}

async function mergeClaudeMd(params: { packageRoot: string; contentRoot: string }): Promise<void> {
  const contentClaudeMd = path.join(params.contentRoot, "CLAUDE.md");
  const rootClaudeMd = path.join(params.packageRoot, "CLAUDE.md");
  const contentText = await fs.readFile(contentClaudeMd, "utf-8");
  const rootText = await fs
    .readFile(rootClaudeMd, "utf-8")
    .catch((e: unknown) => {
      if (errnoCode(e) === "ENOENT") return "";
      throw e;
    });
  const merged =
    rootText.trimEnd() +
    (rootText.trim() === "" ? "" : "\n\n") +
    "## Box persona\n\n" +
    "(Merged from the v2 operational-root CLAUDE.md by the one-root migration.)\n\n" +
    contentText.trimEnd() +
    "\n";
  await fs.writeFile(rootClaudeMd, merged);
  await execFileAsync("git", ["add", rootClaudeMd], { cwd: params.packageRoot });
  await execFileAsync("git", ["rm", "-f", contentClaudeMd], { cwd: params.packageRoot });
}

async function moveBeebox(params: { packageRoot: string; contentRoot: string }): Promise<void> {
  await fs.rename(path.join(params.contentRoot, ".beebox"), path.join(params.packageRoot, ".beebox"));
}

async function bumpMarker(packageRoot: string): Promise<void> {
  const markerPath = path.join(packageRoot, ".beebox", "box.json");
  const raw = await fs.readFile(markerPath, "utf-8");
  const parsed: unknown = raw.trim() === "" ? {} : JSON.parse(raw);
  const marker = typeof parsed === "object" && parsed !== null ? { ...parsed } : {};
  const withVersion: Record<string, unknown> = {
    ...marker,
    shapeVersion: 3,
    "migrated-at": getBoxTimeISO(packageRoot),
  };
  await fs.writeFile(markerPath, JSON.stringify(withVersion, null, 2) + "\n");
}

/**
 * Run the full `bbx init` CLI tail in-process: .gitignore/.gitattributes
 * regen, directories, tricks/schema/view guides, rules, docs, search index,
 * plus card installers (procedures/schedules/personality/etc) — everything
 * `initBox` alone (called earlier, before the ref rewrite) does NOT cover.
 * Calling `runInit` directly (rather than spawning `bin/bbx`) avoids that
 * script's bundle-staleness self-heal path entirely, which matters for a
 * migration that runs right after source changes in the same dev checkout.
 */
async function runInitTail(packageRoot: string): Promise<void> {
  await runInit(packageRoot, { branch: "main" });
}

/** Ref-rewrite every migrated card/doc, using the mv plan to recover each
 * file's OLD content-relative path. Returns any unresolved ref tokens seen
 * (informational — the hard link gate is the real backstop). */
async function rewriteRefs(params: { packageRoot: string; moves: PlannedMove[] }): Promise<string[]> {
  const unresolved: string[] = [];
  for (const move of params.moves) {
    if (!move.newRelPath.endsWith(".card") && !move.newRelPath.endsWith(".md")) continue;
    const abs = path.join(params.packageRoot, move.newRelPath);
    const text = await fs.readFile(abs, "utf-8");
    const result = rewriteOneRootRefs({
      text,
      oldContentRelPath: move.contentRelPath,
      isCard: move.newRelPath.endsWith(".card"),
    });
    if (result.text !== text) await fs.writeFile(abs, result.text);
    for (const u of result.unresolved) unresolved.push(`${move.newRelPath}: ${u}`);
  }
  return unresolved;
}

export interface OneRootMigrationResult {
  commitSha: string;
  filesMoved: number;
  unresolvedRefs: string[];
}

/**
 * Run the whole migration against a v2 box. `packageRoot`/`contentRoot` come
 * from `probeV2Box` (`one-root-v2-probe.ts`). Rolls back to the pre-migration
 * SHA (plus renaming `.beebox` back) on any failure and rethrows.
 */
export async function runOneRootMigration(params: {
  packageRoot: string;
  contentRoot: string;
}): Promise<OneRootMigrationResult> {
  const { packageRoot, contentRoot } = params;
  await preflight({ packageRoot, contentRoot });
  const preSha = await getHead(packageRoot);
  const { moves, claudeMdMerge } = await planMoves(contentRoot);

  let beeboxMoved = false;
  try {
    await executeMoves({ packageRoot, contentRoot, moves });
    if (claudeMdMerge) await mergeClaudeMd({ packageRoot, contentRoot });
    await moveBeebox({ packageRoot, contentRoot });
    beeboxMoved = true;
    await bumpMarker(packageRoot);

    // Residual empty content/ tree (everything real has moved out).
    await fs.rm(contentRoot, { recursive: true, force: true });

    // .gitignore/.gitattributes regen + directory ensure, in-process
    // (reuses the same generator `bbx init` uses — see `initBox`'s module
    // comment). The heavier full `bbx init` CLI tail (rules/guide/docs/search
    // index) runs later, ONLY once the link gate has passed — so an aborted
    // migration never pays that cost.
    await initBox(packageRoot);
    const unresolvedRefs = await rewriteRefs({ packageRoot, moves });

    const gate = await runOneRootLinkGate(packageRoot);
    if (!gate.ok) throw new OneRootLinkGateError(gate.report);

    await runInitTail(packageRoot);

    // `runInitTail` (the real `bbx init`) makes its own provisioning
    // commit(s) as a side effect (docs-gen, card installers) — the same
    // thing the existing `bbx migrate --apply` flow already does before its
    // OWN migration commit. The plan calls for exactly ONE commit for this
    // migration, so fold everything since `preSha` (moves, marker bump,
    // .gitignore regen, ref rewrite, and init's provisioning) into the
    // index and let the commit below be the only one that lands.
    await execFileAsync("git", ["reset", "--soft", preSha], { cwd: packageRoot });

    // Append the migration's own manifest entry BEFORE the commit, so the
    // whole conversion — moves, marker bump, ref rewrite, and the record of
    // having applied "one-root" — lands as the single commit the plan's
    // step 8 describes.
    await appendManifestEntry(packageRoot, {
      name: "one-root",
      "applied-at": getBoxTimeISO(packageRoot),
    });
    await stageAll(packageRoot);
    const commitSha = await commit(packageRoot, { message: "migrate: one-root" });

    await updateManifestsForOneRoot({ packageRoot });

    return {
      commitSha,
      filesMoved: moves.length,
      unresolvedRefs,
    };
  } catch (e) {
    if (beeboxMoved) {
      // contentRoot itself may already be gone (rm -rf'd once every real
      // file had moved out of it) — recreate it before renaming .beebox
      // back, or the rename fails with ENOENT on a missing parent and
      // silently strands .beebox at the package root.
      await fs.mkdir(contentRoot, { recursive: true }).catch(() => {
        // Best effort — the rename attempt right below reports if this
        // still leaves contentRoot unusable.
      });
      await fs
        .rename(path.join(packageRoot, ".beebox"), path.join(contentRoot, ".beebox"))
        .catch((renameErr: unknown) => {
          console.error(
            `one-root migration rollback: failed to rename .beebox back (${errorMessage(renameErr)}) — manual recovery needed.`,
          );
        });
    }
    await revertToSnapshot(packageRoot, preSha);
    throw e;
  }
}
