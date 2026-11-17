/**
 * A resolve action on a doc card's composition, as two commits
 * (`plan:composition-copy-and-accept-all`, Track 3): first whatever of the
 * card differs from HEAD (the person's pending edits, committed as a Save),
 * then the resolve edit alone. The edit is computed and checked before the
 * first commit, so a refused edit commits nothing. The caller holds the card
 * lock; the chat agent writes without it, so the region hash is checked
 * again at the write.
 */
import * as fs from "node:fs/promises";
import { stageAndCommitPaths } from "../lib/git/core/operations.js";
import { errorMessage } from "../shared/error-guards.js";
import { resolveEdit, type ResolveRequest } from "../shared/composition/marks/resolve.js";
import { checkCompositionWrite, readCompositionFile, writeCompositionFile, type CompositionWrite } from "./composition-file.js";

export type ResolveResult =
  | { status: "resolved"; regionHash: string; text: string; commitWarning: string | null }
  /** The region changed since the person's view; `committedEdits` is the first commit when it was made. */
  | { status: "conflict"; committedEdits: string | null }
  | { status: "nothing" }
  | { status: "refused" }
  | { status: "commit-failed" }
  | (Extract<CompositionWrite, { status: "problem" }> & { committedEdits: string | null });

const MESSAGES: Record<ResolveRequest["action"], string> = {
  "accept-joiners": "Accept agent words",
  "keep-checks": "Keep checked words",
  "remove-notes": "Remove notes",
  "keep-check": "Keep a checked passage",
  "remove-note": "Remove a note",
};

const ENDPOINT = "card.resolveComposition";

export async function resolveCompositionFile(
  { boxRoot, relPath, fullPath }: { boxRoot: string; relPath: string; fullPath: string },
  { baseRegionHash, request }: { baseRegionHash: string; request: ResolveRequest },
): Promise<ResolveResult> {
  const read = await readCompositionFile(fullPath);
  if ("problem" in read) return { status: "problem", problem: read.problem, where: "file", committedEdits: null };
  if (read.regionHash !== baseRegionHash) return { status: "conflict", committedEdits: null };
  const edit = resolveEdit(read.text, request);
  if (edit.status !== "edit") return edit;
  const checked = checkCompositionWrite(await fs.readFile(fullPath, "utf-8"), { baseRegionHash, text: edit.text });
  if (checked.status === "problem") return { ...checked, committedEdits: null };
  if (checked.status === "conflict") return { status: "conflict", committedEdits: null };

  let committedEdits: string | null;
  try {
    committedEdits = await stageAndCommitPaths(boxRoot, {
      paths: [relPath],
      message: `Save composition: ${relPath}`,
      trailers: { "Source": "webapp", "Endpoint": ENDPOINT, "Composition-Save": "person" },
    });
  } catch (error) {
    console.error(`Composition resolve: committing pending edits to ${relPath} failed:`, errorMessage(error));
    return { status: "commit-failed" };
  }

  const written = await writeCompositionFile(fullPath, { baseRegionHash, text: edit.text });
  if (written.status === "conflict") return { status: "conflict", committedEdits };
  if (written.status === "problem") return { ...written, committedEdits };
  try {
    await stageAndCommitPaths(boxRoot, {
      paths: [relPath],
      message: `${MESSAGES[request.action]}: ${relPath}`,
      trailers: { "Source": "webapp", "Endpoint": ENDPOINT, "Composition-Resolve": request.action },
    });
    return { status: "resolved", regionHash: written.regionHash, text: edit.text, commitWarning: null };
  } catch (error) {
    console.error(`Composition resolve: committing ${request.action} on ${relPath} failed:`, errorMessage(error));
    return { status: "resolved", regionHash: written.regionHash, text: edit.text, commitWarning: "Done, but the Git commit failed." };
  }
}
