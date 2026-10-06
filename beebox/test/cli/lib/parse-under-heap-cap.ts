/**
 * Runs `parseSessionLog` in a child process (`parse-session-log-child.ts`)
 * under a hard V8 heap cap, for the session-retention and oversize-lines
 * doctests.
 *
 * A cap only discriminates when the bounded and unbounded parses sit far
 * apart next to it: when a run near the cap dies depends on GC timing, and
 * tsx alone holds ~25-45 MB. The oversize-lines fixture's bounded parse
 * flaked at 64 MB under load while its unbounded parse survived 96 MB, so
 * that doctest uses a backstop cap and asserts on `retainedMb` instead: the
 * heap held after a forced GC with the parse result still live, minus the
 * same measurement before the parse. That number is deterministic.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import type { SessionLogSlice } from "../../../src/cli/lib/session.js";

const PACKAGE_ROOT = join(import.meta.dirname, "../../..");
const CHILD_SCRIPT = join(PACKAGE_ROOT, "test/cli/lib/parse-session-log-child.ts");

class ParseChildFailedError extends Error {
  constructor({ exit, stdout, stderr }: { exit: string; stdout: string; stderr: string }) {
    super(`parse child exited ${exit} with stdout ${JSON.stringify(stdout)}; stderr tail:\n${stderr.slice(-2000)}`);
    this.name = "ParseChildFailedError";
  }
}

/** What the child prints on stdout. */
export interface HeapCappedParse {
  entries: number;
  total: number;
  hasMore: boolean;
  stubs: number;
  stubSample: string | null;
  retainedMb: number;
}

/**
 * Parse `logPath` with `slice` under a `heapMb` cap. Rejects, with the child's
 * exit code and stderr tail, when the child dies or prints nothing — so a heap
 * death reports as one instead of as a JSON syntax error.
 */
export function parseUnderHeapCap({ logPath, slice, heapMb }: { logPath: string; slice: SessionLogSlice; heapMb: number }): Promise<HeapCappedParse> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${heapMb}`, "--expose-gc", "--import", "tsx", CHILD_SCRIPT, logPath, JSON.stringify(slice)],
      { cwd: PACKAGE_ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += String(c); });
    child.stderr.on("data", (c) => { stderr += String(c); });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code !== 0 || stdout === "") {
        reject(new ParseChildFailedError({ exit: String(code ?? signal), stdout, stderr }));
        return;
      }
      // eslint-disable-next-line no-restricted-syntax -- parse boundary: the only producer is parse-session-log-child.ts
      resolve(JSON.parse(stdout) as HeapCappedParse);
    });
  });
}
