/**
 * The line a failed engine spawn logs (`src/core/chat/session/run/start-run.ts`).
 *
 * The open-descriptor count in it differs per run, so it is a pattern; the
 * error code and message are the scripted failure.
 */

import { any, str } from "@ianbicking/tap-check/check";

export function spawnFailedLine(failure: { code: string; message: string }) {
  return str`[ChatSession:spawn-failed] SDK subprocess spawn failed (code=${failure.code}, openFDs=${any(String)}). Past ~10240 open FDs on macOS every spawn fails with EBADF until descriptors are freed. ${failure.message}`;
}
