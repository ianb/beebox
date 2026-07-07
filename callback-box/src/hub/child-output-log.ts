/**
 * Forward a hub-spawned box child's stdout/stderr to a per-box rolling log
 * file (mirrors the client-debug.log convention -- `../lib/rolling-log.js`).
 * Split out of `supervisor.ts` to keep that file under the 300-line cap.
 *
 * A box child's stdout/stderr are piped (not inherited) but otherwise never
 * consumed -- execa buffers them in memory and they vanish on exit unless
 * something reads them. Without this, a chat turn's `warnErroredTurn`
 * console.warn (the SDK's own error detail) is unrecoverable once the
 * moment passes.
 */

import { appendRollingLog } from "../lib/rolling-log.js";

/** Buffer one stream's chunks into lines and append each, timestamped and
 *  tagged, to the rolling log -- so a partial line doesn't get flushed (and
 *  timestamped) before the rest of it arrives. */
function forwardStream({
  stream,
  label,
  logFile,
}: {
  stream: NodeJS.ReadableStream | null;
  label: "stdout" | "stderr";
  logFile: string;
}): void {
  if (!stream) return;
  let buffer = "";
  stream.on("data", (chunk: Buffer | string) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    if (lines.length === 0) return;
    const text = lines.map((line) => `${new Date().toISOString()} [${label}] ${line}\n`).join("");
    void appendRollingLog(logFile, text);
  });
}

/** Structural subset of execa's `ResultPromise` this module needs -- avoids
 *  importing `supervisor.ts`'s `ChildProc` type (which would create a
 *  circular import back into this file). */
export interface ChildWithStreams {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
}

export function forwardChildOutput({ child, logFile }: { child: ChildWithStreams; logFile: string }): void {
  forwardStream({ stream: child.stdout, label: "stdout", logFile });
  forwardStream({ stream: child.stderr, label: "stderr", logFile });
}
