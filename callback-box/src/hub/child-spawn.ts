/**
 * Child-process spawn, readiness, and box-path resolution primitives for the
 * hub supervisor. Split out of `supervisor.ts` to keep that file under the
 * 300-line cap (the same reason `child-env.ts`/`child-output-log.ts` were
 * extracted). The supervisor owns the lifecycle *state machine*; this file
 * owns the injectable I/O seams it drives.
 */

import * as path from "node:path";
import { execa, type ResultPromise } from "execa";
import { type BoxShape } from "../lib/box-shape.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { fileExists } from "../lib/file-exists.js";
import { waitForHttp } from "./child-process-utils.js";

export type ChildProc = ResultPromise<{ stdio: ["ignore", "pipe", "pipe"]; detached: true; cleanup: true }>;

/** Params for spawning a box child process -- see `SpawnChildFn`. */
export interface ChildSpawnParams {
  cbBinary: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Injectable child-process spawner. Real `execa` by default; tests override
 * it to simulate a child that never becomes ready, deterministically and
 * without a real process -- see `test/hub/supervisor.doctest.md`'s restart
 * race coverage.
 */
export type SpawnChildFn = (params: ChildSpawnParams) => ChildProc;

export function defaultSpawnChild(params: ChildSpawnParams): ChildProc {
  // eslint-disable-next-line no-restricted-syntax -- execa's ResultPromise carries a large options-derived generic that TS can't infer down to our narrow ChildProc structural view; the returned handle is used only for the fields ChildProc declares
  return execa(params.cbBinary, params.args, {
    cwd: params.cwd,
    env: params.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    cleanup: true,
  }) as ChildProc;
}

/** Injectable readiness probe -- real `waitForHttp` by default; tests
 *  override it to fail immediately instead of waiting out
 *  `READY_TIMEOUT_MS` for real, so the restart race in
 *  `test/hub/supervisor.doctest.md` runs in milliseconds. */
export type CheckReadyFn = (params: { port: number; label: string }) => Promise<void>;

const READY_TIMEOUT_MS = 30_000;

export function defaultCheckReady(params: { port: number; label: string }): Promise<void> {
  return waitForHttp({ port: params.port, reqPath: "/healthz", timeoutMs: READY_TIMEOUT_MS, label: params.label });
}

class BoxResolutionError extends Error {
  constructor(entryPath: string) {
    super(
      "Configured box path " + entryPath + " has no .cb-box marker at itself or at its " +
        "content/ subdirectory -- not a callback box (checked both the v2 package-root " +
        "and legacy/v2 content-dir shapes)."
    );
    this.name = "BoxResolutionError";
  }
}

/**
 * Resolve a `hub.json` entry's `path` (may be a v2 PACKAGE root or a
 * content dir -- the plan's bilingual layout, resolved downward here the
 * way `findBoxRoot` resolves upward from a cwd) to the actual box
 * (content) root that `getBoxShape` expects.
 */
export async function resolveBoxRoot(entryPath: string): Promise<string> {
  if (await fileExists(path.join(entryPath, ".cb-box"))) return entryPath;
  const nested = path.join(entryPath, "content");
  if (await fileExists(path.join(nested, ".cb-box"))) return nested;
  throw new BoxResolutionError(entryPath);
}

/** The box's own installed `cb` when present (v2, installed), else the
 *  running engine's own `cb` (legacy boxes, or a v2 box mid-transition
 *  that hasn't been `pnpm install`ed yet -- same fallback the plan
 *  specifies for the transition window). */
export async function resolveCbBinary(shape: BoxShape): Promise<string> {
  const ownBin = path.join(shape.packageRoot, "node_modules", ".bin", "cb");
  if (await fileExists(ownBin)) return ownBin;
  return path.join(PACKAGE_ROOT, "bin", "cb");
}
