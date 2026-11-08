import { boxClockShiftMs, getBoxTime } from "../../time.js";

/**
 * Box time for a walk fixture's commits, as `boxGit` overrides
 * (docs/implemented-plans/walk-simulated-time.md, Track 5). Empty when the box
 * clock is real or the caller already set either date.
 */
export function commitDateOverrides(boxRoot: string): Record<string, string> {
  if (boxClockShiftMs(boxRoot) === 0 || process.env.GIT_AUTHOR_DATE !== undefined || process.env.GIT_COMMITTER_DATE !== undefined) return {};
  const date = `${Math.floor(getBoxTime(boxRoot).getTime() / 1000)} +0000`;
  return { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
}
