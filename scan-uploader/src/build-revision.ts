/**
 * Build-time only: the revision `build.ts` stamps into the bundle.
 *
 * Deliberately its own module rather than part of `build-stamp.ts` or of
 * `build.ts`. It must not be reachable from `cli.ts` — it shells out to `git`,
 * which does not exist on the machines the bundle is copied to — and keeping it
 * here means nothing in the runtime graph can import it by accident. `build.ts`
 * is its only caller.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { UNKNOWN_REVISION } from "./build-stamp.js";

/**
 * The revision the bundle is being built from.
 *
 * `--dirty` matters: a bundle built from uncommitted work is not the revision
 * it names, and the box should see that rather than a hash that does not
 * describe the file it is talking to. Outside a git tree (a build from an
 * exported tarball) the revision is unavailable, but the build time still is,
 * so the box can tell the uploader is old even without knowing which commit.
 */
export async function gitRevision(): Promise<string> {
  try {
    const { stdout } = await promisify(execFile)("git", ["describe", "--always", "--dirty", "--abbrev=8"]);
    const revision = stdout.trim();
    return revision === "" ? UNKNOWN_REVISION : revision;
  } catch (e) {
    console.warn(`build: no git revision available (${String(e)}); stamping "${UNKNOWN_REVISION}"`);
    return UNKNOWN_REVISION;
  }
}

/** The JSON `build.ts` hands to esbuild's `define`, parsed back by
 * `build-stamp.ts`'s `buildStamp()`. The two must agree on these field names. */
export async function buildStampJson(): Promise<string> {
  return JSON.stringify({ revision: await gitRevision(), builtAt: new Date().toISOString() });
}
