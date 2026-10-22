// # `status.status` — `counts.onPlateTodos`
//
// `docs/implemented-plans/todo-annotation.md` Track 4's header-badge count: open todos that
// are `escalated` or `on-plate` NOW, box-wide — added to the same `status.status`
// payload the pending-questions count already lives on (`AppNav`'s `PlateBadge`
// reads it the same way `QuestionsBadge` reads `pendingQuestions`). `quiet`
// todos (not yet started) and terminal statuses (`done`/`dropped`/`parked`)
// don't count.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { statusRouter } from "../../../../src/webapp/trpc/routers/status.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import type { TmpBox } from "../../../helpers/test-helpers.js";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";

function contextFor(box: TmpBox) {
  const ctx: TrpcContext = trpcContext({ boxRoot: box.root, boxSlug: "t", isAuthenticatedOwner: true });
  return statusRouter.createCaller(ctx);
}


function doc(body: string) {
  return `---\ntitle: Notes\n---\n${body}`;
}

process.env.BBX_TIME = "2026-07-28T12:00:00.000Z";

// ## Escalated + on-plate count; quiet and done are excluded
void test("Escalated + on-plate count; quiet and done are excluded", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.write(
    "_content/a.doc.card",
    doc(
      '{% todo due="2026-07-01" %}Overdue thing{% /todo %}\n\n' +      // escalated
      "{% todo %}Undated thing{% /todo %}\n\n" +                       // on-plate
      '{% todo start="2026-09-01" %}Not yet{% /todo %}\n\n' +          // quiet
      '{% todo status="done" %}Already finished{% /todo %}\n'         // done
    )
  );
  box.commitAll("seed");

  const { counts } = await contextFor(box).status();
  t.check(counts.onPlateTodos, 2);

  // ## Zero when there are none

  await box.write("_content/a.doc.card", doc("No todos here.\n"));
  box.commitAll("clear");

  const after = await contextFor(box).status();
  t.check(after.counts.onPlateTodos, 0);
});
