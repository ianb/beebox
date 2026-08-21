/**
 * The durable facts a chat acquires the first time it really starts: its
 * history entry, its persisted feature seeds, the most-active pointer, and its
 * husk card.
 *
 * Two paths reach here, because a chat's id arrives in one of two ways. A
 * harness-assigned id arrives mid-run through `onSessionIdAssigned`; a coined
 * id (`reserve.ts`) was known before the run and therefore never fires that
 * callback at all — `captureAssignedSessionId` returns early once the session
 * knows its id — so a coined session calls this from its first run start
 * instead. Writing these at reserve time would instead leave a husk and a
 * history entry behind for every new chat the user opened and abandoned.
 *
 * Split from `registry.ts` for that file's line budget; it is the registry's
 * bookkeeping half and has no other callers.
 */

import { makeLog } from "./log.js";
import { appendHistory, setMostActive, updateFeaturesForSession } from "./history.js";
import { ensureChatHusk } from "../husk.js";
import type { AgentEngine } from "../../box/config.js";

const log = makeLog("ChatSessionRegistry");

/**
 * Idempotent, and quiet on failure the way this bookkeeping always has been: a
 * chat whose history or husk write failed still works, it just lists poorly.
 */
export async function recordSessionStart(
  boxRoot: string,
  params: {
    sessionId: string;
    contextDir?: string | undefined;
    seedFeatures?: Record<string, string> | undefined;
    /**
     * The engine this chat was reserved against. Passed rather than resolved,
     * because `appendHistory` would otherwise fall back to whatever the box is
     * configured with *now* — and a coined chat's transcript was created by the
     * engine that was configured when it was reserved.
     */
    engine?: AgentEngine | undefined;
  },
): Promise<void> {
  const { sessionId, contextDir, seedFeatures, engine } = params;
  try {
    await appendHistory(boxRoot, {
      sessionId,
      ...(contextDir !== undefined ? { contextDir } : {}),
      ...(engine !== undefined ? { engine } : {}),
    });
    // Persist landmark feature seeds alongside the new history entry so a
    // future resume of this session (or a fresh server boot) still sees the
    // seed as the session's starting state. User toggles afterward overwrite
    // specific keys via updateFeaturesForSession.
    if (seedFeatures && Object.keys(seedFeatures).length > 0) {
      await updateFeaturesForSession(boxRoot, { sessionId, updates: seedFeatures });
    }
    await setMostActive(boxRoot, sessionId);
  } catch (e) {
    log("session-start", `History/most-active write failed: ${e instanceof Error ? e.message : e}`);
  }

  // Husk card for the session (docs/plans/chat-husks.md) — the box-side noun
  // for this chat. Its own catch: a husk failure never blocks chat.
  try {
    await ensureChatHusk(boxRoot, {
      sessionId,
      ...(contextDir !== undefined ? { contextDir } : {}),
    });
  } catch (e) {
    log("session-start", `Chat husk write failed: ${e instanceof Error ? e.message : e}`);
  }
}
