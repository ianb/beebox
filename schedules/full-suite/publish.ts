/**
 * The engine image channel: one publish a day from a green run on main.
 *
 * `.github/workflows/image.yml` builds ghcr.io/ianb/beebox from a commit and
 * publishes it as `:latest`, which the Mac app follows (see
 * beebox/docs/implemented-plans/mac-app-engine-channel.md). A green full-suite run is the
 * only gate; this module throttles it to one dispatch per UTC day and records
 * the commit it sent so a quiet day costs nothing.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { readImagePublish, writeImagePublish } from "./state.js";

const execFileAsync = promisify(execFile);

export const IMAGE_WORKFLOW = "image.yml";
export const IMAGE_REPO = "ianb/beebox";

export interface ImagePublishState {
  /** The commit last sent to the image workflow. */
  commit: string;
  /** When it was sent (ISO instant). */
  dispatchedAt: string;
}

/** A dispatch is due once per UTC day, and only for a commit not yet sent. */
export function imagePublishDue(input: { last: ImagePublishState | null; commit: string; now: Date }): boolean {
  if (input.last === null) return true;
  if (input.last.commit === input.commit) return false;
  return input.last.dispatchedAt.slice(0, 10) !== input.now.toISOString().slice(0, 10);
}

/**
 * Ask GitHub to build and publish `commit` as `:latest`. `--ref main` names
 * the workflow file's branch; the commit travels as the workflow's `ref`
 * input. A failure (no `gh`, no network, no auth) is reported and leaves the
 * state untouched, so the next green run tries again.
 */
export async function publishImageIfDue(commit: string, nowArg?: Date): Promise<void> {
  const now = nowArg ?? new Date();
  const last = await readImagePublish();
  if (!imagePublishDue({ last, commit, now })) return;
  try {
    await execFileAsync("gh", [
      "workflow", "run", IMAGE_WORKFLOW,
      "-R", IMAGE_REPO,
      "--ref", "main",
      "-f", `ref=${commit}`,
      "-f", "channel=latest",
    ]);
  } catch (error) {
    process.stdout.write(`full-suite: image publish not dispatched for ${commit.slice(0, 8)}: ${error instanceof Error ? error.message : String(error)}\n`);
    return;
  }
  await writeImagePublish({ commit, dispatchedAt: now.toISOString() });
  process.stdout.write(`full-suite: image publish dispatched for ${commit.slice(0, 8)} (ghcr.io/${IMAGE_REPO}:latest).\n`);
}
