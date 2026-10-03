/**
 * Files `--rewrite-mentions` leaves alone: `scratch/` (never committed
 * content) and the repo's history documents, which describe the past on
 * purpose and should keep the paths they had at the time. A file under one
 * of these is excluded from rewriting AND from the "needs review" report —
 * an old path here isn't an oversight.
 */
import { baseOf } from "../graph.js";

const HISTORY_DOC_DIRS = [
  "beebox/docs/plans/",
  "beebox/docs/implemented-plans/",
  "beebox/docs/unimplemented-plans/",
  "beebox/docs/reports/",
  "beebox/docs/user-stories/catalog/",
  "issues/closed/",
];

function isHistoryDoc(path: string): boolean {
  if (baseOf(path).startsWith("CHANGELOG")) return true;
  return HISTORY_DOC_DIRS.some((dir) => path.startsWith(dir));
}

export function isExcludedFromMentionRewrite(path: string): boolean {
  return path.startsWith("scratch/") || isHistoryDoc(path);
}
