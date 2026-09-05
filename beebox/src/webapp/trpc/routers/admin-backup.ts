/**
 * Admin → Backup: what of this box exists anywhere but the machine serving it.
 *
 * Split into its own file for the same reason as admin-google/admin-gmail:
 * `admin.ts` is the composition point, not a dumping ground. The measurement
 * itself lives in `core/box/backup-status.ts`; this only exposes it.
 *
 * Owner-only, and read-only by construction — the underlying module never
 * fetches, pushes, or writes, so viewing the page cannot change what it is
 * reporting on.
 */

import { ownerProcedure } from "../trpc.js";
import { getBackupStatus, NotAGitBoxError } from "../../../core/box/backup-status.js";

export const backupAdminProcedures = {
  /**
   * This box's backup posture: remote, unpushed commits, repo size, and the
   * assets that exist only here.
   *
   * A box that is not a git repository is a legitimate state (a scratch box
   * that was never `git init`ed), not an error to surface as a failed query —
   * it comes back as `repo: null` so the section can say so plainly.
   */
  backupStatus: ownerProcedure.query(async ({ ctx }) => {
    try {
      return { repo: await getBackupStatus(ctx.boxRoot) };
    } catch (e) {
      if (e instanceof NotAGitBoxError) return { repo: null };
      throw e;
    }
  }),
};
