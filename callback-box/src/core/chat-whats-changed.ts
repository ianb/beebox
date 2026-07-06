/**
 * Compute the `cb chat whats-changed` report: a terse, git-grounded answer to
 * "what changed in the box (or the open card) since my last reply?".
 *
 * Precise semantic (the cross-model review's review #1): the report is the
 * commits in `marker.head..HEAD` PLUS the current uncommitted working tree —
 * not a single timestamped delta. On the first turn of a session there's no
 * marker yet, so it falls back to the last few commits, labeled as such.
 * `card` scopes every section to that path. Everything degrades to a readable
 * line rather than throwing, so the agent always gets *something* truthful.
 */

import { getStatus } from "../lib/git.js";
import { getHeadSha, getOnelineLog, getDiffStat } from "../lib/git-range.js";
import { loadTurnMarker } from "./chat-turn-marker.js";

const FALLBACK_COMMITS = 5;

function shortSha(sha: string): string {
  return sha.slice(0, 8);
}

/**
 * Build the report. `sessionId` selects the turn marker (null → no marker, so
 * the fallback path). `card` is a box-relative path scoping every section.
 */
export async function summarizeWhatsChanged(
  boxRoot: string,
  { sessionId, card }: { sessionId: string | null; card?: string },
): Promise<string> {
  const paths = card !== undefined && card !== "" ? [card] : undefined;
  const marker = sessionId ? loadTurnMarker(boxRoot, sessionId) : null;
  const out: string[] = [];
  if (paths) out.push(`Scope: ${paths[0]}`, "");

  // Committed section: commits since the marker, or a labeled fallback.
  if (marker) {
    const range = `${marker.head}..HEAD`;
    const log = await getOnelineLog(boxRoot, { base: marker.head, ...(paths ? { paths } : {}) });
    const stat = await getDiffStat(boxRoot, { range, ...(paths ? { paths } : {}) });
    if (log || stat) {
      out.push(`Commits since your last reply (${shortSha(marker.head)}..HEAD):`);
      if (log) out.push(log);
      if (stat) out.push("", stat);
    } else {
      out.push("No commits since your last reply.");
    }
  } else {
    const head = await getHeadSha(boxRoot);
    if (head === null) {
      out.push("No commits in this box yet.");
    } else {
      const recent = await getOnelineLog(boxRoot, { count: FALLBACK_COMMITS, ...(paths ? { paths } : {}) });
      out.push(`No turn marker yet (first turn this session) — last ${FALLBACK_COMMITS} commits:`);
      if (recent) out.push(recent);
    }
  }

  // Uncommitted working tree: staged + unstaged vs HEAD, plus untracked files
  // (which a diff doesn't show). Scoped to the card path when given.
  const status = await getStatus(boxRoot);
  const uncommitted = await getDiffStat(boxRoot, { range: "HEAD", ...(paths ? { paths } : {}) });
  const untracked = paths
    ? status.untracked.filter((p) => p === paths[0] || p.startsWith(`${paths[0]}/`))
    : status.untracked;
  out.push("");
  if (uncommitted || untracked.length > 0) {
    out.push("Uncommitted working tree:");
    if (uncommitted) out.push(uncommitted);
    if (untracked.length > 0) out.push(`Untracked: ${untracked.join(", ")}`);
  } else {
    out.push("Working tree clean (no uncommitted changes).");
  }

  return out.join("\n");
}
