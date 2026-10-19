/**
 * Runs `parseSessionLog` in a child process (`parse-session-log-child.ts`) and
 * reports the heap the parse kept alive, for the session-retention and
 * oversize-lines tests.
 *
 * Both numbers are live-heap measurements after a forced GC, relative to the
 * same measurement before the parse: `retainedMb` with the result still held,
 * and `peakLiveMb` as the largest of samples taken while the parse runs. GC
 * timing and host load cannot move a live-set measurement, so the tests assert
 * on these numbers.
 *
 * The tests used to assert that the child survived a `--max-old-space-size`
 * cap instead. That flaked: a cap mixes the parse's bound with tsx and the
 * module graph (~75 MB live on 2026-10-18) and with when V8 gets to collect,
 * so a correct parse died under load at both 64 MB and 128 MB.
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
export interface ChildParse {
  entries: number;
  total: number;
  hasMore: boolean;
  stubs: number;
  stubSample: string | null;
  retainedMb: number;
  peakLiveMb: number;
}

/**
 * Parse `logPath` with `slice` in a child. Rejects, with the child's exit code
 * and stderr tail, when the child dies or prints nothing.
 */
export function parseInChild({ logPath, slice }: { logPath: string; slice: SessionLogSlice }): Promise<ChildParse> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--expose-gc", "--import", "tsx", CHILD_SCRIPT, logPath, JSON.stringify(slice)],
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
      resolve(JSON.parse(stdout) as ChildParse);
    });
  });
}
