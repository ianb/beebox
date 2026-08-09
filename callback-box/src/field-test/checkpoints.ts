/**
 * Per-item checkpoints and the cleanup policies built on them
 * (`docs/plans/agent-field-tests.md`, Track 2).
 *
 * Every checklist item ends with a git tag on the run's box, whatever its
 * policy. That is what makes both post-hoc inspection ("what did the box look
 * like after item 3?") and the `reset` policy cheap — reset is just "rewind to
 * the previous item's tag".
 *
 *   keep    the default. Residue is realistic; tag whatever HEAD is now
 *           (including commits the box's own agents made) and move on.
 *   commit  commit whatever the item left uncommitted first, then tag — so the
 *           checkpoint captures the working tree, not just the agents' commits.
 *   reset   rewind tracked content to the PREVIOUS checkpoint and drop untracked
 *           debris, so a messy attempt cannot contaminate later items. The
 *           caller restarts the server afterwards (see `run.ts`); a server left
 *           running over a rewound box serves state that no longer exists.
 *
 * `reset` uses `revertToSnapshot`, which cleans untracked files but NOT
 * gitignored ones. That distinction is load-bearing: `.callback-box/` holds the
 * live chat transcripts the operator is mid-conversation with, and wiping them
 * would orphan the very session the next item resumes.
 *
 * The one gitignored thing a reset DOES clear is the capture/bulk staging area.
 * An in-flight batch outlives the cards it was going to deliver into, and the
 * bulk sweep re-fires a `sealed`/`preparing` batch — so leaving it would both
 * hold the next item's quiescence check busy and deliver into a box that has
 * been rewound underneath it.
 *
 * What a reset knowingly does NOT rewind: chat transcripts (above), connector
 * cursors (rewinding the Gmail `historyId` would re-import the same mail as
 * duplicate cards), and the run's fake-Gmail state file, which lives outside
 * the box entirely. A scenario that needs mail un-sent should not use `reset`.
 */

import { rm } from "node:fs/promises";
import { assertNever } from "../lib/invariant.js";
import { commit, createTag, getHead, getStatus, revertToSnapshot, stageAll } from "../lib/git.js";
import { stagingBaseDir } from "../core/capture/staging-schema.js";
import type { FieldCleanupPolicy } from "./scenario.js";

/** Tag on the box as created, before the first item runs. */
export const BASELINE_TAG = "field-run/baseline";

/** The checkpoint tag for item `index` (0-based). Zero-padded so `git tag`
 *  lists a run's checkpoints in the order they happened. */
export function checkpointTag(opts: { index: number; itemId: string }): string {
  return `field-run/${String(opts.index + 1).padStart(2, "0")}-${opts.itemId}`;
}

/** Tag the box's current HEAD as the run's baseline. */
export async function tagBaseline(packageRoot: string): Promise<string> {
  await createTag(packageRoot, BASELINE_TAG);
  return getHead(packageRoot);
}

export interface CleanupOutcome {
  /** The checkpoint tag written. */
  tag: string;
  /** The commit it names. */
  head: string;
  /** The checkpoint the box was rewound to, for `reset`; else null. */
  resetTo: string | null;
}

export interface ApplyCleanupOptions {
  /** The box's git root — the v2 PACKAGE root, not the operational box root. */
  packageRoot: string;
  /** The operational box root — where `reset` finds the staging area. */
  boxRoot: string;
  policy: FieldCleanupPolicy;
  /** Tag to write for this item. */
  tag: string;
  /** The previous item's tag (or the baseline) — what `reset` rewinds to. */
  previousTag: string;
  /** Item id, for the commit message under `commit`. */
  itemId: string;
}

/**
 * Apply an item's cleanup policy and write its checkpoint tag. Throws on git
 * failure; the caller records that as the item's cleanup error rather than
 * ending the run, since a failed checkpoint costs inspectability, not the run.
 */
export async function applyCleanup(options: ApplyCleanupOptions): Promise<CleanupOutcome> {
  const { packageRoot, boxRoot, policy, tag, previousTag, itemId } = options;
  let resetTo: string | null = null;

  switch (policy) {
    case "keep":
      break;
    case "commit": {
      const status = await getStatus(packageRoot);
      if (!status.clean) {
        await stageAll(packageRoot);
        await commit(packageRoot, {
          message: `Field-test checkpoint after ${itemId}`,
          trailers: { "Created-By": "cb field-test" },
        });
      }
      break;
    }
    case "reset":
      await revertToSnapshot(packageRoot, previousTag);
      // Gitignored, so the revert above cannot see it — and an in-flight batch
      // that outlived its target cards is worse than no batch at all.
      await rm(stagingBaseDir(boxRoot), { recursive: true, force: true });
      resetTo = previousTag;
      break;
    default:
      assertNever(policy);
  }

  await createTag(packageRoot, tag);
  return { tag, head: await getHead(packageRoot), resetTo };
}
