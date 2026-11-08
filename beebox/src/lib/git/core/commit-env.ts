import { boxClockShiftMs, getBoxTime } from "../../time.js";
import { gitEnvironment } from "../env.js";

/** The Git environment for a commit, with box time on a walk fixture's commits. */
export function commitEnvironment(boxRoot: string): NodeJS.ProcessEnv {
  const env = gitEnvironment();
  // A walk fixture's commits carry box time (docs/implemented-plans/walk-simulated-time.md, Track 5).
  if (boxClockShiftMs(boxRoot) !== 0 && env.GIT_AUTHOR_DATE === undefined && env.GIT_COMMITTER_DATE === undefined) {
    const date = `${Math.floor(getBoxTime(boxRoot).getTime() / 1000)} +0000`;
    env.GIT_AUTHOR_DATE = date;
    env.GIT_COMMITTER_DATE = date;
  }
  return env;
}
