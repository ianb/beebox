/**
 * Child-process spawn and readiness primitives for the hub supervisor. Split
 * out of `supervisor.ts` to keep that file under the 300-line cap (the same
 * reason `child-env.ts`/`child-output-log.ts` were extracted). The
 * supervisor owns the lifecycle *state machine*; this file owns the
 * injectable I/O seams it drives. Box-path resolution is `resolveBoxRoot`/
 * `requireBoxRoot` in `../lib/box-shape.ts` — the one resolver, not
 * duplicated here.
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
  bbxBinary: string;
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
  return execa(params.bbxBinary, params.args, {
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

/** The box's own installed `bbx` when present, else the running engine's own
 *  `bbx` (a box that hasn't been `pnpm install`ed yet). */
export async function resolveBbxBinary(shape: BoxShape): Promise<string> {
  const ownBin = path.join(shape.boxRoot, "node_modules", ".bin", "bbx");
  if (await fileExists(ownBin)) return ownBin;
  return path.join(PACKAGE_ROOT, "bin", "bbx");
}
