// # `bbx todos` — read/query CLI
//
// `src/cli/commands/todos.ts` is a thin presentation layer over the todo
// collection (`core/todo/query.ts`, the same runner `bbx query todos` and the
// web list use): filters (`--status`, `--assigned`, `--glob`,
// `--on-plate`), a human listing grouped by plate-state, and `--json` for the
// full structured records. `runTodosForBox(boxRoot, options)` is exercised
// directly (same approach as `test/cli/commands/auth.doctest.md`) rather than
// spawning the CLI as a subprocess.

import { test } from "tap";
import "agent-doctest/tap";
import { runTodosForBox } from "../../../src/cli/commands/todos.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

process.env.BBX_TIME = "2026-07-28T12:00:00.000Z";

const box = await makeTmpBox();
await box.write("_config/box.json", JSON.stringify({ timezone: "America/Chicago" }));

async function run(options?: Parameters<typeof runTodosForBox>[1]) {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args) => { logs.push(args.join(" ")); };
  try {
    await runTodosForBox(box.root, options ?? {});
  } finally {
    console.log = origLog;
  }
  return logs.join("\n");
}

function doc(frontmatterExtra: string, body: string) {
  return `---\ntitle: Plate\n${frontmatterExtra}---\n${body}`;
}

await box.write(
  "_content/plate.doc.card",
  doc(
    "",
    [
      '{% todo id="escalated-one" due="2026-07-27" assigned="Dana" %}Overdue vet call{% /todo %}',
      "",
      '{% todo id="on-plate-one" %}Undated, on the plate now{% /todo %}',
      "",
      '{% todo id="quiet-one" due="2026-08-01" start="2026-07-30" %}Not yet{% /todo %}',
      "",
      '{% todo id="parked-one" status="parked" %}Parked{% /todo %}',
      "",
      '{% todo id="done-one" status="done" %}Already handled{% /todo %}',
      "",
    ].join("\n")
  )
);

// ## Default filter is `--status open` (escalated, on-plate, and quiet all show — not just on-plate)
void test("Default filter is `--status open` (escalated, on-plate, and quiet all show — not just on-plate)", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L59
  await t.checkText(await run(), `OVERDUE (1)
  _content/plate.doc.card:4  [escalated-one] Overdue vet call  (assigned=Dana due=2026-07-27)
ON YOUR PLATE (1)
  _content/plate.doc.card:6  [on-plate-one] Undated, on the plate now
LATER (1)
  _content/plate.doc.card:8  [quiet-one] Not yet  (due=2026-08-01 start=2026-07-30)`);

  // ## `--status done`

  // doctest:L72
  await t.checkText(await run({ status: "done" }), `DONE (1)
  _content/plate.doc.card:12  [done-one] Already handled`);

  // ## `--status parked`

  // doctest:L81
  await t.checkText(await run({ status: "parked" }), `PARKED (1)
  _content/plate.doc.card:10  [parked-one] Parked`);

  // ## `--on-plate` narrows the default (open) filter further, excluding quiet

  // doctest:L90
  await t.checkText(await run({ onPlate: true }), `OVERDUE (1)
  _content/plate.doc.card:4  [escalated-one] Overdue vet call  (assigned=Dana due=2026-07-27)
ON YOUR PLATE (1)
  _content/plate.doc.card:6  [on-plate-one] Undated, on the plate now`);

  // ## `--assigned`

  // doctest:L101
  await t.checkText(await run({ assigned: "Dana" }), `OVERDUE (1)
  _content/plate.doc.card:4  [escalated-one] Overdue vet call  (assigned=Dana due=2026-07-27)`);

  // ## No match

  // doctest:L110
  t.check(await run({ assigned: "Nobody" }), "No todos match.");

  // ## A card that fails to load prints a trailing "could not be read" section — never silently dropped

  // doctest:L117
  await box.write(
    "_content/bad.doc.card",
    "---\ntitle: 42\n---\n{% todo %}Never collected{% /todo %}\n"
  );
  await t.checkText(await run({ status: "parked" }), `PARKED (1)
  _content/plate.doc.card:10  [parked-one] Parked
«blankline»
1 cards could not be read for todos:
  [load] _content/bad.doc.card: _content/bad.doc.card: invalid doc frontmatter:
  - title: expected string, got number`);

  // ## `--json` carries the full structured records, plus `issues` alongside

  // doctest:L134
  const jsonOut = await run({ status: "parked", json: true });
  const parsed: { todos: Array<{ id: string }>; issues: Array<{ kind: string }> } = JSON.parse(jsonOut);
  t.check(parsed.todos.map((todo) => todo.id).join(", "), "parked-one");

  // doctest:L139
  t.check(parsed.issues.map((i) => i.kind).join(", "), "load");

  // ## An invalid `--status` value is a clean error, not a crash

  // doctest:L146
  async function runCaptured(options: Parameters<typeof runTodosForBox>[1]) {
    const errors: string[] = [];
    const origError = console.error;
    const origExit = process.exit;
    let exitCode: number | undefined;
    console.error = (...args) => { errors.push(args.join(" ")); };
    process.exit = (code?: number | string | null) => {
      exitCode = Number(code ?? 0);
      throw new Error("__doctest_process_exit__");
    };
    try {
      await runTodosForBox(box.root, options);
    } catch (e) {
      if (!(e instanceof Error) || e.message !== "__doctest_process_exit__") throw e;
    } finally {
      console.error = origError;
      process.exit = origExit;
    }
    return { errors, exitCode };
  }

  // doctest:L167
  const badStatus = await runCaptured({ status: "wontfix" });
  t.check(badStatus.errors.join("\n"), "Error: --status must be one of open, done, dropped, parked (got \"wontfix\")");

  // doctest:L171
  t.check(badStatus.exitCode, 1);
});
