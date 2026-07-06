/**
 * Post-run commit enforcement for agents.
 *
 * After an agent runs, this checks whether it left uncommitted changes. If
 * so, it resumes the same session with a nudge to commit, and — if that
 * still fails — creates a fallback commit marked `Fallback: true`.
 */

import { fmt } from "../../lib/format.js";
import { getStatus, stageAll, commit, type GitStatus } from "../../lib/git.js";
import type { Agent } from "./types.js";

export const COMMIT_NUDGE_PROMPT = `IMPORTANT: You have uncommitted changes in the working directory. Please:

1. Review the current state of your work (git status, check files)
2. Commit everything with a descriptive message following the format in your original instructions

Do NOT leave changes uncommitted. Commit now.`;

export interface EnsureCommittedOptions {
  boxRoot: string;
  /** Agent to resume for commit retry. */
  agent: Agent;
  /** Fallback commit message if retry also fails */
  fallbackMessage: string;
  /** Trailers for fallback commit */
  fallbackTrailers: Record<string, string>;
  /** Callback for status messages */
  onOutput?: (text: string) => void;
  /** Baseline git status from before the agent ran — used to distinguish
   *  pre-existing untracked files from agent-created ones. */
  baseline?: GitStatus;
}

/**
 * Check whether a git status has changes beyond what existed before the agent ran.
 * Staged and modified files are always considered agent changes.
 * Untracked files are only considered if they weren't already untracked before.
 */
function hasNewChanges(status: GitStatus, baseline: GitStatus): boolean {
  if (status.staged.length > 0 || status.modified.length > 0) return true;
  const baselineSet = new Set(baseline.untracked);
  return status.untracked.some((f) => !baselineSet.has(f));
}

/**
 * Capture a baseline snapshot of git status before the agent runs.
 * Pass the result to `ensureAgentCommitted` so it can distinguish
 * pre-existing untracked files from agent-created ones.
 */
export async function captureBaseline(boxRoot: string): Promise<GitStatus> {
  return getStatus(boxRoot);
}

/**
 * Ensure the agent committed its work. If uncommitted changes remain,
 * resume the same session with a nudge to commit. If that also fails,
 * create a fallback commit marked with Fallback: true.
 */
export async function ensureAgentCommitted(options: EnsureCommittedOptions): Promise<void> {
  const { boxRoot, agent, fallbackMessage, fallbackTrailers, onOutput } = options;
  const baseline = options.baseline ?? { staged: [], modified: [], untracked: [], clean: true };

  const status = await getStatus(boxRoot);
  if (!hasNewChanges(status, baseline)) return;

  // Retry: resume the same session with a nudge to commit
  onOutput?.(fmt.dim("  (Agent didn't commit — resuming session to request commit...)\n"));
  await agent.invoke({
    boxRoot,
    prompt: COMMIT_NUDGE_PROMPT,
    maxTurns: 5,
  });

  const retryStatus = await getStatus(boxRoot);
  if (!hasNewChanges(retryStatus, baseline)) {
    onOutput?.(fmt.ok("  Agent committed on retry\n"));
    return;
  }

  // Final fallback: commit with Fallback trailer
  onOutput?.(fmt.warn("  Agent failed to commit after retry — creating fallback commit\n"));
  await stageAll(boxRoot);
  await commit(boxRoot, {
    message: fallbackMessage,
    trailers: { ...fallbackTrailers, Fallback: "true" },
  });
}
