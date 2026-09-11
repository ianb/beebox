/**
 * Restart resume for the capture preparation worker (Track 3).
 *
 * On webapp startup, scan the box's staging area for sessions left mid-flight
 * (`sealed` — finalize fired but preparation hadn't started; `preparing` — a
 * crash interrupted it; `delivering` — a crash between send and the `delivered`
 * write, resolved idempotently by the at-most-once probe) and re-fire
 * {@link prepareCaptureSession}. Each step is idempotent, so a resumed run skips
 * completed work and finishes where it left off. Fire-and-forget so startup
 * isn't blocked; failures are logged and marked.
 */

import * as fs from "node:fs/promises";
import type { EventBus } from "../event-bus.js";
import type { ChatSession } from "../chat/session/index.js";
import type { ChatSessionRegistry } from "../chat/session/registry.js";
import { assertNever } from "../../lib/invariant.js";
import { stagingBaseDir, readStagingSession } from "./staging-store.js";
import { prepareCaptureSession, markCapturePreparationFailed } from "./prepare.js";
import { runHqJob } from "../voice-recording/hq-job.js";
import { attemptLateDelivery } from "../voice-recording/deliver-late.js";
import { errnoCode } from "../../lib/error-guards.js";

/** Voice `hq.state`s a resume should re-fire the job for — mid-flight, not yet terminal. */
const RESUMABLE_HQ_STATES = new Set(["queued", "transcribing", "retrying"]);
/** Voice `handoff.mode`s a resume should re-probe late delivery for — see `deliver-late.ts`. */
const RESUMABLE_LATE_DELIVERY_HANDOFFS = new Set(["late", "delivering"]);

export async function resumeStagingSessions(deps: {
  boxRoot: string;
  eventBus: EventBus;
  registry: ChatSessionRegistry;
  wireSession?: ((session: ChatSession) => void) | undefined;
}): Promise<void> {
  const { boxRoot, eventBus, registry, wireSession } = deps;

  let ids: string[];
  try {
    const entries = await fs.readdir(stagingBaseDir(boxRoot), { withFileTypes: true });
    ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") console.warn("[capture] Could not scan staging area for resume:", e);
    return;
  }

  for (const id of ids) {
    const session = await readStagingSession({ boxRoot, id });
    if (session === null) continue;

    // Exhaustive over `kind` so a future fourth kind fails to compile here
    // until this decides how it resumes.
    switch (session.kind) {
      case "capture":
        if (session.state !== "sealed" && session.state !== "preparing" && session.state !== "delivering") continue;
        console.warn(`[capture] Resuming staged capture ${id} (state=${session.state})`);
        void prepareCaptureSession({ boxRoot, id, eventBus, registry, wireSession }).catch((err: unknown) => {
          console.error(`[capture] Resume of staged capture ${id} failed:`, err);
          void markCapturePreparationFailed({ boxRoot, id, eventBus });
        });
        continue;
      case "bulk":
        // Bulk-upload sessions resume through their own path (`resumeBulkSessions`).
        continue;
      case "voice":
        if (session.voice === undefined) continue;
        if (RESUMABLE_HQ_STATES.has(session.voice.hq.state)) {
          console.warn(`[voice-recording] Resuming HQ job for ${id} (hq.state=${session.voice.hq.state})`);
          void runHqJob({ boxRoot, id, eventBus, registry, wireSession }).catch((err: unknown) => {
            console.error(`[voice-recording] Resume of HQ job ${id} failed:`, err);
          });
        } else if (RESUMABLE_LATE_DELIVERY_HANDOFFS.has(session.voice.handoff.mode)) {
          console.warn(`[voice-recording] Resuming late delivery for ${id} (handoff=${session.voice.handoff.mode})`);
          void attemptLateDelivery({ boxRoot, id, eventBus, registry, wireSession }).catch((err: unknown) => {
            console.error(`[voice-recording] Resume of late delivery ${id} failed:`, err);
          });
        }
        continue;
      default:
        assertNever(session.kind);
    }
  }
}
