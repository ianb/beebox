// # `bbx engine todo-review` — the todo-review procedure's check and verify
//
// The stock `todo-review` procedure (`docs/plans/todos-ui.md`, Track 7) runs
// daily. Its precheck is `bbx engine todo-review check`: sweep the box, save
// the items, and print the brief the agent works from, or exit
// `CHECK_SKIP_CODE` (75) so no agent runs. No job card is written, so the
// wakeup reactor has nothing to pick up. Its validate step is
// `bbx engine todo-review verify`: every item must end with a status change
// (the agent's own todos) or a `recheck` date 1 to 90 days out, and on a
// boxholder's todo nothing but `recheck` may change. The third unchanged
// recheck on a todo retires it to `recheck="never"`.
//
// These run the commands the procedure runs, against a tmp box. The agent's
// part is played by editing the card directly.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, containing, not } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { todoReviewCommand } from "../../../src/cli/commands/todo-review.js";
import { findJobCards } from "../../../src/core/reactor/job-discovery.js";
import { createTodoReviewJobTemplate } from "../../../src/schemas/todo-review-job.js";
import { unreviewedTodosCheck } from "../../../src/webapp/trpc/routers/health/checks/todos.js";
import { runHousekeeping } from "../../../src/cli/commands/wakeup/housekeeping.js";
import { installProcedures, installSchedules } from "../../../src/core/box/structure/defaults.js";
import { loadProcedureDefinition } from "../../../src/core/procedure/engine/parse.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const CARD = "store/Porch.doc.card";

function doc(body: string): string {
  return `---\ntitle: Porch\n---\n${body}`;
}

function setTime(iso: string): void {
  process.env.BBX_TIME = iso;
}

class ExitedError extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`exit ${String(code)}`);
    this.name = "ExitedError";
    this.code = code;
  }
}

/** Run `bbx engine todo-review <args>` in `root`; its exit code and stdout lines. */
async function run(root: string, args: string[]): Promise<{ code: number; out: string[] }> {
  const out: string[] = [];
  const log = console.log;
  const exit = process.exit;
  const cwd = process.cwd();
  console.log = (...parts: unknown[]) => { out.push(parts.map(String).join(" ")); };
  process.exit = (code?: number | string | null) => { throw new ExitedError(Number(code ?? 0)); };
  process.chdir(root);
  try {
    await todoReviewCommand.parseAsync(args, { from: "user" });
    return { code: 0, out };
  } catch (e) {
    if (e instanceof ExitedError) return { code: e.code, out };
    throw e;
  } finally {
    console.log = log;
    process.exit = exit;
    process.chdir(cwd);
  }
}

// America/Chicago; 12:00Z is morning of the same calendar day there.
async function seedBox() {
  const box = await makeTmpBox({ git: true });
  await box.write("_config/box.json", JSON.stringify({ timezone: "America/Chicago" }));
  box.commitAll("timezone");
  return box;
}

/** A committed box whose one card holds `todos`, with the clock at `day` noon UTC. */
async function boxWith(todos: string, day: string) {
  const box = await seedBox();
  setTime(`${day}T12:00:00.000Z`);
  await box.write(CARD, doc(`${todos}\n`));
  box.commitAll("porch");
  return box;
}

/** Exit code of `check` (0 handed out a brief, 75 skipped). */
async function checkCode(root: string): Promise<number> {
  return (await run(root, ["check"])).code;
}

/** The todo-review job cards waiting for the reactor, by file name. */
async function pendingJobs(root: string): Promise<string[]> {
  return (await findJobCards(path.join(root, "_bookkeeping/jobs"), { typeFilter: "todo-review" })).map((job) => job.file);
}

/** An edit to the card, committed: the review agent's, or the boxholder's. */
async function edit(root: string, change: { from: string; to: string }): Promise<void> {
  const file = path.join(root, CARD);
  const content = await fs.readFile(file, "utf-8");
  if (!content.includes(change.from)) throw new Error(`card does not contain ${change.from}`);
  await fs.writeFile(file, content.replace(change.from, change.to));
  execSync("git add -A && git commit -q -m edit", { cwd: root, stdio: "pipe" });
}

/** One daily cycle: check hands out the todo, the agent edits it, verify runs. */
async function cycle(root: string, input: { day: string; from: string; to: string }) {
  setTime(`${input.day}T12:00:00.000Z`);
  const checked = await run(root, ["check"]);
  if (checked.code !== 0) throw new Error(`check exited ${String(checked.code)}`);
  await edit(root, input);
  return run(root, ["verify"]);
}

/** Three daily cycles that end with verify retiring the todo `{% todo due="2026-09-01" %}<text>` on CARD. */
async function retire(root: string): Promise<string> {
  await cycle(root, { day: "2026-09-25", from: 'due="2026-09-01" %}', to: 'due="2026-09-01" recheck="2026-09-30" %}' });
  await cycle(root, { day: "2026-09-30", from: 'recheck="2026-09-30"', to: 'recheck="2026-10-10"' });
  return (await cycle(root, { day: "2026-10-10", from: 'recheck="2026-10-10"', to: 'recheck="2026-10-20"' })).out[0] ?? "";
}

async function quietly(fn: () => Promise<void>): Promise<void> {
  const log = console.log;
  console.log = () => {};
  try {
    await fn();
  } finally {
    console.log = log;
  }
}

/** 26 escalated todos (written newest due first), one stirring, one actionable, one stale. */
function manyTodosCard(): string {
  const lines = Array.from({ length: 26 }, (_, i) => {
    const nn = String(26 - i).padStart(2, "0");
    return `{% todo due="2026-08-${nn}" %}Task ${nn}{% /todo %}`;
  });
  lines.push('{% todo start="2026-09-24" due="2026-10-30" %}Book the painter{% /todo %}');
  lines.push('{% todo assigned="agent" %}Review the delivery note{% /todo %}');
  lines.push('{% todo created="2026-06-01" %}Sort the shed{% /todo %}');
  return lines.join("\n\n");
}

/** What the agent does with every item `check` saved: a recheck on each, in one commit. */
async function recheckAllShown(root: string, recheck: string): Promise<void> {
  const state = JSON.parse(await fs.readFile(path.join(root, ".beebox/todo-review-sweep.json"), "utf-8"));
  const file = path.join(root, CARD);
  let content = await fs.readFile(file, "utf-8");
  for (const item of state.review.items) {
    content = content.replace(` %}${item.text}{%`, ` recheck="${recheck}" %}${item.text}{%`);
  }
  await fs.writeFile(file, content);
  execSync("git add -A && git commit -q -m recheck", { cwd: root, stdio: "pipe" });
}

async function rechecks(root: string): Promise<string[]> {
  const state = JSON.parse(await fs.readFile(path.join(root, ".beebox/todo-review-sweep.json"), "utf-8"));
  return Object.keys(state.rechecks);
}

// ## Nothing to review: `check` exits CHECK_SKIP
void test("Nothing to review: `check` exits CHECK_SKIP", async (t) => {
  t.teardown(async () => {
    try {
      await empty.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const empty = await boxWith('{% todo due="2026-12-01" %}Paint the rail{% /todo %}', "2026-09-25");

  t.check(await run(empty.root, ["check"]), {
    code: 75,
    out: [
      "No todos to review",
    ],
  });

  // `verify` with no review saved is an error, not a pass:

  await t.checkThrows(async () => (await run(empty.root, ["verify"])), "TodoReviewNotCheckedError");
});

// ## One escalated todo: `check` prints the brief and writes no job card
//
// The brief is the review instructions (the same text a legacy job card
// carries), today's box-local date, and the items as YAML. It reaches the
// agent as the precheck's output.
void test("The brief is the review instructions (the same text a legacy job card carries...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await boxWith('{% todo due="2026-09-01" %}Order lumber{% /todo %}', "2026-09-25");

  const first = await run(box.root, ["check"]);
  t.check(first.code, 0);

  const brief = first.out.join("\n");
  t.check(brief.split("\n")[0], "# Processing a Todo Review");

  t.check(brief.match(/Today \(box-local\) is [\d-]+\./)?.[0], "Today (box-local) is 2026-09-25.");

  await t.checkText(brief.slice(brief.indexOf("```yaml")), `«codeblock»yaml
escalated:
  - locator: store/Porch.doc.card:4
    text: Order lumber
    detail: due 2026-09-01
    card: Porch
«codeblock»`);

  t.check(await pendingJobs(box.root), []);

  // ## A fresh undated agent todo is on the next precheck

  const fresh = await boxWith('{% todo assigned="agent" %}Review the delivery note{% /todo %}', "2026-09-25");

  const freshBrief = (await run(fresh.root, ["check"])).out.join("\n");
  t.check(freshBrief, any(String).includes("actionable:"));
  t.check(freshBrief, any(String).includes("Review the delivery note"));

  await fresh.cleanup();

  // ## `verify` fails an item left open without a recheck, and passes it once rechecked
  //
  // The validate step names the item and why, and exits 1 (the procedure then
  // re-invokes the agent with this output).

  t.check(await run(box.root, ["verify"]), {
    code: 1,
    out: [
      "1 todo review item(s) are not settled:",
      "- store/Porch.doc.card:4 \"Order lumber\": still open with no recheck date",
    ],
  });

  // A `recheck` more than 90 days out is refused:

  await edit(box.root, { from: '{% todo due="2026-09-01" %}', to: '{% todo due="2026-09-01" recheck="2027-03-01" %}' });
  t.check((await run(box.root, ["verify"])).out[1], "- store/Porch.doc.card:4 \"Order lumber\": recheck 2027-03-01 is 157 days from today (2026-09-25); it must be 1-90 days out");

  // Ten days out, with a reason after the closing tag, settles it:

  await edit(box.root, {
    from: '{% todo due="2026-09-01" recheck="2027-03-01" %}Order lumber{% /todo %}',
    to: '{% todo due="2026-09-01" recheck="2026-10-05" %}Order lumber{% /todo %} — quote due next week',
  });
  t.check(await run(box.root, ["verify"]), {
    code: 0,
    out: [
      "Every todo review item is settled",
    ],
  });

  // ## On a boxholder's todo, only `recheck` may change
  //
  // Marking the boxholder's todo done, moving its date, or rewording it all fail,
  // and say what was changed. (A reworded todo is not found by the words `check`
  // saved.)

  setTime("2026-10-06T12:00:00.000Z");
  t.check(await checkCode(box.root), 0);

  await edit(box.root, { from: '{% todo due="2026-09-01" recheck="2026-10-05" %}', to: '{% todo status="done" due="2026-10-20" recheck="2026-10-10" %}' });
  t.check((await run(box.root, ["verify"])).out[1], "- store/Porch.doc.card:4 \"Order lumber\": the review may change only recheck on the boxholder's todos (changed: status, due)");

  await edit(box.root, { from: '{% todo status="done" due="2026-10-20" recheck="2026-10-10" %}Order lumber', to: '{% todo due="2026-09-01" recheck="2026-10-10" %}Order cedar lumber' });
  t.check((await run(box.root, ["verify"])).out[1], "- store/Porch.doc.card:4 \"Order lumber\": not found on its card as written: the review may not reword the boxholder's todos");

  // Every attribute but `recheck` is frozen, `created` included; the note after
  // the closing tag is free.

  await edit(box.root, { from: '{% todo due="2026-09-01" recheck="2026-10-10" %}Order cedar lumber{% /todo %}', to: '{% todo created="2026-09-02" due="2026-09-01" recheck="2026-10-10" %}Order lumber{% /todo %} — still waiting' });
  t.check((await run(box.root, ["verify"])).out[1], "- store/Porch.doc.card:4 \"Order lumber\": the review may change only recheck on the boxholder's todos (changed: created)");

  await edit(box.root, { from: '{% todo created="2026-09-02" ', to: "{% todo " });
  t.check(await run(box.root, ["verify"]), { code: 0, out: ["Every todo review item is settled"] });
});

// ## The agent's own todo may change status, or be reworded
void test("The agent's own todo may change status, or be reworded", async (t) => {
  t.teardown(async () => {
    try {
      await own.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const own = await boxWith('{% todo assigned="agent" by="agent" created="2026-07-01" due="2026-09-01" %}Tidy the index{% /todo %}', "2026-09-25");
  t.check(await checkCode(own.root), 0);

  await edit(own.root, { from: '{% todo assigned="agent"', to: '{% todo status="done" assigned="agent"' });
  t.check((await run(own.root, ["verify"])).out[0], "Every todo review item is settled");

  await edit(own.root, { from: 'status="done" ', to: "" });
  t.check(await checkCode(own.root), 0);

  await edit(own.root, { from: "Tidy the index", to: "Tidy the index cards" });
  t.check((await run(own.root, ["verify"])).out[0], "Every todo review item is settled");
});

// ## A review that never settles keeps a newly stirring todo
//
// The stirring baseline moves only when `verify` passes. A run whose agent
// left the item unsettled lists the stirring todo again the next day; after a
// passing review it is no longer stirring.
void test("The stirring baseline moves only when verify passes.", async (t) => {
  t.teardown(async () => {
    try {
      await stir.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const stir = await boxWith('{% todo start="2026-09-24" due="2026-10-30" %}Book the painter{% /todo %}', "2026-09-25");
  await run(stir.root, ["check"]);
  t.check(await run(stir.root, ["verify"]), {
    code: 1,
    out: [
      "1 todo review item(s) are not settled:",
      "- store/Porch.doc.card:4 \"Book the painter\": still open with no recheck date",
    ],
  });

  setTime("2026-09-26T12:00:00.000Z");
  t.check((await run(stir.root, ["check"])).out.join("\n"), any(String).includes("stirring:"));

  await edit(stir.root, { from: 'due="2026-10-30" %}', to: 'due="2026-10-30" recheck="2026-09-27" %}' });
  t.check(await run(stir.root, ["verify"]), { code: 0, out: ["Every todo review item is settled"] });

  setTime("2026-09-28T12:00:00.000Z");
  t.check(await checkCode(stir.root), 75);
});

// ## The brief carries at most 25 todos, and the cut ones come back
//
// Escalated first (oldest `due` first), then stirring, actionable, then stale. The brief
// says how many were cut. Here 26 escalated todos fill the cap, so the last
// escalated one, the stirring one, the actionable one, and the stale one wait for a later run.
void test("Escalated first (oldest due first), then stirring, actionable, then stale.", async (t) => {
  t.teardown(async () => {
    try {
      await many.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const many = await boxWith(manyTodosCard(), "2026-09-25");

  const capped = (await run(many.root, ["check"])).out.join("\n");
  t.check(capped, any(String).includes("25 of 29 shown; the rest come in later runs."));

  const saved = JSON.parse(await fs.readFile(path.join(many.root, ".beebox/todo-review-sweep.json"), "utf-8")).review.items.map((i: { text: string }) => i.text);
  t.check(saved, Array.from({ length: 25 }, (_, i) => `Task ${String(i + 1).padStart(2, "0")}`));

  // The agent rechecks all 25 and the review passes. Because a stirring todo
  // was cut, the stirring baseline does not move: the next run still lists the
  // painter as stirring, with the other three cut todos.

  await recheckAllShown(many.root, "2026-10-20");
  t.check((await run(many.root, ["verify"])).out[0], "Every todo review item is settled");

  setTime("2026-09-26T12:00:00.000Z");
  const rest = (await run(many.root, ["check"])).out.join("\n");
  await t.checkText(rest.slice(rest.indexOf("## The items")), `## The items
«blankline»
«codeblock»yaml
escalated:
  - locator: store/Porch.doc.card:4
    text: Task 26
    detail: due 2026-08-26
«*»
stirring:
  - locator: store/Porch.doc.card:56
    text: Book the painter
    detail: started 2026-09-24
«*»
actionable:
  - locator: store/Porch.doc.card:58
    text: Review the delivery note
    detail: agent follow-up
    assigned: agent
«*»
stale:
  - locator: store/Porch.doc.card:60
    text: Sort the shed
    detail: created 2026-06-01
«*»
«codeblock»`);

  // Once those are settled too, the baseline moves and the painter is no longer
  // stirring.

  await recheckAllShown(many.root, "2026-10-20");
  t.check((await run(many.root, ["verify"])).out[0], "Every todo review item is settled");

  setTime("2026-09-27T12:00:00.000Z");
  t.check(await checkCode(many.root), 75);
});

// ## A legacy job card is the reactor's, not the procedure's
//
// A `todo-review` job card queued by the old wakeup hook still validates and
// stays pending for the reactor; `check` neither hands it out nor removes it.
void test("A todo-review job card queued by the old wakeup hook still validates and stay...", async (t) => {
  t.teardown(async () => {
    try {
      await legacy.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const legacy = await seedBox();
  setTime("2026-09-25T12:00:00.000Z");
  await legacy.write(
    "_bookkeeping/jobs/2026-09-20T06-30.todo-review.job.card",
    createTodoReviewJobTemplate({ escalated: [{ locator: "store/Old.doc.card:4", text: "Old item", detail: "due 2026-09-01" }], stirring: [], stale: [] }),
  );
  legacy.commitAll("legacy job");
  t.check(await run(legacy.root, ["check"]), {
    code: 75,
    out: [
      "No todos to review",
    ],
  });

  t.check(await pendingJobs(legacy.root), ["2026-09-20T06-30.todo-review.job.card"]);
});

// ## A retired todo that is edited is back in review; a hand-set `never` holds
//
// `never` written by the review's own verify holds only while the todo is as
// it was retired. The boxholder moving its due date puts it back in the next
// review, where the agent replaces `never` with a date. A `never` the
// boxholder set by hand, with no retirement behind it, is respected.
void test("never written by the review's own verify holds only while the todo is as it w...", async (t) => {
  t.teardown(async () => {
    try {
      await back.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const back = await boxWith('{% todo due="2026-09-01" %}Fix the gate{% /todo %}\n\n{% todo due="2026-09-01" recheck="never" %}Old idea{% /todo %}', "2026-09-25");
  t.check(await retire(back.root), "Stopped reviewing store/Porch.doc.card:4: Fix the gate (third recheck with no change)");

  setTime("2026-11-01T12:00:00.000Z");
  t.check(await checkCode(back.root), 75);

  await edit(back.root, { from: 'due="2026-09-01" recheck="never" %}Fix', to: 'due="2026-10-15" recheck="never" %}Fix' });
  const relisted = (await run(back.root, ["check"])).out.join("\n");
  t.check(relisted, any(String).includes("Fix the gate"));
  t.check(relisted, not(any(String).includes("Old idea")));

  await edit(back.root, { from: 'recheck="never" %}Fix', to: 'recheck="2026-11-15" %}Fix' });
  t.check((await run(back.root, ["verify"])).out[0], "Every todo review item is settled");
});

// ## The agent may not write `never`, even on a todo that was retired before
//
// Retired, then the boxholder removes `never`: the todo is listed again and its
// old retirement no longer counts. An agent that writes `never` back fails
// verify, and the todo is listed again the next day.
void test("Retired, then the boxholder removes never:", async (t) => {
  t.teardown(async () => {
    try {
      await sneaky.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const sneaky = await boxWith('{% todo due="2026-09-01" %}Fix the gate{% /todo %}', "2026-09-25");
  await retire(sneaky.root);
  await edit(sneaky.root, { from: ' recheck="never"', to: "" });
  setTime("2026-11-01T12:00:00.000Z");
  t.check(await checkCode(sneaky.root), 0);

  await edit(sneaky.root, { from: 'due="2026-09-01" %}', to: 'due="2026-09-01" recheck="never" %}' });
  t.check((await run(sneaky.root, ["verify"])).out[1], "- store/Porch.doc.card:4 \"Fix the gate\": recheck=\"never\" is set only by the review itself; give a date 1-90 days out");

  setTime("2026-11-02T12:00:00.000Z");
  t.check((await run(sneaky.root, ["check"])).out.join("\n"), any(String).includes("Fix the gate"));
});

// ## The third unchanged recheck retires the todo, commits, and raises a health warning
//
// Each daily cycle: the recheck date passes, `check` lists the todo again, the
// agent pushes it out again, `verify` counts it. The third time, `verify`
// writes `recheck="never"` itself and commits.
void test("Each daily cycle:", async (t) => {
  t.teardown(async () => {
    try {
      await tired.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const tired = await boxWith('{% todo due="2026-09-01" %}Fix the gate{% /todo %}', "2026-09-25");

  t.check((await cycle(tired.root, { day: "2026-09-25", from: 'due="2026-09-01" %}', to: 'due="2026-09-01" recheck="2026-09-30" %}' })).out[0], "Every todo review item is settled");

  t.check((await cycle(tired.root, { day: "2026-09-30", from: 'recheck="2026-09-30"', to: 'recheck="2026-10-10"' })).out[0], "Every todo review item is settled");

  t.check(await unreviewedTodosCheck(tired.root), {
    name: "todos-unreviewed",
    ok: true,
    message: "every open todo is still reviewed",
    severity: "warning",
  });

  const third = await cycle(tired.root, { day: "2026-10-10", from: 'recheck="2026-10-10"', to: 'recheck="2026-10-20"' });
  t.check(third.out[0], "Stopped reviewing store/Porch.doc.card:4: Fix the gate (third recheck with no change)");

  t.check(await fs.readFile(path.join(tired.root, CARD), "utf-8"), `---
title: Porch
---
{% todo due="2026-09-01" recheck="never" %}Fix the gate{% /todo %}
`);

  t.check(execSync("git log -1 --format=%s", { cwd: tired.root, encoding: "utf-8" }).trim(), "Stop reviewing todo: Fix the gate");

  // The todo is out of the review for good (the next check skips), and the health
  // check names it:

  setTime("2026-11-30T12:00:00.000Z");
  t.check(await checkCode(tired.root), 75);

  t.check(await unreviewedTodosCheck(tired.root), {
    name: "todos-unreviewed",
    ok: false,
    message: "1 open todo is no longer reviewed: store/Porch.doc.card:4 \"Fix the gate\". Remove recheck=\"never\" or edit one to put it back in review.",
    severity: "warning",
  });

  // ## `check` prunes the recheck history of todos that are gone
  //
  // The history is keyed by card path and the todo's words. Once the card is
  // gone, the next check drops its entry.

  t.check(await rechecks(tired.root), ["[\"store/Porch.doc.card\",\"Fix the gate\"]"]);

  await fs.rm(path.join(tired.root, CARD));
  await run(tired.root, ["check"]);
  t.check(await rechecks(tired.root), []);
});

// ## Any change to status, `start`, or `due` restarts the count
//
// Two rechecks, then the boxholder moves the due date between reviews. The
// next recheck is the first of a new count, so the third push in total retires
// nothing. A reworded todo's old entry is pruned from the history.
void test("Two rechecks, then the boxholder moves the due date between reviews.", async (t) => {
  t.teardown(async () => {
    try {
      await tended.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const tended = await boxWith('{% todo due="2026-09-01" %}Call the roofer{% /todo %}', "2026-09-25");

  await cycle(tended.root, { day: "2026-09-25", from: 'due="2026-09-01" %}', to: 'due="2026-09-01" recheck="2026-09-30" %}' });
  await cycle(tended.root, { day: "2026-09-30", from: 'recheck="2026-09-30"', to: 'recheck="2026-10-10"' });
  await edit(tended.root, { from: 'due="2026-09-01"', to: 'due="2026-10-01"' });
  const afterEdit = await cycle(tended.root, { day: "2026-10-10", from: 'recheck="2026-10-10"', to: 'recheck="2026-10-20"' });
  t.check(afterEdit.out[0], "Every todo review item is settled");

  t.check(await fs.readFile(path.join(tended.root, CARD), "utf-8"), `---
title: Porch
---
{% todo due="2026-10-01" recheck="2026-10-20" %}Call the roofer{% /todo %}
`);

  await edit(tended.root, { from: "Call the roofer", to: "Call the roofer again" });
  await run(tended.root, ["check"]);
  t.check(await rechecks(tended.root), []);
});

// ## The health check is quiet with no retired todos, and ignores agent follow-ups
void test("The health check is quiet with no retired todos, and ignores agent follow-ups", async (t) => {
  t.teardown(async () => {
    try {
      await quiet.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const quiet = await seedBox();
  await quiet.write(
    CARD,
    doc(
      '{% todo recheck="2026-10-01" %}Rechecked, still reviewed{% /todo %}\n\n' +
      '{% todo assigned="agent" by="agent" created="2026-09-01" recheck="never" %}Agent follow-up{% /todo %}\n\n' +
      '{% todo status="done" recheck="never" %}Finished{% /todo %}\n'
    )
  );
  t.check(await unreviewedTodosCheck(quiet.root), {
    name: "todos-unreviewed",
    ok: true,
    message: "every open todo is still reviewed",
    severity: "warning",
  });
});

// ## `bbx wakeup` housekeeping no longer runs the sweep
//
// The sweep moved to the procedure. An escalated todo on a box whose wakeup
// runs housekeeping queues no job.
void test("The sweep moved to the procedure.", async (t) => {
  t.teardown(async () => {
    try {
      await woken.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const woken = await boxWith('{% todo due="2026-09-01" %}Order lumber{% /todo %}', "2026-09-25");
  await quietly(() => runHousekeeping(woken.root));
  t.check(await pendingJobs(woken.root), []);
});

// ## Every box gets the procedure and its daily schedule, enabled
//
// An absent `enabled` means enabled. The precheck's output is passed to the
// agent (`pass-output`), which is how the brief reaches it; the validate step
// reads the saved items back from the sweep state.
void test("An absent enabled means enabled.", async (t) => {
  t.teardown(async () => {
    try {
      await fresh.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const fresh = await makeTmpBox({ git: true });
  t.check(await installProcedures(fresh.root), containing(["todo-review.procedure.card"]));

  t.check(await installSchedules(fresh.root), containing(["todo-review.scheduled-script.card"]));

  const sched = await fs.readFile(path.join(fresh.root, "_config/schedules/todo-review.scheduled-script.card"), "utf-8");
  await t.checkText(sched.split("\n").filter((line) => /^(cron|not-before|timeout|enabled|runs):/.test(line)).join("\n"), `cron: 30 6 * * *
not-before: 20h
timeout: 30m
runs: bbx procedure run todo-review`);

  const def = await loadProcedureDefinition(path.join(fresh.root, "_config/procedures/todo-review.procedure.card"));
  t.check(def.steps.map((s) => [s.id, s.precheck?.shells[0]?.split("\n")[0], s.precheck?.passOutput, s.run?.agents.length, s.run?.agents[0]?.maxTurns, s.validate?.phase.shells, s.validate?.severity]), [
    [
      "review",
      "bbx engine todo-review check",
      true,
      1,
      20,
      [
        "bbx engine todo-review verify",
      ],
      "review",
    ],
  ]);

  t.check(def.steps[0]?.run?.agents[0]?.prompt, not(any(String).includes("bbx finish")));
});
