/**
 * `gfolder-last-sync-2026-10` decision: given a `.gfolder.card`'s text, what
 * to write.
 *
 * Folder cards made before this migration carry `last-sync`, the time of the
 * last mirror pass. The time now lives in the Drive state file
 * (`folders` in `connectors/google-drive/state.ts`), because a time on the
 * card changed on every pass and made every pass a commit. The migration
 * deletes the one key from the YAML document, so comments, quoting, and the
 * body stay as they were, and hands back the time so the runner can seed the
 * state with it. Pure, so the test reaches every case without a box.
 */

import { isMap, isScalar } from "yaml";
import {
  editableFrontmatterDocument,
  renderFrontmatterDocument,
  splitCardContent,
} from "../../../cards/frontmatter.js";

export type GfolderLastSyncPlan =
  | { kind: "current" }
  | { kind: "strip"; text: string; driveId: string; lastSync: string }
  | { kind: "leftover"; reason: string };

export function planGfolderLastSync(text: string): GfolderLastSyncPlan {
  const split = splitCardContent(text);
  if (!split.hasFrontmatter) return { kind: "current" };
  const document = editableFrontmatterDocument(split.frontmatterText);
  if (document === null) {
    // Unreadable YAML might still hold the key; only a person can say what the block meant.
    return /^\s*last-sync\s*:/m.test(split.frontmatterText)
      ? { kind: "leftover", reason: "frontmatter does not parse; delete the last-sync line by hand" }
      : { kind: "current" };
  }
  if (!document.has("last-sync")) return { kind: "current" };
  const lastSync = scalarString(document.get("last-sync", true));
  const drive = document.get("drive");
  const driveId = isMap(drive) ? scalarString(drive.get("id", true)) : null;
  if (lastSync === null || driveId === null) {
    return { kind: "leftover", reason: "last-sync or drive.id is not a plain string; delete the last-sync line by hand" };
  }
  document.delete("last-sync");
  return { kind: "strip", text: renderFrontmatterDocument(document, split.body), driveId, lastSync };
}

/** A non-empty string scalar's value, or null. */
function scalarString(node: unknown): string | null {
  if (!isScalar(node)) return null;
  const value = node.value;
  return typeof value === "string" && value !== "" ? value : null;
}
