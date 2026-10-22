// # The ambient todo line (`core/todo/ambient-summary.ts`)
//
// `computeTodoAmbientLine(boxRoot)` (`docs/implemented-plans/todo-annotation.md` Track 5a)
// is the runtime-computed, only-when-nonzero one-liner injected into chat and
// reactor agent context — never persisted (see the module doc for why a
// MAP.md-style count doesn't work here).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { computeTodoAmbientLine } from "../../../src/core/todo/ambient-summary.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const DOC_FM = "title: Kitchen\ncontains: Notes on the kitchen remodel.\n";

function doc(body: string): string {
  return `---\n${DOC_FM}---\n${body}`;
}

process.env.BBX_TIME = "2026-07-28T12:00:00.000Z";

async function seedBox() {
  const box = await makeTmpBox();
  await box.write("_config/box.json", JSON.stringify({ timezone: "America/Chicago" }));
  return box;
}

// ## Nothing due now: no line at all
//
// A box with no todos, or only quiet/done/dropped/parked ones, gets `null` —
// not an empty string, not a "0 todos" line.
void test("A box with no todos, or only quiet/done/dropped/parked ones, gets null — not...", async (t) => {
  const box = await seedBox();
  await box.write(
    "store/a.doc.card",
    doc(
      '{% todo id="quiet" start="2026-08-05" due="2026-08-10" %}Not yet{% /todo %}\n\n' +
      '{% todo id="done" status="done" %}Already finished{% /todo %}\n'
    )
  );
  t.check(await computeTodoAmbientLine(box.root), null);

  // ## Open todos due now: counts, singular/plural, and the overdue note

  const box2 = await seedBox();
  await box2.write(
    "store/b.doc.card",
    doc('{% todo id="one" %}Solo undated todo{% /todo %}\n')
  );
  t.check(await computeTodoAmbientLine(box2.root), "1 todo now — `bbx query todos`");

  // Escalated (past-due) todos get called out separately, and the count is
  // plural once there's more than one:

  const box3 = await seedBox();
  await box3.write(
    "store/c.doc.card",
    doc(
      '{% todo id="past-due" due="2026-07-01" %}Overdue{% /todo %}\n\n' +
      '{% todo id="on-plate" %}Also on the plate{% /todo %}\n'
    )
  );
  t.check(await computeTodoAmbientLine(box3.root), "2 todos now (1 overdue) — `bbx query todos`");
});
