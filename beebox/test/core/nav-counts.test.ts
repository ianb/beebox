// # The nav counts run once per box at a time (`core/nav-counts.ts`)
//
// Every open tab asks for the nav counts after each burst of file changes, and
// the plate count walks the whole box. On a box with tens of thousands of
// files, overlapping walks ran the engine out of heap. Requests that arrive
// while a count runs share one follow-up count, which still sees changes made
// after the running count started.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { getNavCounts } from "../../src/core/nav-counts.js";
import { is, not } from "@ianbicking/tap-check/check";
import { makeTmpBox } from "../helpers/test-helpers.js";

const doc = (body: string): string => `---\ntitle: Kitchen\ncontains: Notes on the kitchen remodel.\n---\n${body}`;

process.env.BBX_TIME = "2026-07-28T12:00:00.000Z";
const box = await makeTmpBox();

void test("Requests during a running count share one follow-up count that sees later changes", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  await box.write("_content/notes/One.doc.card", doc("{% todo %}Call the vet back{% /todo %}\n"));

  const first = getNavCounts(box.root);
  await box.write("_content/notes/Two.doc.card", doc("{% todo %}Order the tile{% /todo %}\n"));
  const [firstCounts, secondCounts, thirdCounts] = await Promise.all([first, getNavCounts(box.root), getNavCounts(box.root)]);

  // The second and third requests got the same count; the first got its own.
  t.check(thirdCounts, is(secondCounts));
  t.check(secondCounts, not(is(firstCounts)));
  t.check(secondCounts.onPlateTodos, 2);

  // Once both have settled, the next request starts a fresh count.
  const fourthCounts = await getNavCounts(box.root);
  t.check(fourthCounts, not(is(secondCounts)));
  t.check(fourthCounts.onPlateTodos, 2);
});
