/**
 * The `one-root` migration's orchestration (Track E, `docs/plans/one-root-box-layout.md`).
 * Converts a v2 box (package root + nested `content/`) to v3 (one root) in
 * place, atomically, as one commit. `scripts/migrate/one-root.ts` is the thin
 * CLI wrapper; this module is importable directly so doctests exercise the
 * real logic without spawning a subprocess.
 *
 * Move planning/execution (`one-root-move-plan.ts`), chat-binding rewrite
 * (`one-root-chat-bindings.ts`), and Claude transcript re-keying
 * (`one-root-claude-projects.ts`) are split into siblings purely to keep
 * this file under the repo's 300-line budget — this module is still the one
 * place that orders and commits the whole thing.
 *
 * Order (see the plan's numbered steps 1–8):
 *  1. Preflight: clean tree, no running processes (lock files), v2
 *     package-root closed-vocabulary check, and — since it can fail on a
 *     hand-edited file — parse + resolve the two external manifests
 *     (`hub.json`/`boxes.json`) that might need a stale-path fixup.
 *  2. Every `content/` entry moves per `one-root-mapping.ts`: a git-tracked
 *     entry (including a tracked symlink — annex-style assets) via `git mv`;
 *     an untracked/gitignored entry (including an untracked symlink) via a
 *     recorded filesystem rename, since `git mv` refuses anything not in
 *     the index. `content/CLAUDE.md` merges into the root `CLAUDE.md`
 *     instead of moving. A content/ entry of any other type (socket, fifo,
 *     device) aborts preflight-style rather than being silently skipped or
 *     moved.
 *  3. `.beebox/` — filesystem rename, not git (gitignored runtime state).
 *  4. Marker bump to shapeVersion 3 (original bytes captured first, so a
 *     later failure can restore them — see the rollback note below).
 *  5. `bbx init` tail: regenerates `.gitignore`/`.gitattributes` (the v3
 *     merged form), ensures directories, rules/guide/docs/search index.
 *  6. Ref rewrite across every card/doc (`one-root-ref-rewrite.ts`), plus
 *     `src/views/*.tsx` (a view never moves — same relative location in v2
 *     and v3 — so its `cardRef="…"` refs need rewriting in place).
 *  7. Hard link gate (`one-root-link-gate.ts`) — refuses to commit on any
 *     dangling card/markdown/view ref.
 *  8. `git add -A` + one commit `migrate: one-root`; THEN the manifests
 *     staged in step 1 are written, and Claude Code's per-cwd transcript
 *     directories (`~/.claude/projects/<encoded-cwd>/`) are re-keyed from
 *     the old content-root cwd to the new box-root cwd — both are external
 *     to the box's own repo, so they're touched only once the box's own
 *     commit is safe, and a failure in either is logged rather than treated
 *     as a migration failure (the box itself already landed).
 *
 * Nothing commits until step 8, so rollback on any earlier failure is: undo
 * every untracked/gitignored filesystem rename, restore the `.beebox/box.json`
 * marker and `.beebox/chat-session-history.json` bytes captured before they
 * were mutated (neither is git-tracked, so `git reset --hard` cannot recover
 * them), rename `.beebox` back (if it moved), then `revertToSnapshot` (git
 * reset --hard + clean) to the pre-migration SHA. The external manifests and
 * Claude transcript dirs are never touched before the commit succeeds, so
 * there's nothing to revert there.
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
import { listBoxViewFiles } from "../list-cards.js";
import { rewriteOneRootRefs, rewriteOneRootViewRefs } from "./one-root-ref-rewrite.js";
import { runOneRootLinkGate } from "./one-root-link-gate.js";
import {
  planManifestUpdatesForOneRoot,
  commitManifestUpdatesForOneRoot,
  type OneRootManifestPlan,
} from "./one-root-manifests.js";
import { migrateClaudeProjectDirs, type CwdRemap } from "./one-root-claude-projects.js";
import { rewriteChatBindings } from "./one-root-chat-bindings.js";
import { planMoves, executeMoves, verifyNoIgnoreRegression, type PlannedMove, type RenamedEntry } from "./one-root-move-plan.js";
import { OneRootPreflightError, OneRootLinkGateError } from "./one-root-errors.js";

export { OneRootPreflightError, OneRootLinkGateError, OneRootGitignoreRegressionError } from "./one-root-errors.js";

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

/** A view never moves (same relative location in v2 and v3), but its
 * `cardRef="…"` refs still address the old v2 vocabulary — rewrite them in
 * place. Returns any unresolved ref tokens (the hard link gate's view check
 * is the real backstop). */
async function rewriteViewRefs(packageRoot: string): Promise<string[]> {
  const unresolved: string[] = [];
  for (const viewPath of await listBoxViewFiles(packageRoot)) {
    const text = await fs.readFile(viewPath, "utf-8");
    const result = rewriteOneRootViewRefs(text);
    if (result.text !== text) await fs.writeFile(viewPath, result.text);
    for (const u of result.unresolved) unresolved.push(`${path.relative(packageRoot, viewPath)}: ${u}`);
  }
  return unresolved;
}

export interface OneRootMigrationResult {
  commitSha: string;
  filesMoved: number;
  unresolvedRefs: string[];
}

interface BoxMoveResult {
  commitSha: string;
  filesMoved: number;
  unresolvedRefs: string[];
  cwdPairs: CwdRemap[];
}

/**
 * Everything through the box's own migration commit: moves, marker bump,
 * chat-binding rewrite, ref rewrite, hard link gate, one commit. Rolls back
 * to the pre-migration SHA (plus every filesystem-level undo) on any
 * failure and rethrows. Split out of {@link runOneRootMigration} so the
 * external, post-commit bookkeeping (manifests, Claude transcript re-keying)
 * lives OUTSIDE this function's try/catch — a failure there must never be
 * read as "roll back the box", since by the time it runs the box migration
 * already succeeded.
 */
async function moveAndCommitBox(params: {
  packageRoot: string;
  contentRoot: string;
  preSha: string;
  moves: PlannedMove[];
  claudeMdMerge: boolean;
}): Promise<BoxMoveResult> {
  const { packageRoot, contentRoot, preSha, moves, claudeMdMerge } = params;
  let beeboxMoved = false;
  let originalMarkerBytes: string | null = null;
  let originalHistoryBytes: string | null = null;
  let untrackedRenames: RenamedEntry[] = [];
  let cwdPairs: CwdRemap[] = [];

  try {
    const moveResult = await executeMoves({ packageRoot, contentRoot, moves });
    untrackedRenames = moveResult.untrackedRenames;
    if (claudeMdMerge) await mergeClaudeMd({ packageRoot, contentRoot });
    await moveBeebox({ packageRoot, contentRoot });
    beeboxMoved = true;

    const bindingResult = await rewriteChatBindings({ packageRoot, contentRoot });
    originalHistoryBytes = bindingResult.originalRaw;
    cwdPairs = bindingResult.cwdPairs;

    originalMarkerBytes = await fs.readFile(path.join(packageRoot, ".beebox", "box.json"), "utf-8");
    await bumpMarker(packageRoot);

    // Residual empty content/ tree (everything real has moved out).
    await fs.rm(contentRoot, { recursive: true, force: true });

    // .gitignore/.gitattributes regen + directory ensure, in-process
    // (reuses the same generator `bbx init` uses — see `initBox`'s module
    // comment). The heavier full `bbx init` CLI tail (rules/guide/docs/search
    // index) runs later, ONLY once the link gate has passed — so an aborted
    // migration never pays that cost.
    await initBox(packageRoot);
    await verifyNoIgnoreRegression({ packageRoot, untrackedRenames });

    const unresolvedCardRefs = await rewriteRefs({ packageRoot, moves });
    const unresolvedViewRefs = await rewriteViewRefs(packageRoot);
    const unresolvedRefs = [...unresolvedCardRefs, ...unresolvedViewRefs];

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

    return { commitSha, filesMoved: moves.length, unresolvedRefs, cwdPairs };
  } catch (e) {
    for (const renamed of untrackedRenames.toReversed()) {
      await fs.mkdir(path.dirname(renamed.oldAbs), { recursive: true }).catch(() => {
        // Best effort — the rename attempt right below reports if this
        // still leaves the restore incomplete.
      });
      await fs.rename(renamed.newAbs, renamed.oldAbs).catch((renameErr: unknown) => {
        console.error(
          `one-root migration rollback: failed to rename ${renamed.newAbs} back to ${renamed.oldAbs} ` +
            `(${errorMessage(renameErr)}) — manual recovery needed.`,
        );
      });
    }
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
      // Neither box.json nor chat-session-history.json is git-tracked
      // (both live under the gitignored `.beebox/`), so `revertToSnapshot`
      // below cannot undo their in-place mutation — restore the bytes
      // captured before `bumpMarker`/`rewriteChatBindings` touched them.
      // Without this a retried `bbx migrate` sees shapeVersion 3 already
      // and refuses (`probeV2Box` treats >= 3 as "not a v2 box").
      if (originalMarkerBytes !== null) {
        await fs.writeFile(path.join(contentRoot, ".beebox", "box.json"), originalMarkerBytes).catch((writeErr: unknown) => {
          console.error(
            `one-root migration rollback: failed to restore the original box.json marker (${errorMessage(writeErr)}) — manual recovery needed.`,
          );
        });
      }
      if (originalHistoryBytes !== null) {
        await fs
          .writeFile(path.join(contentRoot, ".beebox", "chat-session-history.json"), originalHistoryBytes)
          .catch((writeErr: unknown) => {
            console.error(
              `one-root migration rollback: failed to restore the original chat-session-history.json (${errorMessage(writeErr)}) — manual recovery needed.`,
            );
          });
      }
    }
    // `initBox` (run before the ref rewrite/link gate) writes NEW,
    // previously-nonexistent top-level entries at packageRoot — the v3
    // `.gitignore`/`.gitattributes` and underscore areas (`_tmp/`,
    // `_config/`, …). Once that `.gitignore` exists, plain `git clean -f -d`
    // below (via `revertToSnapshot`, untracked-but-NOT-ignored files only)
    // removes the .gitignore itself but leaves whatever it now ignores
    // (`_tmp/`) behind — stranding a retry at the closed-vocabulary
    // preflight check. Remove every such stray explicitly, by name, before
    // the shared revert runs. Scoped to packageRoot's own top level (never
    // touches `content/`, which the restores above already made right) and
    // to entries outside the v2 vocabulary, so it can never remove
    // something the box's OWN preflight already required to be there.
    const survivors = await fs.readdir(packageRoot).catch(() => []);
    for (const name of survivors) {
      if (name === "content" || V2_PACKAGE_ROOT_VOCABULARY.has(name)) continue;
      await fs.rm(path.join(packageRoot, name), { recursive: true, force: true }).catch((rmErr: unknown) => {
        console.error(
          `one-root migration rollback: failed to remove stray package-root entry ${name} ` +
            `(${errorMessage(rmErr)}) — manual recovery needed.`,
        );
      });
    }
    await revertToSnapshot(packageRoot, preSha);
    throw e;
  }
}

/**
 * Run the whole migration against a v2 box. `packageRoot`/`contentRoot` come
 * from `probeV2Box` (`one-root-v2-probe.ts`).
 */
export async function runOneRootMigration(params: {
  packageRoot: string;
  contentRoot: string;
}): Promise<OneRootMigrationResult> {
  const { packageRoot, contentRoot } = params;
  await preflight({ packageRoot, contentRoot });
  // Read + resolve + stage the external manifests' edits during preflight —
  // a malformed hub.json/boxes.json aborts here, before anything in the box
  // has moved, the same clean way any other preflight failure does.
  const manifestPlan: OneRootManifestPlan = await planManifestUpdatesForOneRoot({ packageRoot });
  const preSha = await getHead(packageRoot);
  const { moves, claudeMdMerge } = await planMoves({ packageRoot, contentRoot });

  const { commitSha, filesMoved, unresolvedRefs, cwdPairs } = await moveAndCommitBox({
    packageRoot,
    contentRoot,
    preSha,
    moves,
    claudeMdMerge,
  });

  // The box migration is DONE and safe — nothing below may roll it back.
  // Both steps are external to the box's own repo (global manifests, global
  // Claude Code state); a failure in either is logged, not thrown, so it
  // can never be mistaken for "the migration failed."
  await commitManifestUpdatesForOneRoot(manifestPlan).catch((e: unknown) => {
    console.error(
      "one-root migration: manifest update failed after the box commit landed (the box migration itself " +
        `succeeded) — ${errorMessage(e)}`,
    );
  });
  await migrateClaudeProjectDirs(cwdPairs);

  return { commitSha, filesMoved, unresolvedRefs };
}
