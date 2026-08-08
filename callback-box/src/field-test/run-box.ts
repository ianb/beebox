/**
 * Field-test box creation — the "fresh box" half of a run's lifecycle
 * (`docs/plans/agent-field-tests.md`, Track 2).
 *
 * A field run owns a disposable box: `cb init` it under the run directory,
 * mark it as a test box, commit that as the baseline. Everything else about a
 * run (the server, the browse session, the activity loop) is somewhere else on
 * purpose — this file knows how to make a box and nothing about what a run
 * does with it.
 *
 * `cb init` runs as a SUBPROCESS rather than calling `runInit` in-process, for
 * the same reason `src/scenario/runner.ts` shells out: it is the code path a
 * boxholder actually runs, side effects (git init, hook install, doc/search
 * generation) included, and an in-process call would inherit this process's
 * cwd, env and module state.
 */

import * as path from "node:path";
import { mkdir } from "node:fs/promises";
import { execa } from "execa";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { writeFileAtomic } from "../lib/atomic-write.js";
import { boxSlug } from "../lib/box-slug.js";
import { getStatus, stageAll, commit } from "../lib/git.js";
import { resolveBoxRoot } from "../hub/child-spawn.js";

/**
 * The test-box marker, RELATIVE TO THE OPERATIONAL BOX ROOT — so in a v2
 * package it lands at `<packageRoot>/content/config/test-box`. Track 1's
 * `CB_FAKE_GMAIL` gate reads it from the same resolved root the server and the
 * CLI resolve, which is why this module resolves the root rather than guessing
 * `content/`.
 */
export const TEST_BOX_MARKER = "config/test-box";

const TEST_BOX_MARKER_BODY = [
  "This box is a callback-box field-test fixture, created by `cb field-test`.",
  "Its presence is what permits fake connector services (CB_FAKE_GMAIL) to be",
  "used against it. Real boxes never contain this file.",
  "",
].join("\n");

export interface FieldBox {
  /** Git root and `cb serve` argument: the v2 PACKAGE root. */
  packageRoot: string;
  /** The operational box root — `<packageRoot>/content` for a v2 box. */
  boxRoot: string;
  /** URL slug the server mounts this box under (the package root's basename). */
  slug: string;
}

export class FieldBoxInitError extends Error {
  constructor({ packageRoot, exitCode, output }: { packageRoot: string; exitCode: number | undefined; output: string }) {
    super(
      `cb init ${packageRoot} failed (exit ${exitCode === undefined ? "unknown" : String(exitCode)}):\n${output}`
    );
    this.name = "FieldBoxInitError";
  }
}

/** Absolute path to the `cb` this checkout ships — the same binary
 *  `src/hub/child-spawn.ts` falls back to for a box with no installed engine. */
export function cbBinary(): string {
  return path.join(PACKAGE_ROOT, "bin", "cb");
}

/**
 * Create the run's box at `<runDir>/box`: `cb init`, write the test-box
 * marker, commit the baseline. Returns the resolved roots and slug the server
 * half needs.
 *
 * The directory must not already hold a box — `cb init` over an existing one
 * is an *update*, which would silently reuse a previous run's state.
 */
export async function createFieldBox(runDir: string): Promise<FieldBox> {
  const packageRoot = path.join(runDir, "box");
  await mkdir(runDir, { recursive: true });

  const result = await execa(cbBinary(), ["init", packageRoot], {
    cwd: runDir,
    reject: false,
    all: true,
  });
  if (result.exitCode !== 0) {
    // `all` interleaves stdout+stderr: `cb init` reports its failures on both
    // (commander errors on stderr, progress on stdout), and the last lines of
    // the progress are what say how far it got.
    throw new FieldBoxInitError({ packageRoot, exitCode: result.exitCode, output: String(result.all) });
  }

  // Resolve the operational root the way every other consumer does (marker at
  // the dir, else at its `content/`) instead of hardcoding `content/`.
  const boxRoot = await resolveBoxRoot(packageRoot);
  await writeFileAtomic(path.join(boxRoot, TEST_BOX_MARKER), { content: TEST_BOX_MARKER_BODY });

  // `cb init` leaves a fresh box committed and clean, so the only thing to
  // commit here is the marker. A dirty tree beyond that would mean init's own
  // commit didn't happen — commit it all rather than leaving a run's baseline
  // half-tracked, since `reset`-policy cleanup later rewinds to this commit.
  const status = await getStatus(packageRoot);
  if (!status.clean) {
    await stageAll(packageRoot);
    await commit(packageRoot, {
      message: "Field-test baseline",
      trailers: { "Created-By": "cb field-test" },
    });
  }

  return { packageRoot, boxRoot, slug: await boxSlug(boxRoot) };
}
