// # activity router
//
// `activity.record` appends what the page's queue posts to the activity log.
// The server stamps the signed-in user; a bad entry is dropped without
// failing the batch; a caller past no auth wall is refused.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate } from "@ianbicking/tap-check/check";
import { TRPCError } from "@trpc/server";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { consoleLines } from "../../../helpers/console-lines.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { readActivity } from "../../../../src/core/activity/log.js";

void test("Entries are stamped with the signed-in user; a bad one is dropped.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const warnings = consoleLines(t, "warn");
  const caller = appRouter.createCaller(trpcContext({ boxRoot: box.root, user: { email: "juni@example.com", name: "Juni" } }));

  t.check(await caller.activity.record({ entries: [
    { card: "Lab.figure.card", kind: "explored", detail: "add C", chat: "s1", afterMessage: "m1", clientAt: "2026-11-13T10:00:00.000Z" },
    { card: "Lab.figure.card", kind: "bogus" },
  ] }), { accepted: 1 });
  t.check(await readActivity(box.root), [
    { seq: 1, at: isoDate(), user: "juni@example.com", card: "Lab.figure.card", kind: "explored", detail: "add C", chat: "s1", afterMessage: "m1", clientAt: "2026-11-13T10:00:00.000Z" },
  ]);
  t.check(warnings(), ["[activity] dropped entry 1: Invalid option: expected one of \"scrolled\"|\"navigated\"|\"explored\"|\"modified\""]);
});

void test("An empty batch and an unauthenticated caller are refused.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const attempt = async (fn: () => Promise<unknown>): Promise<string> => {
    try {
      await fn();
      return "ok";
    } catch (e) {
      return e instanceof TRPCError ? e.code : String(e);
    }
  };
  const caller = appRouter.createCaller(trpcContext({ boxRoot: box.root }));
  t.check(await attempt(() => caller.activity.record({ entries: [] })), "BAD_REQUEST");
  const locked = appRouter.createCaller(trpcContext({ boxRoot: box.root, authed: false }));
  t.check(await attempt(() => locked.activity.record({ entries: [{ card: "A.view.card", kind: "scrolled" }] })), "UNAUTHORIZED");
});
