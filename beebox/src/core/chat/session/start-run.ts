/**
 * Opening the SDK chat backend run: agent-docs refresh, the chat-active lock,
 * and the spawn itself — plus the failure handling that keeps a failed start
 * from stranding the session. Kept out of `index.ts` to hold that file under
 * its line cap.
 *
 * The spawn is wrapped because it can fail with `EBADF` (also EMFILE/ENFILE)
 * when the process is out of file descriptors. On macOS that ceiling is the
 * legacy per-process `OPEN_MAX` of 10240 — far below `ulimit -n` — and past it
 * *every* spawn in the process fails, so the failure is not transient: the chat
 * agent cannot start at all until descriptors are freed. The cause was the box
 * file watcher holding one descriptor per watched file; see
 * `issues/bugs/2026-08-03-intermittent-spawn-ebadf-sdk-chat-run.md` and
 * `core/box/file-watcher.ts`. The open-FD count is logged on failure, and a
 * warning fires while there is still headroom, so a recurrence names itself
 * instead of surfacing as an opaque spawn error.
 */
import * as fs from "node:fs";
import { errnoCode, errorMessage } from "../../../lib/error-guards.js";
import { generateDocs } from "../../docs-gen/index.js";
import { makeLog } from "./log.js";
import type {
  ChatBackend,
  ChatBackendRun,
  ChatBackendStartOptions,
} from "../../../services/claude-chat.js";

/**
 * Open-FD count above which a spawn is at risk. Warn with enough headroom below
 * 10240 that the warning lands in the logs before chat stops working, and
 * rate-limit it so a busy server doesn't repeat it every turn.
 */
/** Same "ChatSession" prefix `index.ts` logs under — this is its run-start half. */
const log = makeLog("ChatSession");

const FD_WARN_THRESHOLD = 8000;
const FD_WARN_INTERVAL_MS = 60_000;
let lastFdWarnAt = 0;

/** How many descriptors this process holds, or null if the probe failed. */
function openFdCount(): number | null {
  try {
    return fs.readdirSync("/dev/fd").length;
  } catch (_probeErr) {
    /* ignore: the FD probe is a best-effort diagnostic, not a dependency */
    return null;
  }
}

/**
 * Warn while the process is near the spawn-killing FD ceiling. Cheap (one
 * readdir per run start) and it buys the thing the original incident lacked: a
 * signal *before* the failure rather than after.
 */
function warnIfFdsRunningOut(): void {
  const count = openFdCount();
  if (count === null || count < FD_WARN_THRESHOLD) return;
  const now = Date.now();
  if (now - lastFdWarnAt < FD_WARN_INTERVAL_MS) return;
  lastFdWarnAt = now;
  console.warn(
    `[ChatSession:fd-pressure] ${count} open file descriptors — past ~10240 every subprocess ` +
      "spawn fails with EBADF and chat stops working. Look for a per-file watcher or an " +
      `unclosed read handle (lsof -p ${process.pid}).`,
  );
}

function startBackendRun(
  backend: ChatBackend,
  options: ChatBackendStartOptions,
): ChatBackendRun {
  warnIfFdsRunningOut();
  try {
    return backend.start(options);
  } catch (e) {
    console.error(
      `[ChatSession:spawn-failed] SDK subprocess spawn failed (code=${errnoCode(e) ?? "?"}, ` +
        `openFDs=${openFdCount() ?? "unknown"}). Past ~10240 open FDs on macOS every spawn ` +
        `fails with EBADF until descriptors are freed. ${errorMessage(e)}`,
    );
    throw e;
  }
}

/**
 * Refresh agent docs, take the chat-active lock, and spawn the run. Either
 * yields a live run, or unwinds everything it did and throws.
 *
 * Unwinding matters more than it looks. The lock is released because one left
 * held would make `bbx tick` defer commits indefinitely against a run that never
 * started. `onFailed` is the caller's chance to reset its own state: a
 * `ChatSession` that stays in `starting` reads as permanently busy, and neither
 * `stop()` nor `restart()` can clear it (both need a live run to close), so
 * every later send queues behind a turn that will never end. That combination —
 * an FD-exhausted spawn plus no unwind — was the "wedged agent" in
 * `issues/bugs/2026-08-03-intermittent-spawn-ebadf-sdk-chat-run.md`.
 *
 * The error is rethrown, never swallowed: the caller decides how to report it
 * (the chat-send route turns it into a 500; a queue drain logs it).
 */
export async function openChatRun(opts: {
  backend: ChatBackend;
  boxRoot: string;
  skipBootstrap: boolean;
  startOptions: ChatBackendStartOptions;
  resumeSessionId: string | undefined;
  model: string | undefined;
  acquireLock: () => Promise<void>;
  releaseLock: () => Promise<void>;
  onFailed: () => void;
}): Promise<ChatBackendRun> {
  try {
    // Best-effort: a regen/commit failure here (e.g. a git-permission hiccup in
    // the template-sync commit) must not 500 the chat — log and proceed on-disk.
    if (!opts.skipBootstrap) {
      await generateDocs(opts.boxRoot).catch((e: unknown) => log("start", `generateDocs failed (continuing): ${e}`));
    }

    log("start", "Starting SDK chat run");

    // Hold a chat-active lock for the duration of the SDK run so that
    // `bbx tick` (and any other housekeeping process) can detect a chat is
    // mid-response and defer commits that would race with agent writes.
    await opts.acquireLock();

    return startBackendRun(opts.backend, {
      ...opts.startOptions,
      resumeSessionId: opts.resumeSessionId,
      model: opts.model,
    });
  } catch (e) {
    log("start", `Run start failed, resetting session to idle: ${errorMessage(e)}`);
    // The state reset must happen even if releasing the lock fails, and the
    // original error must survive: reversing these, or letting a lock-release
    // rejection escape, would leave the session in `starting` — recreating the
    // exact permanent-busy wedge this unwind exists to prevent, now masked by a
    // different error.
    try {
      await opts.releaseLock();
    } catch (releaseErr) {
      console.error("[ChatSession:start] releasing the run lock after a failed start failed:", releaseErr);
    } finally {
      opts.onFailed();
    }
    throw e;
  }
}
