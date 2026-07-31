/**
 * Restart resume for the bulk-upload prepare→deliver worker.
 *
 * On webapp startup, scan the box's staging area for bulk sessions left
 * mid-flight (`sealed` — finalize fired but the worker hadn't started;
 * `preparing` — a crash interrupted it; `delivering` — a crash between
 * send/enqueue and the `delivered` write) and re-fire the worker. This is also
 * the durable-notification reconciliation: at startup the in-memory delivery
 * queue is empty, so the worker's at-most-once transcript probe is
 * authoritative — a `delivering` batch whose `<upload>` message actually landed
 * is finished without re-sending, and one whose message was lost in the crash is
 * re-delivered exactly once. Each step is idempotent; fire-and-forget so startup
 * isn't blocked.
 */

import * as fs from "node:fs/promises";
import type { EventBus } from "../event-bus.js";
import type { ChatSession } from "../chat/session/index.js";
import type { ChatSessionRegistry } from "../chat/session/registry.js";
import { stagingBaseDir, readStagingSession, isBulkSession} from "../capture/staging-store.js";
import { cleanupStagingSession } from "../capture/staging-teardown.js";
import { prepareAndDeliverBulkBatch, markBulkPreparationFailed } from "./worker.js";
import { errnoCode } from "../../lib/error-guards.js";

export async function resumeBulkSessions(deps: {
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
    if (errnoCode(e) !== "ENOENT") console.warn("[bulk] Could not scan staging area for resume:", e);
    return;
  }

  for (const id of ids) {
    const session = await readStagingSession({ boxRoot, id });
    if (session === null) continue;
    if (!isBulkSession(session)) continue; // Capture sessions resume via their own path.
    // A `delivered` batch finished delivery but its staging teardown didn't land
    // (a swallowed cleanup failure). Retry the delete — the session.json stays on
    // `delivered` if it fails again, so a later resume/sweep keeps retrying.
    if (session.state === "delivered") {
      await cleanupStagingSession({ boxRoot, id });
      continue;
    }
    if (session.state !== "sealed" && session.state !== "preparing" && session.state !== "delivering") continue;

    console.warn(`[bulk] Resuming staged bulk batch ${id} (state=${session.state})`);
    void prepareAndDeliverBulkBatch({ boxRoot, id, eventBus, registry, wireSession }).catch((err: unknown) => {
      console.error(`[bulk] Resume of staged bulk batch ${id} failed:`, err);
      void markBulkPreparationFailed({ boxRoot, id });
    });
  }
}
