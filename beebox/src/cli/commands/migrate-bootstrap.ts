/**
 * `bbx migrate`'s v2 bootstrap path — split out of `migrate.ts` purely to
 * keep that file under the 300-line limit. See Track E's "Bootstrap"
 * paragraph, `docs/implemented-plans/one-root-box-layout.md`.
 *
 * The v3 engine refuses v2 boxes, so `requireBoxRoot()` (`migrate.ts`)
 * either can't find a marker at all (invoked from the v2 PACKAGE root —
 * `findBoxRoot` only recognizes a marker at the path it's walking, and a v2
 * package root has none of its own) or resolves to the nested `content/`
 * directory (invoked from inside it). Either way, this module is the one
 * place allowed to look for a v2 box — via the tolerant probe — and hand it
 * straight to the `one-root` migrator, entirely outside the normal
 * manifest-driven `pending` loop (a v2 box has no `_config/migrations.jsonl`
 * for that loop to read yet).
 */

import { probeV2Box, type V2Box } from "../../core/migrations/one-root-v2-probe.js";
import { runOneRootMigration } from "../../core/migrations/one-root-run.js";
import { errorMessage } from "../../lib/error-guards.js";

/**
 * Look for a v2 box at `candidatePath` (the path `requireBoxRoot` resolved,
 * which may already be the nested v2 content root), falling back to the
 * process cwd (the case where `requireBoxRoot` found no marker anywhere and
 * threw — cwd is the only candidate left, e.g. a v2 PACKAGE root itself).
 */
export async function findV2Box(candidatePath: string | null): Promise<V2Box | null> {
  if (candidatePath !== null) {
    const direct = await probeV2Box(candidatePath);
    if (direct !== null) return direct;
  }
  return probeV2Box(process.cwd());
}

/** Run (or, without `--apply`, just report) the v2 -> v3 bootstrap conversion. */
export async function runBootstrap(v2Box: V2Box, opts: { apply?: boolean }): Promise<void> {
  if (opts.apply !== true) {
    console.log(
      `${v2Box.packageRoot} is a v2 box (predates the one-root layout). Run \`bbx migrate --apply\` to convert it to shapeVersion 3.`,
    );
    return;
  }
  console.log(`Converting ${v2Box.packageRoot} to the one-root layout (shapeVersion 3)…\n`);
  try {
    const result = await runOneRootMigration({ packageRoot: v2Box.packageRoot, contentRoot: v2Box.contentRoot });
    console.log(`\nConverted. ${String(result.filesMoved)} file(s) moved; commit ${result.commitSha}.`);
    if (result.unresolvedRefs.length > 0) {
      console.log(
        `${String(result.unresolvedRefs.length)} ref(s) could not be mapped to a v3 target (left as written; ` +
          "the hard link gate would have refused the commit had any of them been dangling):",
      );
      for (const r of result.unresolvedRefs) console.log(`  ${r}`);
    }
    if (result.skippedSymlinkRefs.length > 0) {
      console.log(
        `${String(result.skippedSymlinkRefs.length)} migrated card/doc path(s) are symlinks and were left ` +
          "byte-untouched (their ref content belongs to their target, not the link; a target outside the box " +
          "may now carry stale refs):",
      );
      for (const r of result.skippedSymlinkRefs) console.log(`  ${r}`);
    }
    console.log("\nThe box is now v3. Run `bbx migrate` again to apply any remaining card-data migrations.");
  } catch (e) {
    console.error(`\nOne-root conversion failed and was rolled back: ${errorMessage(e)}`);
    process.exit(1);
  }
}
