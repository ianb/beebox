/**
 * Read the tail of a chat session's transcript as raw text, for scanning the
 * most recent speaker-letter tag before a diarized relabel. Shared by the
 * narration-mode HQ route (`chat-audio-routes.ts`) and the voice-recording HQ
 * job (`core/voice-recording/hq-job.ts`, `docs/plans/resilient-voice-recording.md`)
 * — both need "what letter comes next" seeded from the same source rather than
 * two readers of the transcript disagreeing about it.
 *
 * Moved out of `webapp/routes/chat-helpers.ts` (previously the only caller)
 * so a `core/` module can use it without reaching into `webapp/`.
 */

import * as fs from "node:fs/promises";
import { errnoCode } from "../../../lib/error-guards.js";
import { resolveSessionLogPath } from "./history.js";
import { resolveChatEngine } from "./engine.js";
import { loadSessionHistory } from "./load-history.js";

/**
 * Cap at 128KB — `Speaker N<L>` patterns are dense in any recent diarized
 * message, so full history isn't needed. Returns "" when the log doesn't
 * exist yet or any read step fails.
 */
const LOG_TAIL_BYTES = 128 * 1024;

export async function readSessionLogTail(boxRoot: string, sessionId: string): Promise<string> {
  try {
    if ((await resolveChatEngine(boxRoot, { sessionId })) === "codex") {
      const { entries } = await loadSessionHistory(boxRoot, {
        sessionId,
        slice: { mode: "tail", tail: 100 },
      });
      return JSON.stringify(entries);
    }
    const logPath = await resolveSessionLogPath(boxRoot, sessionId);
    const handle = await fs.open(logPath, "r");
    try {
      const stat = await handle.stat();
      const start = Math.max(0, stat.size - LOG_TAIL_BYTES);
      const length = stat.size - start;
      const buf = Buffer.alloc(length);
      await handle.read(buf, 0, length, start);
      return buf.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn("[chat] failed to read session log tail, starting speaker letters at A:", e);
    }
    return "";
  }
}
