import { boxWorkEnvironment } from "../../box-maintenance/admission.js";
import { boxClockShiftMs, getBoxTime } from "../../time.js";

/** Preserve hooks/tooling while excluding the override keys blocked by simple-git's parseEnv policy. */
export function commitEnvironment(boxRoot: string): NodeJS.ProcessEnv {
  const blocked = new Set([
    "editor", "visual", "git_askpass", "git_config_global", "git_config_system",
    "git_config_count", "git_config", "git_editor", "git_exec_path", "git_external_diff",
    "git_pager", "git_proxy_command", "git_template_dir", "git_sequence_editor",
    "git_ssh", "git_ssh_command", "pager", "prefix", "ssh_askpass",
  ]);
  const env = Object.fromEntries(Object.entries({ ...process.env, ...boxWorkEnvironment() })
    .filter(([key]) => !blocked.has(key.toLowerCase()) && !/^git_config_(key|value)_/i.test(key)));
  // A walk fixture's commits carry box time (docs/implemented-plans/walk-simulated-time.md, Track 5).
  if (boxClockShiftMs(boxRoot) !== 0 && env.GIT_AUTHOR_DATE === undefined && env.GIT_COMMITTER_DATE === undefined) {
    const date = `${Math.floor(getBoxTime(boxRoot).getTime() / 1000)} +0000`;
    env.GIT_AUTHOR_DATE = date;
    env.GIT_COMMITTER_DATE = date;
  }
  return env;
}
