// The durable sink behind `log()` in router-config.ts: a size-capped append
// file at `<stateDir>/logs/router.log`, beside the per-worktree child logs
// `router-worktree-start.ts` already writes.
//
// Why this exists: every `[router …]` line used to live only in the terminal
// scrollback of whoever started the router, so the line explaining the
// 2026-09-15 three-hour outage had to be pasted in by hand
// (issues/bugs/2026-09-15-dev-router-transient-failures-are-permanent-and-unlogged.md).
// `grep -c "\[router " ~/.cache/beebox/logs/main.log` returned 0. Post-mortems
// here are routine, so the bar is that a future agent can find this file and
// read it cold; bin/docs/router-operations.md names the path and the line shapes.
//
// Importing this module opens nothing. The sink is installed explicitly by
// router.ts's `main()` via `startRouterLogFile`, which keeps router-config.ts's
// "reading this module has no side effects" property intact and keeps the unit
// tests from writing into the developer's real state directory.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/** Cap before one rollover to `router.log.1`. Two files, never a directory
 *  that grows without bound — nothing retries forever, and nothing logs forever. */
export const ROUTER_LOG_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Should appending `incoming` bytes to a file already holding `bytes` roll it
 * over first? Pure, so the boundary is unit-testable without writing 16MB.
 *
 * A line larger than the cap on its own still gets written (after a rollover):
 * refusing to log it would lose exactly the outsized failure dump that is most
 * worth keeping.
 */
export function shouldRotate({ bytes, incoming, max }: { bytes: number; incoming: number; max: number }): boolean {
  return bytes > 0 && bytes + incoming > max;
}

interface FileSink {
  stream: fs.WriteStream;
  bytes: number;
}

let sink: FileSink | null = null;
let logPath: string | null = null;
/** One warning per process, then silence: a full disk must not turn an
 *  observability improvement into a torrent of its own. */
let warned = false;

function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  console.error(`[router] durable log unavailable, continuing on console only: ${message}`);
}

function openStream(file: string, bytes: number): FileSink {
  const stream = fs.createWriteStream(file, { flags: "a" });
  // A write error arrives as an 'error' event, not a throw, so without this
  // listener a failed append is an unhandled 'error' that takes the router
  // down — the opposite of what durable logging is for.
  stream.on("error", (err: Error) => {
    warnOnce(err.message);
    sink = null;
  });
  return { stream, bytes };
}

/**
 * Install the file sink. Called once from `main()`; safe to call again (the
 * previous stream is closed first) so a test can point it at a temp directory.
 */
export async function startRouterLogFile(logDir: string): Promise<void> {
  stopRouterLogFile();
  const file = path.join(logDir, "router.log");
  try {
    await fsp.mkdir(logDir, { recursive: true });
    const existing = await fsp.stat(file).then(
      (s) => s.size,
      () => 0,
    );
    sink = openStream(file, existing);
    logPath = file;
  } catch (e) {
    warnOnce(e instanceof Error ? e.message : String(e));
  }
}

/** Release the sink (full-router shutdown, or a test tearing down its tmp dir). */
export function stopRouterLogFile(): void {
  sink?.stream.end();
  sink = null;
  logPath = null;
  warned = false;
}

/** Where the durable log is being written, or null when no sink is installed.
 *  Reported by `/__router/status` so a post-mortem starts from the file path. */
export function routerLogPath(): string | null {
  return logPath;
}

/**
 * Append one already-formatted line. A no-op until `startRouterLogFile` runs,
 * which is what makes console-only the safe default for tests and for any
 * import-time logging before boot completes.
 */
export function writeRouterLogLine(line: string): void {
  const current = sink;
  if (current === null) return;
  const payload = `${line}\n`;
  const incoming = Buffer.byteLength(payload);
  if (shouldRotate({ bytes: current.bytes, incoming, max: ROUTER_LOG_MAX_BYTES }) && logPath !== null) {
    const file = logPath;
    current.stream.end();
    try {
      fs.renameSync(file, `${file}.1`);
      sink = openStream(file, 0);
    } catch (e) {
      warnOnce(e instanceof Error ? e.message : String(e));
      sink = null;
      return;
    }
  }
  const active = sink;
  if (active === null) return;
  active.stream.write(payload);
  active.bytes += incoming;
}
