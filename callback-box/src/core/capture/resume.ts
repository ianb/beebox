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
import { stagingBaseDir, readStagingSession } from "./staging-store.js";
import { prepareCaptureSession, markCapturePreparationFailed } from "./prepare.js";
import { errnoCode } from "../../lib/error-guards.js";

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
    if (session.state !== "sealed" && session.state !== "preparing" && session.state !== "delivering") continue;

    console.warn(`[capture] Resuming staged capture ${id} (state=${session.state})`);
    void prepareCaptureSession({ boxRoot, id, eventBus, registry, wireSession }).catch((err: unknown) => {
      console.error(`[capture] Resume of staged capture ${id} failed:`, err);
      void markCapturePreparationFailed({ boxRoot, id, eventBus });
    });
  }
}
