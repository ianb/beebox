/**
 * Field-test box creation — the "fresh box" half of a run's lifecycle
 * (`docs/plans/agent-field-tests.md`, Track 2).
 *
 * A field run owns a disposable box: `bbx init` it under the run directory,
 * mark it as a test box, commit that as the baseline. Everything else about a
 * run (the server, the browse session, the activity loop) is somewhere else on
 * purpose — this file knows how to make a box and nothing about what a run
 * does with it.
 *
 * `bbx init` runs as a SUBPROCESS rather than calling `runInit` in-process, for
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
import { fileExists } from "../lib/file-exists.js";
import { boxSlug } from "../lib/box-slug.js";
import { getStatus, stageAll, commit } from "../lib/git.js";
import { requireBoxRoot } from "../lib/box-shape.js";

/**
 * The test-box marker, RELATIVE TO THE BOX ROOT — so it lands at
 * `<boxRoot>/_config/test-box`. Track 1's `BBX_FAKE_GMAIL` gate reads it from
 * the same resolved root the server and the CLI resolve, which is why this
 * module resolves the root rather than guessing.
 */
export const TEST_BOX_MARKER = "_config/test-box";

const TEST_BOX_MARKER_BODY = [
  "This box is a Bee Box field-test fixture, created by `bbx field-test`.",
  "Its presence is what permits fake connector services (BBX_FAKE_GMAIL) to be",
  "used against it. Real boxes never contain this file.",
  "",
].join("\n");

export interface FieldBox {
  /** Git root, box root, and `bbx serve` argument — one root (shapeVersion 3). */
  boxRoot: string;
  /** URL slug the server mounts this box under (the box root's basename). */
  slug: string;
}

class FieldBoxInitError extends Error {
  constructor({ boxRoot, exitCode, output }: { boxRoot: string; exitCode: number | undefined; output: string }) {
    super(
      `bbx init ${boxRoot} failed (exit ${exitCode === undefined ? "unknown" : String(exitCode)}):\n${output}`
    );
    this.name = "FieldBoxInitError";
  }
}

class FieldBoxExistsError extends Error {
  constructor(boxRoot: string) {
    super(
      `${boxRoot} already exists — a field run must create its box from nothing ` +
        "(`bbx init` over an existing directory updates it in place, inheriting the previous run's state)."
    );
    this.name = "FieldBoxExistsError";
  }
}

/** Absolute path to the `bbx` this checkout ships — the same binary
 *  `src/hub/child-spawn.ts` falls back to for a box with no installed engine. */
/** Absolute path to the `bbx` this checkout ships. */
export function bbxBinary(): string {
  return path.join(PACKAGE_ROOT, "bin", "bbx");
}

/**
 * Create the run's box at `<runDir>/box`: `bbx init`, write the test-box
 * marker, commit the baseline. Returns the resolved roots and slug the server
 * half needs. Refuses a `<runDir>/box` that already exists.
 */
export async function createFieldBox(runDir: string): Promise<FieldBox> {
  const target = path.join(runDir, "box");
  await mkdir(runDir, { recursive: true });

  // Enforced, not merely intended: `bbx init` over an existing directory is an
  // UPDATE (`src/cli/commands/init.ts` — `detectBoxTarget` returns a non-fresh
  // mode, and the baseline commit at the end is skipped), so a reused run
  // directory would quietly inherit the previous run's cards, git history and
  // connector state. A run must start from nothing.
  if (await fileExists(target)) {
    throw new FieldBoxExistsError(target);
  }

  const result = await execa(bbxBinary(), ["init", target], {
    cwd: runDir,
    reject: false,
    all: true,
    // Pin the box's git hooks to THIS checkout's `bbx`. Without the override,
    // `resolveBbxBin()` deliberately routes a linked worktree's hooks at the
    // MAIN checkout's `bbx` (worktrees are ephemeral; a stamped path that
    // vanishes silently disables validation) — but a field box is created by
    // this checkout to exercise this checkout, and init's own baseline commit
    // runs the hook immediately. A `main` that predates a flag the new hook
    // uses would fail that commit and take the whole run down with it.
    env: { BBX_HOOK_BIN: bbxBinary() },
    extendEnv: true,
  });
  if (result.exitCode !== 0) {
    // `all` interleaves stdout+stderr: `bbx init` reports its failures on both
    // (commander errors on stderr, progress on stdout), and the last lines of
    // the progress are what say how far it got.
    throw new FieldBoxInitError({ boxRoot: target, exitCode: result.exitCode, output: String(result.all) });
  }

  // `bbx init` scaffolds `target` itself as the (one) box root; confirm
  // that via the shared resolver rather than assuming it.
  const boxRoot = await requireBoxRoot(target);
  await writeFileAtomic(path.join(boxRoot, TEST_BOX_MARKER), { content: TEST_BOX_MARKER_BODY });

  // `bbx init` leaves a fresh box committed and clean, so the only thing to
  // commit here is the marker. A dirty tree beyond that would mean init's own
  // commit didn't happen — commit it all rather than leaving a run's baseline
  // half-tracked, since `reset`-policy cleanup later rewinds to this commit.
  const status = await getStatus(boxRoot);
  if (!status.clean) {
    await stageAll(boxRoot);
    await commit(boxRoot, {
      message: "Field-test baseline",
      trailers: { "Created-By": "bbx field-test" },
    });
  }

  return { boxRoot, slug: await boxSlug(boxRoot) };
}
