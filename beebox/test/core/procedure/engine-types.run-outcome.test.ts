// # Procedure run outcomes
//
// A run card's `outcome` is written once, when the run finishes, and removed only
// when a resume re-opens the run. `finishRunCard` and `reopenRunCard`
// (`src/core/procedure/engine/run-card.ts`) assert this at the write boundary so
// a caller bug can't persist a corrupt lifecycle. The pure predicates behind
// those assertions live in `engine-types.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canReopenRun, isRunOutcome } from "../../../src/core/procedure/engine-types.js";
import { finishRunCard, reopenRunCard } from "../../../src/core/procedure/engine/run-card.js";

async function attempt(fn: () => Promise<void>): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (e) {
    return e instanceof Error ? e.message.replace(/: \/.*$/, "") : String(e);
  }
}

// ## `isRunOutcome` — is this a known outcome?
void test("`isRunOutcome` — is this a known outcome?", async (t) => {
  // doctest:L29
  t.check(isRunOutcome("completed"), true);

  // doctest:L32
  t.check(isRunOutcome("inconclusive"), true);

  // doctest:L35
  t.check(isRunOutcome("running"), false);
});

// ## Which runs a resume may re-open
//
// A run with no outcome was interrupted mid-execution; re-opening it is
// idempotent. A failed run re-opens. A completed run never does (resume returns
// early), and neither does an inconclusive one: its work is done and resume does
// not re-judge.
void test("A run with no outcome was interrupted mid-execution; re-opening it is idempot...", async (t) => {
  // doctest:L47
  t.check(canReopenRun(undefined), true);

  // doctest:L50
  t.check(canReopenRun("failed"), true);

  // doctest:L53
  t.check(canReopenRun("completed"), false);

  // doctest:L56
  t.check(canReopenRun("inconclusive"), false);
});

// ## The write boundary
//
// A run finishes once. Finishing it again without re-opening it is refused, and
// so is re-opening a completed run. Re-opening a failed run removes its
// outcome, so it can finish again.
void test("A run finishes once.", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L67
  const dir = await mkdtemp(join(tmpdir(), "run-outcome-"));
  const card = join(dir, "run.procedure-run.card");
  await writeFile(card, "---\nprocedure: p.procedure.card\nstarted-at: 2026-09-01T00:00:00.000Z\nsteps: []\n---\n");

  // doctest:L71
  t.check(await attempt(() => finishRunCard({ runCardPath: card, outcome: "failed", completedAt: "2026-09-01T00:05:00.000Z", expires: "never" })), "ok");

  // doctest:L74
  t.check((await readFile(card, "utf-8")).split("\n").slice(0, 3).join(" | "), "--- | procedure: p.procedure.card | outcome: failed");

  // doctest:L77
  t.check(await attempt(() => finishRunCard({ runCardPath: card, outcome: "completed", completedAt: "2026-09-01T00:06:00.000Z", expires: "never" })), "Run already finished (failed), cannot record completed");

  // doctest:L80
  t.check(await attempt(() => reopenRunCard(card)), "ok");

  // doctest:L83
  await t.checkText(await readFile(card, "utf-8"), `---
procedure: p.procedure.card
started-at: 2026-09-01T00:00:00.000Z
steps: []
completed-at: 2026-09-01T00:05:00.000Z
expires: never
---`);

  // doctest:L86
  t.check(await attempt(() => finishRunCard({ runCardPath: card, outcome: "completed", completedAt: "2026-09-01T00:07:00.000Z", expires: "never" })), "ok");

  // doctest:L89
  t.check(await attempt(() => reopenRunCard(card)), "A completed run cannot be re-opened");
});
