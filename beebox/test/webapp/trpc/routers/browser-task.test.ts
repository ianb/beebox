// # Browser-task procedures
//
// `browserTask.setClosed` is the boxholder's open/closed control on a task card:
// an owner-only, locked read-modify-write of the `closed` field (removed on
// reopen, since absent means open), committed with its own endpoint trailer. The executor never calls it.

import { test } from "tap";
import "agent-doctest/tap";
import { execFileSync } from "node:child_process";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { createBrowserTaskTemplate } from "../../../../src/schemas/browser-task.js";

function caller(boxRoot: string, options?: { isOwner?: boolean }) {
  return appRouter.createCaller(trpcContext({ boxRoot, isOwner: options?.isOwner !== false }));
}

const box = await makeTmpBox({ git: true });
const cardPath = "_content/tasks/Task.browser-task.card";
await box.write(cardPath, createBrowserTaskTemplate({ title: "Scan", start: "https://example.test/feed", prompt: "Find shows.\n" }));
await box.write("_content/notes/Note.doc.card", "---\ntitle: Note\n---\nA doc.\n");
box.commitAll("seed");

// ## Close, then reopen
void test("Close, then reopen", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L28
  const closed = await caller(box.root).browserTask.setClosed({ path: cardPath, closed: true });
  t.check([closed.closed, typeof closed.commit === "string", closed.commitWarning], [
    true,
    true,
    null,
  ]);

  // doctest:L32
  await t.checkText((await box.read(cardPath)).includes("closed: true"), "true");

  // doctest:L35
  await t.checkText(execFileSync("git", ["log", "-1", "--format=%B"], { cwd: box.root }).toString().includes("Endpoint: browserTask.setClosed"), "true");

  // doctest:L38
  const reopened = await caller(box.root).browserTask.setClosed({ path: cardPath, closed: false });
  t.check([reopened.closed, (await box.read(cardPath)).includes("closed")], [
    false,
    false,
  ]);

  // The body and the other fields survive the round trip:

  // doctest:L46
  const after = await box.read(cardPath);
  t.check(
    [after.includes("start:\n  href: https://example.test/feed\n"), after.trim().endsWith("Find shows.")]
    ,
    [
    true,
    true,
  ],
  );

  // ## Listing tasks with their state
  //
  // `browserTask.list` walks `_content` for task cards and derives each one's
  // lifecycle state; the dashboard shows the due and never-scanned ones.

  // doctest:L57
  await box.write("_content/tasks/Weekly.browser-task.card", "---\ntype: browser-task\ntitle: Weekly feed\nstart:\n  href: https://example.test/w\nrescan-after: P7D\nlast-upload: 2020-01-01T00:00:00Z\n---\nScan it.\n");
  box.commitAll("seed weekly");
  const listed = await caller(box.root).browserTask.list();
  t.check(listed.items.map((item) => [item.path, item.title, item.closed, item.state.kind, item.inboxCount, item.runCount]), [
    [
      "_content/tasks/Task.browser-task.card",
      "Scan",
      false,
      "never-scanned",
      0,
      0,
    ],
    [
      "_content/tasks/Weekly.browser-task.card",
      "Weekly feed",
      false,
      "due",
      0,
      0,
    ],
  ]);

  // ## Refusals
  //
  // Not an owner, not a browser-task card, not a card at all:

  // doctest:L69
  t.check(await caller(box.root, { isOwner: false }).browserTask.setClosed({ path: cardPath, closed: true }).then(() => "accepted", (e) => e.code), "FORBIDDEN");

  // doctest:L72
  t.check(await caller(box.root).browserTask.setClosed({ path: "_content/notes/Note.doc.card", closed: true }).then(() => "accepted", (e) => e.code), "BAD_REQUEST");

  // doctest:L75
  t.check(await caller(box.root).browserTask.setClosed({ path: "_content/tasks/Nope.browser-task.card", closed: true }).then(() => "accepted", (e) => e.code), "NOT_FOUND");

  // doctest:L78
  t.check(await caller(box.root).browserTask.setClosed({ path: "../outside.browser-task.card", closed: true }).then(() => "accepted", (e) => e.code), "FORBIDDEN");
});
