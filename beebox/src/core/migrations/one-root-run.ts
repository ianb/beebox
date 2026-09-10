/**
 * The `one-root` migration's orchestration (Track E, `docs/implemented-plans/one-root-box-layout.md`).
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
 *  5. `initBox` (the .gitignore/.gitattributes regen + directory-ensure half
 *     of `bbx init` — see `initBox`'s own module comment), THEN
 *     `mergeIgnoreRules`/`verifyNoIgnoreRegression`/
 *     `verifyNoBoxWideIgnoreRegression` (`one-root-ignore-merge.ts`) restore
 *     v2-local ignore coverage IMMEDIATELY — before anything downstream can
 *     stage a now-briefly-unignored file into git. Finding 1 (round 5
 *     hardening): this merge used to run only after step 6's full `bbx init`
 *     tail, which itself runs a provisioning commit
 *     (`commitTemplateSyncChanges`) — a package-root-ignored file (e.g.
 *     `.claude/rules/private.md`) that `initBox`'s wholesale regen alone left
 *     briefly unignored got scooped up and committed for real by that
 *     provisioning commit, its bytes landing in a git object BEFORE the merge
 *     ever ran to restore its ignore coverage; the later regression check's
 *     failure then rolled the migration back, but `reset --hard` only clears
 *     the working tree and refs — it can't un-commit an object already
 *     written to the store. Merging right after `initBox` (not after the
 *     full tail) closes that window entirely.
 *  6. `bbx init` tail proper (`runInitTail`): rules/guide/docs/search index,
 *     card installers — everything `initBox` alone doesn't cover. Its own
 *     `initBox` re-run (step 5's regen, called again as part of its
 *     provisioning) preserves whatever step 5 just merged forward (see
 *     `box/index.ts`'s migrated-section preservation), so this can't
 *     re-open the step-5 window — a second, final
 *     `verifyNoBoxWideIgnoreRegression` after this step is a cheap sanity
 *     check against exactly that, not a load-bearing fix.
 *  7. Ref rewrite across every card/doc (`one-root-ref-rewrite.ts`), plus
 *     `src/views/*.tsx` (a view never moves — same relative location in v2
 *     and v3 — so its `cardRef="…"` refs need rewriting in place).
 *  8. Hard link gate (`one-root-link-gate.ts`) — refuses to commit on any
 *     dangling card/markdown/view ref.
 *  9. `git add -A` + one commit `migrate: one-root`; THEN the manifests
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
import { getStatus, getHead, stageAll, commit } from "../../lib/git.js";
import { initBox } from "../box/index.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import { getBoxTimeISO } from "../../lib/time.js";
import { runInit } from "../../cli/commands/init.js";
import { appendManifestEntry } from "../migration-run.js";
import { rewriteRefs, rewriteViewRefs } from "./one-root-ref-apply.js";
import { runOneRootLinkGate } from "./one-root-link-gate.js";
import {
  planManifestUpdatesForOneRoot,
  commitManifestUpdatesForOneRoot,
  type OneRootManifestPlan,
} from "./one-root-manifests.js";
import { migrateClaudeProjectDirs, type CwdRemap } from "./one-root-claude-projects.js";
import { rewriteChatBindings } from "./one-root-chat-bindings.js";
import { rewriteConnectorConfigRefs } from "./one-root-connector-config.js";
import {
  planMoves,
  executeMoves,
  remapMovedSymlinkTargets,
  verifyNoIgnoreRegression,
  assertNoSymlinkedContentDirectories,
  type PlannedMove,
  type RenamedEntry,
} from "./one-root-move-plan.js";
import { captureIgnoreRules, mergeIgnoreRules, snapshotBoxWideIgnored, verifyNoBoxWideIgnoreRegression } from "./one-root-ignore-merge.js";
import { OneRootPreflightError, OneRootLinkGateError } from "./one-root-errors.js";
import { mergeClaudeMdText } from "./one-root-claude-md.js";
import { rollbackMoveAndCommit, V2_PACKAGE_ROOT_VOCABULARY } from "./one-root-rollback.js";
import { assertWriteTargetNotSymlink, assertNoSymlinkedCalleeWriteTargets } from "./one-root-write-guard.js";

export { OneRootPreflightError, OneRootLinkGateError, OneRootGitignoreRegressionError } from "./one-root-errors.js";

const execFileAsync = promisify(execFile);

/** v2 lock-file names, checked at the OLD operational root (`content/`) —
 * see `box/index.ts`'s `.gitignore` block for the current names. */
const V2_LOCK_FILES = [".bbx-lock", ".bbx-reactor.lock", ".bbx-serve.pid"];

/**
 * Round-6 hardening finding 1: `src`, `src/views`, `src/schemas`,
 * `src/tricks`, and `.claude` are all ANCESTOR directories the migration
 * (and later, ordinary box operation) walks through without ever `lstat`ing
 * every intermediate segment — `listBoxViewFiles`'s `glob` follows a
 * directory symlink transparently, and a leaf `lstat` inside a symlinked
 * `src/views` never sees the symlinked PARENT. If `src/views` were a tracked
 * symlink to, say, `/shared/views`, `rewriteViewRefs` would happily rewrite
 * every `.tsx` file it finds there — ordinary files EXTERNAL to this box —
 * and `initBox` can install a starter guide through the same link. Refuse
 * before any mutation rather than let either happen.
 */
const SYMLINK_ANCESTOR_CHECKS = ["src", "src/views", "src/schemas", "src/tricks", ".claude", "content", "views"];

async function assertNoSymlinkedAncestors(packageRoot: string): Promise<void> {
  for (const rel of SYMLINK_ANCESTOR_CHECKS) {
    const abs = path.join(packageRoot, rel);
    const lst = await fs.lstat(abs).catch((e: unknown) => {
      if (errnoCode(e) === "ENOENT") return null;
      throw e;
    });
    if (lst !== null && lst.isSymbolicLink()) {
      throw new OneRootPreflightError(
        `${abs} is a symlink — refusing to migrate through a symlinked code ancestor. A leaf ` +
          "lstat inside it can't see this parent link, so a rewrite or init step would silently " +
          "touch files outside the box. Reconcile by hand (replace the symlink with a real " +
          "directory, or move its contents in), then re-run.",
      );
    }
  }
}

async function preflight(params: { packageRoot: string; contentRoot: string }): Promise<void> {
  const status = await getStatus(params.packageRoot);
  if (!status.clean) {
    throw new OneRootPreflightError(
      params.packageRoot + ": working tree is not clean. Commit or stash before migrating.",
    );
  }

  await assertNoSymlinkedAncestors(params.packageRoot);
  await assertNoSymlinkedContentDirectories(params.contentRoot);
  await assertNoSymlinkedCalleeWriteTargets({ packageRoot: params.packageRoot, contentRoot: params.contentRoot });
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
  const merged = mergeClaudeMdText(rootText, contentText);
  await assertWriteTargetNotSymlink(rootClaudeMd);
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
  await assertWriteTargetNotSymlink(markerPath);
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

export interface OneRootMigrationResult {
  commitSha: string;
  filesMoved: number;
  unresolvedRefs: string[];
  /** Migrated card/doc paths (v3-relative) left byte-untouched because
   * they're symlinks — see {@link rewriteRefs}'s Finding 1 doc comment. */
  skippedSymlinkRefs: string[];
  /** Round-9 hardening: broken refs the hard link gate found but did NOT
   * block on, because the ref rewriter (`one-root-ref-rescue.ts`) already
   * determined they were dangling before this migration touched anything —
   * an aged box's stale job-card refs to long-consumed content. */
  preExistingBrokenRefsCarried: number;
}

interface BoxMoveResult {
  commitSha: string;
  filesMoved: number;
  unresolvedRefs: string[];
  skippedSymlinkRefs: string[];
  cwdPairs: CwdRemap[];
  preExistingBrokenRefsCarried: number;
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
  // Finding 3 (round 4 hardening): a mutable box `rewriteChatBindings` writes
  // into DIRECTLY, the moment it reads the pre-write bytes — not a value
  // this function only learns from a `return` that a write failure would
  // skip. Same shape as the `untrackedRenames` journal below.
  const originalHistoryBytesBox: { value: string | null } = { value: null };
  // Caller-owned journal (finding 1): `executeMoves` appends to this array
  // itself, immediately after each untracked rename succeeds, rather than
  // building its own local array and returning it only on full success. A
  // `const` reference that never gets reassigned means the `catch` below
  // always sees every rename that landed before the throw — even one on the
  // very last move in the loop — not an empty array from a `let` whose
  // single reassignment never ran.
  const untrackedRenames: RenamedEntry[] = [];
  let cwdPairs: CwdRemap[] = [];
  // Round-9 hardening: every v2 content-relative path that existed
  // pre-migration, used by the ref rewriter to disambiguate a bare ref's two
  // readings and flag one already dangling before this migration touched
  // anything (`one-root-ref-rescue.ts`).
  const oldPathSet = new Set(moves.map((m) => m.contentRelPath));
  const oldPathExists = (p: string): boolean => oldPathSet.has(p);

  const ignoreSnapshot = await captureIgnoreRules({ packageRoot, contentRoot });
  const boxWideIgnored = await snapshotBoxWideIgnored({ packageRoot });

  try {
    await executeMoves({ packageRoot, contentRoot, moves, journal: untrackedRenames });
    // Finding 4: recompute every moved symlink's relative target for its new
    // depth, before anything downstream (ref rewrite, the hard link gate)
    // can observe — or fail on — a dangling link.
    await remapMovedSymlinkTargets({ packageRoot, contentRoot, moves, journal: untrackedRenames });
    if (claudeMdMerge) await mergeClaudeMd({ packageRoot, contentRoot });
    await moveBeebox({ packageRoot, contentRoot });
    beeboxMoved = true;

    const bindingResult = await rewriteChatBindings({
      packageRoot,
      contentRoot,
      originalBytesOut: originalHistoryBytesBox,
    });
    cwdPairs = bindingResult.cwdPairs;

    await rewriteConnectorConfigRefs({ packageRoot, journal: untrackedRenames });

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

    // Finding 1 (round 5 hardening): restore v2-local .gitignore/.gitattributes
    // coverage IMMEDIATELY after this first regen — before `runInitTail`
    // (below) gets a chance to run its own provisioning commit
    // (`commitTemplateSyncChanges`) against a tree where a package-root
    // rule (e.g. `.claude/rules/private.md`) is still only briefly
    // unignored. Waiting until after the full `bbx init` tail (the old
    // order) left exactly that window open: a real, separate git commit
    // could land the file's bytes in a git object before the merge ever ran
    // to re-ignore it, and `reset --hard` on a later rollback can't un-commit
    // an object already written to the store. See this module's header
    // comment (step 5) for the full incident.
    await mergeIgnoreRules({ packageRoot, snapshot: ignoreSnapshot });
    await verifyNoIgnoreRegression({ packageRoot, untrackedRenames });
    await verifyNoBoxWideIgnoreRegression({ packageRoot, before: boxWideIgnored });

    const {
      unresolved: unresolvedCardRefs,
      skippedSymlinks: skippedCardSymlinkRefs,
      preBrokenKeys: preBrokenCardKeys,
    } = await rewriteRefs({ packageRoot, moves, journal: untrackedRenames, oldPathExists });
    const {
      unresolved: unresolvedViewRefs,
      skippedSymlinks: skippedViewSymlinkRefs,
      preBrokenKeys: preBrokenViewKeys,
    } = await rewriteViewRefs({ packageRoot, journal: untrackedRenames, oldPathExists });
    const unresolvedRefs = [...unresolvedCardRefs, ...unresolvedViewRefs];
    const skippedSymlinkRefs = [...skippedCardSymlinkRefs, ...skippedViewSymlinkRefs];
    const preBroken = new Set([...preBrokenCardKeys, ...preBrokenViewKeys]);

    // Finding 1 (round 4 hardening): a symlinked card/doc the ref rewriter
    // deliberately skipped is excluded from the gate's own scan too — but at
    // the SOURCE (`markdown-lint-rules.ts`'s `noBrokenInternalLinks` skips a
    // symlinked leaf outright; a `.card` file's ref problems are
    // warning-only regardless), not by threading a skip list through here.
    // Round-9 hardening: `preBroken` carries the refs the rewriter itself
    // already determined were dangling before this migration touched
    // anything — the gate doesn't block on those (see its own doc comment).
    const gate = await runOneRootLinkGate(packageRoot, { preBroken });
    if (!gate.ok) throw new OneRootLinkGateError(gate.report);

    // `runInitTail` (the real `bbx init`) itself calls `initBox` again as
    // part of its provisioning — REWRITING `.gitignore`/`.gitattributes` a
    // second time, wholesale — but `initBox`'s own migrated-section
    // preservation (`box/index.ts`) carries forward whatever the merge above
    // just appended, so this can't reopen the finding-1 window. Re-run the
    // box-wide regression check anyway, cheaply, against the file that
    // actually lands in the commit — a pure ordering-regression backstop,
    // not the fix itself (that's the merge above, run before this point).
    await runInitTail(packageRoot);
    await verifyNoBoxWideIgnoreRegression({ packageRoot, before: boxWideIgnored });

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
    // noVerify: the box's own pre-commit hook re-lints EVERY staged file, and
    // this commit deliberately stages the whole box — including aged markdown
    // whose pre-broken links the hook counts as errors. The migration already
    // ran its stricter, history-aware gate above (pre-broken carve-out); the
    // generic hook cannot know about the carve-out and would veto real aged
    // boxes on history the migration is explicitly carrying through.
    const commitSha = await commit(packageRoot, { message: "migrate: one-root", noVerify: true });

    return {
      commitSha,
      filesMoved: moves.length,
      unresolvedRefs,
      skippedSymlinkRefs,
      cwdPairs,
      // Count what the REWRITER classified as pre-broken, not the gate's
      // lint-scan tally: the scan only surfaces refs whose card type has a
      // registered schema, so its count varies with the schema registry
      // while the rewriter's classification is deterministic for a given
      // tree. (The gate still uses the same set for its filtering.)
      preExistingBrokenRefsCarried: preBroken.size,
    };
  } catch (e) {
    // See `one-root-rollback.ts` for the restore-or-preserve logic (findings
    // 1 and 6, round 3 hardening) — split out purely to keep this file under
    // the repo's 300-line budget.
    return rollbackMoveAndCommit({
      packageRoot,
      contentRoot,
      preSha,
      beeboxMoved,
      originalMarkerBytes,
      originalHistoryBytes: originalHistoryBytesBox.value,
      untrackedRenames,
      error: e,
    });
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

  const { commitSha, filesMoved, unresolvedRefs, skippedSymlinkRefs, cwdPairs, preExistingBrokenRefsCarried } =
    await moveAndCommitBox({ packageRoot, contentRoot, preSha, moves, claudeMdMerge });

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

  return { commitSha, filesMoved, unresolvedRefs, skippedSymlinkRefs, preExistingBrokenRefsCarried };
}
