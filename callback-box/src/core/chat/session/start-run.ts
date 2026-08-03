/**
 * Start the SDK chat backend run, wrapping the spawn so an intermittent
 * `spawn EBADF` (also EMFILE/ENFILE) is logged with an open-FD count before it
 * propagates. That failure is a known upstream Node 22+/macOS libuv FD
 * race/exhaustion, NOT our code (nodejs/node; OpenClaw #12181) — it's
 * intermittent and recovers on retry. The open-FD count is the datum we're
 * missing: a count near the ~256 macOS soft limit means exhaustion; a low count
 * means a pure spawn race. Kept out of `index.ts` to hold that file under its
 * line cap.
 */
import * as fs from "node:fs";
import { errnoCode, errorMessage } from "../../../lib/error-guards.js";
import type {
  ChatBackend,
  ChatBackendRun,
  ChatBackendStartOptions,
} from "../../../services/claude-chat.js";

export function startBackendRun(
  backend: ChatBackend,
  options: ChatBackendStartOptions,
): ChatBackendRun {
  try {
    return backend.start(options);
  } catch (e) {
    let openFds = "unknown";
    try {
      openFds = String(fs.readdirSync("/dev/fd").length);
    } catch (_probeErr) { /* ignore: FD probe is best-effort diagnostic */ }
    console.error(
      `[ChatSession:spawn-failed] SDK subprocess spawn failed (code=${errnoCode(e) ?? "?"}, ` +
        `openFDs=${openFds}). Known Node 22+/macOS libuv EBADF FD issue — high openFDs => ` +
        `exhaustion, low => race. ${errorMessage(e)}`,
    );
    throw e;
  }
}
