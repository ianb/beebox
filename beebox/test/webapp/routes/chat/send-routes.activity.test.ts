// # `POST /api/chat/send` with `pendingChat`
//
// The page tags a new conversation's activity entries with its own key and
// sends that key on the first send. The first turn carries the
// `<activity>` hint for those entries; once the session id is assigned, the
// key is bound to it, so the entries count as that session's.

import { test } from "tap";
import { isoDate } from "@ianbicking/tap-check/check";
import "@ianbicking/tap-check/tap";
import { makeTestServer } from "../../../helpers/test-route-server.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { readCursor, activityWindow } from "../../../../src/core/activity/cursor.js";
import { recordActivity } from "../../../../src/core/activity/log.js";
import { waitForRuns } from "../../../helpers/chat-session-spawner-helpers.js";

void test("The first send of a new chat counts its entries and binds the key.", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const backend = createFakeChatBackend();
  const ctx = await makeTestServer({ chatBackend: backend });
  await recordActivity(ctx.boxRoot, { user: null, entries: [
    { card: "Lab.figure.card", kind: "explored", detail: "add C", pendingChat: "page-key-1" },
    { card: "Lab.figure.card", kind: "explored", detail: "add H", pendingChat: "page-key-1" },
  ] });

  const res = await ctx.request({
    method: "POST",
    url: "/api/chat/send",
    payload: { session: "new", message: "I can't make water", messageId: "m1", pendingChat: "page-key-1" },
  });
  t.check(res.statusCode, 200);
  await waitForRuns(backend, { count: 1, timeoutMs: 5000 });
  const run = backend.lastRun();
  if (run === null) throw new Error("no run started");
  const text = (run.sent[0] ?? []).map((b) => (b.type === "text" ? b.text : "")).join("\n");
  t.check(/<activity [^>]*\/>/.exec(text)?.[0], "<activity entries=\"2\" cards=\"1\"/>");

  run.emitSessionInit("sess-route");
  for (let i = 0; i < 100 && (await readCursor(ctx.boxRoot, "sess-route")) === null; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  t.check(await readCursor(ctx.boxRoot, "sess-route"), { hinted: 2, previous: 0, pendingKeys: ["page-key-1"], sentAt: isoDate() });
  await recordActivity(ctx.boxRoot, { user: null, entries: [{ card: "Lab.figure.card", kind: "explored", detail: "remove H", pendingChat: "page-key-1" }] });
  t.check((await activityWindow(ctx.boxRoot, { sessionId: "sess-route" })).entries.map((e) => e.detail), ["add C", "add H", "remove H"]);
});
