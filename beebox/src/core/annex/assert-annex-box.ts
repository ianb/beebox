/**
 * Assert that a box is annex-shaped before writing asset bytes into it.
 *
 * Every box is annex-shaped from its first commit (`./annex-new-box.ts`), and
 * the manifest scheme it replaced is gone. So a box that fails this check is a
 * broken invariant, not a supported state, and gets a hard failure rather than
 * a fallback — `docs/code-style.md`.
 *
 * The state is still reachable, which is why this is a runtime check and not a
 * comment: a hand-edited `.gitignore` that re-ignores assets makes the box read
 * as unconverted. What used to happen then is the reason this exists. Asset
 * bytes written into such a box reach neither git nor the annex, and the
 * failure mode depended on pathspec shape (`src/lib/git.ts`): naming an ignored
 * FILE makes `git add` exit non-zero, while naming a DIRECTORY silently skips
 * its ignored contents — so card submissions lost bytes with no error at all.
 *
 * Call before writing any bytes, not after. Several of these paths copy
 * originals into a staging directory first, and a check placed later would
 * leave the user's files half-processed.
 */

import { invariant } from "../../lib/invariant.js";
import { isAnnexBox } from "./is-annex-box.js";

/**
 * @param boxRoot - The box root.
 * @param what - What was about to be written, named in the failure.
 * @throws when the box is not annex-shaped.
 */
export async function assertAnnexBox(boxRoot: string, what: string): Promise<void> {
  invariant(
    await isAnnexBox(boxRoot),
    `${what}: box ${boxRoot} is not annex-shaped, so asset bytes would reach neither git nor ` +
      "the annex. Every box is annex-shaped from creation, so this means the box `.gitignore` " +
      "was hand-edited to re-ignore assets.",
  );
}
