// # capture.pendingSessions: server-derived in-flight captures for a chat
//
// The `capture.pendingSessions` tRPC query lists the staging sessions bound to a
// chat that are sealed-but-not-yet-delivered (or failed and retryable), so the chat
// can render a pending capture bubble that survives reload. It reads the on-disk
// staging manifests via `listStagingSessions` and filters with `selectPendingCaptures`
// — `open` (still capturing) and `delivered` (done, cleaned up) sessions are excluded.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate } from "@ianbicking/tap-check/check";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { createStagingSession, addPhoto, setStagingState } from "../../../../src/core/capture/staging-store/core.js";

// Minimal tRPC context — pendingSessions only reads ctx.boxRoot.
function caller(boxRoot: string) {
  const ctx: TrpcContext = trpcContext({ boxRoot, isAuthenticatedOwner: true });
  return appRouter.createCaller(ctx);
}

// ## Only sealed/preparing/failed sessions for the chat are returned
void test("Only sealed/preparing/failed sessions for the chat are returned", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();

  // s1: bound to chat-1, one photo, mid-preparation → pending.
  const s1 = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null });
  await addPhoto({ boxRoot: box.root, id: s1.id, filename: "photo-001.jpg", capturedAt: "2026-07-09T14:00:00.000Z", source: "camera-user", buffer: Buffer.from("IMG") });
  await setStagingState({ boxRoot: box.root, id: s1.id, state: "preparing" });

  // s2: bound to chat-1 but still open (capture mode live) → NOT pending.
  await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null });

  // s3: bound to chat-1 but already delivered → NOT pending.
  const s3 = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null });
  await setStagingState({ boxRoot: box.root, id: s3.id, state: "delivered" });

  // s4: bound to chat-1, delivery failed → pending (retryable).
  const s4 = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null });
  await setStagingState({ boxRoot: box.root, id: s4.id, state: "failed:deliver" });

  // s5: bound to a different chat → excluded from chat-1's list.
  const s5 = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-2", createdBy: null });
  await setStagingState({ boxRoot: box.root, id: s5.id, state: "preparing" });

  const { pending } = await caller(box.root).capture.pendingSessions({ sessionId: "chat-1" });
  // The pending entries carry each capture's media counts:
  t.check(pending, [
    {
      id: s1.id,
      state: "preparing",
      counts: { photos: 1, files: 0, audioSegments: 0 },
      startedAt: isoDate(),
      lastActivityAt: isoDate(),
    },
    {
      id: s4.id,
      state: "failed:deliver",
      counts: { photos: 0, files: 0, audioSegments: 0 },
      startedAt: isoDate(),
      lastActivityAt: isoDate(),
    },
  ]);

  // The other chat sees only its own capture:

  const other = await caller(box.root).capture.pendingSessions({ sessionId: "chat-2" });
  t.check(other.pending, [
    {
      id: s5.id,
      state: "preparing",
      counts: { photos: 0, files: 0, audioSegments: 0 },
      startedAt: isoDate(),
      lastActivityAt: isoDate(),
    },
  ]);
});

// ## A chat with no staging sessions returns an empty list
void test("A chat with no staging sessions returns an empty list", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  t.check(await caller(box.root).capture.pendingSessions({ sessionId: "chat-none" }), { pending: [] });
});
