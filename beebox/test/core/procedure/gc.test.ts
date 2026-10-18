// # Procedure Run GC
//
// `bbx procedure gc` deletes run directories whose `expires` stamp has passed,
// and — as a backstop against a runaway procedure — caps each procedure at
// `MAX_RUNS_PER_PROCEDURE` retained dirs regardless of expiry. The policy lives
// on each run card; the sweeper is dumb. Always kept: the newest run per
// procedure (`bbx procedure status` reads it), runs pinned with `expires: never`,
// and anything still running.

import { test } from "tap";
import "agent-doctest/tap";
import { gcProcedureRuns } from "../../../src/core/procedure/gc.js";
import { MAX_RUNS_PER_PROCEDURE } from "../../../src/core/procedure/run-expiry.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { getLog } from "../../../src/lib/git/core/operations.js";
import { utimes } from "node:fs/promises";

// Builds a frontmatter run card from the legacy `key="value"` attr string
// the test cases use — values are JSON-quoted so ISO timestamps stay strings.
function runCard(attrs: string): string {
  const lines: string[] = [];
  for (const m of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) {
    lines.push(`${m[1]}: ${JSON.stringify(m[2])}`);
  }
  return `---\n${lines.join("\n")}\nsteps:\n  - id: s\n    status: completed\n---\n`;
}

// ## Expired runs are deleted; newest, pinned, and unexpired survive
void test("Expired runs are deleted; newest, pinned, and unexpired survive", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L31
  const box = await makeTmpBox({ git: true });

  // doctest:L33
  // alpha: two expired runs — keep-newest saves the second despite expiry
  await box.write("_bookkeeping/procedure/runs/alpha_2025-01-01T0000/run.procedure-run.card",
    runCard('procedure="p" outcome="completed" started-at="2025-01-01T00:00:00Z" completed-at="2025-01-01T00:01:00Z" expires="2025-02-01T00:00:00Z"'));
  await box.write("_bookkeeping/procedure/runs/alpha_2025-02-01T0000/run.procedure-run.card",
    runCard('procedure="p" outcome="completed" started-at="2025-02-01T00:00:00Z" completed-at="2025-02-01T00:01:00Z" expires="2025-03-01T00:00:00Z"'));

  // doctest:L39
  // beta: old run pinned with expires="never", plus a newer one
  await box.write("_bookkeeping/procedure/runs/beta_2025-01-01T0000/run.procedure-run.card",
    runCard('procedure="p" outcome="completed" started-at="2025-01-01T00:00:00Z" completed-at="2025-01-01T00:01:00Z" expires="never"'));
  await box.write("_bookkeeping/procedure/runs/beta_2026-06-01T0000/run.procedure-run.card",
    runCard('procedure="p" outcome="completed" started-at="2026-06-01T00:00:00Z" completed-at="2026-06-01T00:01:00Z" expires="2099-01-01T00:00:00Z"'));

  // doctest:L45
  // gamma: legacy cards without expires — completed-at + 30d default applies
  await box.write("_bookkeeping/procedure/runs/gamma_2025-01-01T0000/run.procedure-run.card",
    runCard('procedure="p" outcome="completed" started-at="2025-01-01T00:00:00Z" completed-at="2025-01-01T00:01:00Z"'));
  await box.write("_bookkeeping/procedure/runs/gamma_2099-01-01T0000/run.procedure-run.card",
    runCard('procedure="p" outcome="completed" started-at="2099-01-01T00:00:00Z" completed-at="2099-01-01T00:01:00Z"'));

  // doctest:L51
  box.commitAll("Seed run history");

  // doctest:L53
  const output: string[] = [];
  const ctx = { boxRoot: box.root, writeLine: (s: string) => output.push(s), write: () => {} };
  const result = await gcProcedureRuns(ctx);
  if (!result.ok) throw new Error(result.error.message);

  // doctest:L60
  const left = await box.list("_bookkeeping/procedure/runs");
  const dirs = left.split("\n").filter(f => !f.endsWith(".card") && !f.endsWith(".gitkeep")).map(f => f.replace("_bookkeeping/procedure/runs/", ""));

  // doctest:L64
  // The deletions were committed in one sweep
  const log = await getLog(box.root, 1);
  t.check(
    { removed: result.value.removed.toSorted(), kept: dirs, commit: log[0]?.subject },
    {
      removed: ["alpha_2025-01-01T0000", "gamma_2025-01-01T0000"],
      kept: ["alpha_2025-02-01T0000", "beta_2025-01-01T0000", "beta_2026-06-01T0000", "gamma_2099-01-01T0000"],
      commit: "GC procedure runs: removed 2 expired run dir(s)",
    },
  );
});

// ## The per-procedure cap evicts oldest runs beyond the ceiling
//
// Even when every run is unexpired, a procedure keeps at most
// `MAX_RUNS_PER_PROCEDURE` dirs — the newest are retained and the oldest
// overflow is reclaimed. This bounds a procedure that fails (or completes)
// every tick before the 90d/30d age clock ever kicks in.
void test("Even when every run is unexpired, a procedure keeps at most MAXRUNSPERPROCEDU...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L86
  const box = await makeTmpBox({ git: true });

  // doctest:L88
  // Seed cap+3 unexpired runs for one procedure. Dir names end in a sortable
  // timestamp; only the ceiling (not expiry) can prune these.
  const total = MAX_RUNS_PER_PROCEDURE + 3;
  const stampOf = (i: number) => `2025-01-01T${String(i).padStart(4, "0")}`;
  for (let i = 0; i < total; i++) {
    const stamp = stampOf(i);
    await box.write(`_bookkeeping/procedure/runs/loop_${stamp}/run.procedure-run.card`,
      runCard("procedure=\"loop\" outcome=\"completed\" started-at=\"2025-01-01T00:00:00Z\" completed-at=\"2025-01-01T00:01:00Z\" expires=\"2099-01-01T00:00:00Z\""));
  }
  box.commitAll("Seed a runaway procedure");

  // doctest:L98
  const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
  const result = await gcProcedureRuns(ctx);
  if (!result.ok) throw new Error(result.error.message);

  // doctest:L102
  const left = await box.list("_bookkeeping/procedure/runs");
  const kept = left.split("\n").filter(f => f.includes("loop_") && !f.endsWith(".card")).map(f => f.replace("_bookkeeping/procedure/runs/", ""));
  // The three oldest go; the newest MAX_RUNS_PER_PROCEDURE stay.
  t.check({ removed: result.value.removed.toSorted(), kept: kept.toSorted() }, {
    removed: [0, 1, 2].map((i) => `loop_${stampOf(i)}`),
    kept: Array.from({ length: MAX_RUNS_PER_PROCEDURE }, (_, i) => `loop_${stampOf(i + 3)}`),
  });
});

// ## Crashed runs expire on the failed-run clock
//
// A run card with no outcome (the engine crashed or was killed)
// has no completed-at. Once its card mtime is stale — a fresh mtime means
// it may genuinely be running — it expires at started-at plus the failed-run
// default, since crash debris is failure-like.
void test("A run card with no outcome (the engine crashed or was killed) has no complete...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L125
  const box = await makeTmpBox({ git: true });

  // doctest:L127
  await box.write("_bookkeeping/procedure/runs/crash_2025-01-01T0000/run.procedure-run.card",
    runCard('procedure="p" started-at="2025-01-01T00:00:00Z"'));
  await box.write("_bookkeeping/procedure/runs/crash_2099-01-01T0000/run.procedure-run.card",
    runCard('procedure="p" outcome="completed" started-at="2099-01-01T00:00:00Z" completed-at="2099-01-01T00:01:00Z" expires="never"'));

  // doctest:L132
  // Age the crashed card's mtime past the running-detection staleness window
  const stale = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(box.path("_bookkeeping/procedure/runs/crash_2025-01-01T0000/run.procedure-run.card"), stale, stale);
  box.commitAll("Seed crashed run");

  // doctest:L137
  const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
  const result = await gcProcedureRuns(ctx);
  if (!result.ok) throw new Error(result.error.message);
  t.check(result.value.removed, ["crash_2025-01-01T0000"]);
});

// ## A fresh running card is never collected
//
// The same stuck-running card with a fresh mtime is treated as live work
// and left alone, even though its started-at is ancient.
void test("The same stuck-running card with a fresh mtime is treated as live work and le...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L155
  const box = await makeTmpBox({ git: true });

  // doctest:L157
  await box.write("_bookkeeping/procedure/runs/live_2025-01-01T0000/run.procedure-run.card",
    runCard('procedure="p" started-at="2025-01-01T00:00:00Z"'));
  await box.write("_bookkeeping/procedure/runs/live_2099-01-01T0000/run.procedure-run.card",
    runCard('procedure="p" outcome="completed" started-at="2099-01-01T00:00:00Z" completed-at="2099-01-01T00:01:00Z" expires="never"'));
  box.commitAll("Seed live run");

  // doctest:L163
  const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
  const result = await gcProcedureRuns(ctx);
  if (!result.ok) throw new Error(result.error.message);
  t.check(result.value.removed, []);
});

// ## Empty and missing runs dirs are fine
void test("Empty and missing runs dirs are fine", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L178
  const box = await makeTmpBox({ git: true });
  const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
  const result = await gcProcedureRuns(ctx);
  if (!result.ok) throw new Error(result.error.message);
  t.check(result.value.removed, []);
});
