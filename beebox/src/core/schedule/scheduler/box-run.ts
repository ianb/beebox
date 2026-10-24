/**
 * How the daemon runs a box's pass on a unit host: through
 * `sudo bbx-box-run <slug> scheduler-pass` (deploy/server-bin/bbx-box-run),
 * the one root path the scheduler user may call, which starts
 * `beebox-pass@<slug>.service` and waits for it. The wrapper's presence on
 * the host is the selector; a machine without it runs the pass in process.
 */

import { promises as fs, constants as fsConstants } from "node:fs";
import * as path from "node:path";
import { errnoCode } from "../../../shared/error-guards.js";
import { runCollectedChild } from "../../../lib/run-child.js";

export const BOX_RUN_WRAPPER = "/usr/local/sbin/bbx-box-run";

export async function boxRunWrapperPresent(): Promise<boolean> {
  try {
    await fs.access(BOX_RUN_WRAPPER, fsConstants.X_OK);
    return true;
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return false;
    throw e;
  }
}

/** The unit's instance name: the box home's basename (`/var/lib/beebox/<slug>/box`). */
export function slugForBoxRoot(boxRoot: string): string {
  return path.basename(path.dirname(path.resolve(boxRoot)));
}

export class BoxRunFailedError extends Error {
  readonly slug: string;
  readonly code: number;
  constructor(run: { slug: string; code: number; output: string }) {
    super(`bbx-box-run ${run.slug} scheduler-pass exited ${String(run.code)}: ${run.output.trim()}`);
    this.name = "BoxRunFailedError";
    this.slug = run.slug;
    this.code = run.code;
  }
}

/** Run one box's pass through the wrapper; the wrapper's output is the pass unit's. */
export async function runPassThroughWrapper(slug: string): Promise<void> {
  const { code, output } = await runCollectedChild({
    command: "sudo",
    args: ["-n", BOX_RUN_WRAPPER, slug, "scheduler-pass"],
    cwd: "/",
  });
  if (code !== 0) throw new BoxRunFailedError({ slug, code, output });
}
