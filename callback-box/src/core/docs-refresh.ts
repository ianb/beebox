/**
 * The unattended generated-docs refresh — `cb docs refresh`, run per box by
 * `deploy/deploy.sh` in the at-rest window right after `cb migrate --sweep`.
 *
 * ## Why a deploy step at all
 *
 * `generateDocs` (which, via `syncTemplatesFromSource`, also writes card rules
 * and the managed box skills) is cache-gated on the running engine's version,
 * so it regenerates the first time it runs after a deploy — but only when
 * *something runs it*. Its triggers are all activity: `cb init`, a reactor
 * cycle, a chat session start. A box nobody talks to keeps the previous
 * engine's generated docs indefinitely. That is how three of six production
 * boxes sat on card rules naming a card type that had been renamed weeks
 * earlier: the rename shipped, the sweep converged their data, and nothing
 * regenerated their guidance until someone ran `cb init` by hand.
 *
 * ## Shape (deliberately the migration sweep's)
 *
 * - **Normal cache.** Not `force`: on a box that already regenerated (someone
 *   chatted with it between the deploy and this step) the run is a no-op, and
 *   the report says so. The cache keys on the deploy stamp, so it cannot hide
 *   a genuinely stale box.
 * - **A dirty box is skipped, not refreshed.** `commitTemplateSyncChanges`
 *   commits only template-managed paths, but a box that is already dirty is a
 *   box with someone's in-flight work in it, and regeneration would interleave
 *   with it. Skipping is reported and the next deploy retries — the same
 *   bargain `sweepMigrations` makes.
 * - **Committed, not left in the tree.** Nobody is watching, and a box parked
 *   dirty is a box the next sweep and the next refresh both skip. `generateDocs`
 *   commits the template-managed paths itself (`Triggered-By: generateDocs`);
 *   this then sweeps up the rest of what the run wrote (`Created-By:
 *   docs-refresh`), which is safe precisely because the tree was verified clean
 *   first.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { commit, getStatus, stageAll } from "../lib/git.js";
import { withBoxGitLock } from "../lib/git-lock.js";
import { getBoxShape } from "../lib/box-shape.js";
import { errnoCode } from "../lib/error-guards.js";
import { generateDocs, GENERATE_MARKER } from "./docs-gen/index.js";

export type DocsRefreshResult =
  /** The cache said everything was current. The common case, and the quiet one. */
  | { readonly status: "current" }
  /** Uncommitted changes; regenerating would entangle them. Retried next deploy. */
  | { readonly status: "skipped-dirty" }
  /** Docs were regenerated (and any template-managed changes committed). */
  | { readonly status: "refreshed" };

/** The generation marker's content, or null when it has never been written. */
async function readMarker(boxRoot: string): Promise<string | null> {
  try {
    return await readFile(join(boxRoot, GENERATE_MARKER), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}

/** Commit anything the refresh left in the tree, if it left anything. */
async function commitRefreshResidue(packageRoot: string): Promise<void> {
  const status = await getStatus(packageRoot);
  if (status.clean) return;
  await stageAll(packageRoot);
  await commit(packageRoot, {
    message: "Refresh generated docs",
    trailers: { "Created-By": "docs-refresh" },
  });
}

/**
 * Regenerate one box's generated docs, rules, and skills if the cache says
 * they are stale, and commit what that dirtied.
 */
export async function refreshGeneratedDocs(opts: { boxRoot: string }): Promise<DocsRefreshResult> {
  const { boxRoot } = opts;
  // The lock is taken on `packageRoot` — the same path (and so the same lock)
  // `commitTemplateSyncChanges` takes deeper in, which is what makes that
  // nested acquisition a pass-through rather than a 60s stall. It covers the
  // clean check through the commit as one unit, exactly as the sweep does.
  const { packageRoot } = await getBoxShape(boxRoot);
  return withBoxGitLock(packageRoot, async () => {
    const status = await getStatus(packageRoot);
    if (!status.clean) return { status: "skipped-dirty" };

    const before = await readMarker(boxRoot);
    await generateDocs(boxRoot);
    // Sweep up whatever the run left in the tree. generateDocs commits partway
    // through (`syncTemplatesFromSource` → `commitTemplateSyncChanges`,
    // `Triggered-By: generateDocs`) and THEN writes the agent guide,
    // `AGENTS.md`, the CLAUDE.md @-includes, and the rest — residue a `cb tick`
    // housekeeping commit or the boxholder normally sweeps. Unattended that
    // residue IS the failure: a box left dirty is a box this step and the
    // migration sweep both skip next deploy, so it would converge exactly once
    // and then park.
    //
    // Whole-tree (`stageAll`), not the template-managed filter, and that is
    // sound *because of the clean check above*: the tree was clean when we took
    // the lock, so everything dirty now was written by this run. The same
    // cooperative caveat as the migration sweep applies — a box agent shelling
    // out to raw git is outside the lock — which is why the deploy runs this in
    // the at-rest window.
    await commitRefreshResidue(packageRoot);
    const after = await readMarker(boxRoot);
    // generateDocs rewrites the marker (timestamp + engine version) on every
    // run it does not skip, so an unchanged marker means the cache hit.
    return after === before ? { status: "current" } : { status: "refreshed" };
  });
}
