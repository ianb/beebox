// # Capture delivery into a chat that has not run yet
//
// The filed issue: capture into a brand-new chat was blocked because the chat had
// no id to deliver to, and lifting the block naively would have let the capture
// land somewhere else. A chat whose id was coined and reserved
// (`core/chat/session/reserve.ts`) has no history entry until its first turn — so
// the delivery target has to know about reservations, or the capture falls through
// to the most-active chat: the exact misdirection the "send a message first" gate
// existed to prevent.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { makeTmpBox, type TmpBox } from "../../../helpers/test-helpers.js";
import { ChatSessionRegistry } from "../../../../src/core/chat/session/registry/core.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { plainTestPrompt } from "../../../helpers/chat-session-spawner-helpers.js";
import { appendHistory, setMostActive } from "../../../../src/core/chat/session/history.js";
import { resolveCaptureDeliveryTarget } from "../../../../src/core/capture/prepare/deliver.js";
import { resolveBulkDeliveryTarget } from "../../../../src/core/bulk-upload/worker/deliver.js";

const COINED = "33333333-4444-4555-8666-777777777777";
const OTHER = "88888888-9999-4aaa-8bbb-cccccccccccc";

function makeRegistry(box: TmpBox) {
  return new ChatSessionRegistry(box.root, {
    backend: createFakeChatBackend(),
    buildSessionOptions: () => ({ systemPrompt: plainTestPrompt, skipBootstrap: true }),
  });
}

// ## A capture staged against a reserved chat lands in that chat
//
// Even with another chat sitting in the most-active pointer — the chat the old
// fallback would have chosen.
void test("Even with another chat sitting in the most-active pointer — the chat the old...", async (t) => {
  t.teardown(async () => {
    try {
      registry.shutdown();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const registry = makeRegistry(box);
  await appendHistory(box.root, { sessionId: OTHER });
  await setMostActive(box.root, OTHER);
  await registry.reserve({ sessionId: COINED, contextDir: null, seedFeatures: {} });

  const target = await resolveCaptureDeliveryTarget({ boxRoot: box.root, registry, targetSessionId: COINED });
  t.check(target.sessionId, "33333333-4444-4555-8666-777777777777");

  // Without the registry — the shape every caller used before reservations existed —
  // the same staged capture goes to the wrong chat, which is the bug this test
  // pins down:

  const blind = await resolveCaptureDeliveryTarget({ boxRoot: box.root, targetSessionId: COINED });
  t.check(blind.sessionId, "88888888-9999-4aaa-8bbb-cccccccccccc");
});

// ## A reserved landmark chat delivers under its landmark
//
// The binding is captured at reserve time — nothing else carries it, since
// `contextDir` only ever rides a `"new"` send.
void test("The binding is captured at reserve time — nothing else carries it, since cont...", async (t) => {
  t.teardown(async () => {
    try {
      registry.shutdown();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const registry = makeRegistry(box);
  await registry.reserve({ sessionId: COINED, contextDir: "_content/recipes", seedFeatures: {} });

  const target = await resolveCaptureDeliveryTarget({ boxRoot: box.root, registry, targetSessionId: COINED });
  t.check(target, {
    sessionId: "33333333-4444-4555-8666-777777777777",
    contextDir: "_content/recipes",
  });
});

// ## A bulk batch reaches a reserved chat, and still never falls back
//
// Bulk keeps its rule: a batch either reaches the chat it was launched from or
// stays retryable. Reservations add a way to *be* that chat, not a fallback.
void test("Bulk keeps its rule:", async (t) => {
  t.teardown(async () => {
    try {
      registry.shutdown();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const registry = makeRegistry(box);
  await appendHistory(box.root, { sessionId: OTHER });
  await setMostActive(box.root, OTHER);
  await registry.reserve({ sessionId: COINED, contextDir: null, seedFeatures: {} });

  const reserved = await resolveBulkDeliveryTarget({ boxRoot: box.root, registry, targetSessionId: COINED, contextDir: "" });
  t.check(reserved?.sessionId, "33333333-4444-4555-8666-777777777777");

  // An id that is neither reserved nor known is still the broken-invariant `null`,
  // not somebody else's chat:

  t.check(await resolveBulkDeliveryTarget({ boxRoot: box.root, registry, targetSessionId: "44444444-5555-4666-8777-888888888888", contextDir: "" }), null);
});
