// # Schedule memory: the cursor, the carry, and the defer file
//
// A scheduled `runs:` command sees its own previous run through five
// environment variables (`src/core/schedule/memory.ts`): `BBX_SINCE_COMMIT` (the
// box HEAD at the previous run), `BBX_SINCE_TIME`, `BBX_CARRY_IN`, and two temp
// paths, `BBX_CARRY_OUT` and `BBX_DEFER_FILE`. A sixth, `BBX_SCHEDULE_NAME`,
// names the schedule. The cursor and the carry live in
// the schedule's machine-local state. See docs/implemented-plans/notifications.md (Track D).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, capture, isoDate } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import { execSync } from "node:child_process";
import { runTick } from "../../../src/cli/commands/tick.js";
import { loadScriptState } from "../../../src/core/schedule/state.js";
import { cursorAdvances } from "../../../src/core/schedule/memory.js";
import { runShell } from "../../../src/core/procedure/shell.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import type { TmpBox } from "../../helpers/test-helpers.js";

process.env.BBX_ENGINE_AVAILABILITY_FILE = "/nonexistent/engine-availability.json";

const head = (box: TmpBox) => execSync("git rev-parse HEAD", { cwd: box.root }).toString().trim();

/** Force one run of `watch`, capturing the tick's warnings. */
async function tick(box: TmpBox) {
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  try {
    const result = await runTick(box.root, { quiet: true, script: "watch", force: true });
    return { status: result.scripts[0]?.status, warnings };
  } finally {
    console.warn = origWarn;
  }
}

// The script records what it saw: the cursor as a commit subject, the time,
// the carry, the cards added since the cursor, and the defer path. It writes
// the carry named in the box's `_tmp/next-carry`, when there is one, and fails
// when `_tmp/fail` exists.
const WATCH = `---
cron: "0 0 1 1 *"
runs: >-
  mkdir -p _tmp &&
  { echo "since: $(git log -1 --format=%s "$BBX_SINCE_COMMIT")";
    echo "time: \${BBX_SINCE_TIME:-(none)}";
    echo "carry: \${BBX_CARRY_IN:-(none)}";
    echo "added: [$(git diff --name-only --diff-filter=A "$BBX_SINCE_COMMIT" HEAD | paste -sd, -)]";
  } > _tmp/seen.txt &&
  echo "$BBX_DEFER_FILE" > _tmp/defer-path.txt &&
  echo "$BBX_SCHEDULE_NAME" > _tmp/schedule-name.txt &&
  { [ ! -f _tmp/next-carry ] || cp _tmp/next-carry "$BBX_CARRY_OUT"; } &&
  [ ! -f _tmp/fail ]
---
`;

// ## The first run sees nothing; later runs see what came since
//
// Before the first run the cursor is set to HEAD and saved, so the first run
// sees no changes: a schedule is about the future. The carry it writes is read
// back on the next run.
void test("Before the first run the cursor is set to HEAD and saved, so the first run se...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L66
  const box = await makeTmpBox({ git: true });
  await box.write("_content/notes/old.doc.card", "---\ntitle: Old\n---\n");
  await box.write("_config/schedules/watch.scheduled-script.card", WATCH);
  box.commitAll("setup");
  await box.write("_tmp/next-carry", "told them about old");

  // doctest:L72
  t.check(await tick(box), { status: "ran", warnings: [] });

  // doctest:L75
  await t.checkText(await box.read("_tmp/seen.txt"), `since: setup
time: (none)
carry: (none)
added: []`);

  // `BBX_SCHEDULE_NAME` is the card's stem, so a `bbx notify` in the pipeline
  // names the schedule as its source (`schedule:watch`).

  t.check(await box.read("_tmp/schedule-name.txt"), "watch\n");

  // The run succeeded, so the cursor moved to HEAD, and the carry is in state:

  // doctest:L93
  const first = await loadScriptState(box.root, "watch");
  const firstRun = capture(isoDate());
  const duration = any(Number).between(0, Infinity);
  t.check(first, {
    lastRun: firstRun,
    lastResult: "success",
    lastError: null,
    lastDurationMs: duration,
    lastSuccess: firstRun,
    consecutiveFailures: 0,
    alertedAt: null,
    alertedFor: null,
    skipped: null,
    runCount: 1,
    lastCommit: head(box),
    carry: "told them about old",
    lastDeferReason: null,
    recentRuns: [{ ts: firstRun, durationMs: duration }],
  });

  // A card arrives. The second run sees it, the first run's time, and the carry.
  // It writes no carry file, so the carry is kept.

  // doctest:L103
  await fs.rm(box.path("_tmp/next-carry"));
  await box.write("_content/notes/new.doc.card", "---\ntitle: New\n---\n");
  box.commitAll("add new");
  t.check(await tick(box), { status: "ran", warnings: [] });

  // doctest:L109
  await t.checkText((await box.read("_tmp/seen.txt")).replace(firstRun.value, "<first run>"), `since: setup
time: <first run>
carry: told them about old
added: [_content/notes/new.doc.card]`);

  // doctest:L115
  t.check(await loadScriptState(box.root, "watch"), {
    lastRun: isoDate(),
    lastResult: "success",
    lastError: null,
    lastDurationMs: duration,
    lastSuccess: isoDate(),
    consecutiveFailures: 0,
    alertedAt: null,
    alertedFor: null,
    skipped: null,
    runCount: 2,
    lastCommit: head(box),
    carry: "told them about old",
    lastDeferReason: null,
    recentRuns: [
      { ts: firstRun, durationMs: duration },
      { ts: isoDate(), durationMs: duration },
    ],
  });

  // The defer file is a fresh path each run, gone after it:

  // doctest:L122
  const deferPath = (await box.read("_tmp/defer-path.txt")).trim();
  t.check(await fs.access(deferPath).then(() => "present", () => "gone"), "gone");

  // ## A failed run holds the cursor
  //
  // A failure keeps `lastCommit`, so the next run sees the same cards again and
  // nothing is dropped.

  // doctest:L133
  const beforeFailure = (await loadScriptState(box.root, "watch")).lastCommit;
  await box.write("_content/notes/third.doc.card", "---\ntitle: Third\n---\n");
  box.commitAll("add third");
  await box.write("_tmp/fail", "");
  t.check(await tick(box), { status: "error", warnings: [] });

  // doctest:L140
  const failed = await loadScriptState(box.root, "watch");
  t.check(failed, {
    lastRun: isoDate(),
    lastResult: "failure",
    lastError: "Command failed with exit code 1",
    lastDurationMs: duration,
    lastSuccess: isoDate(),
    consecutiveFailures: 1,
    alertedAt: null,
    alertedFor: null,
    skipped: null,
    runCount: 3,
    lastCommit: beforeFailure,
    carry: "told them about old",
    lastDeferReason: null,
    recentRuns: [
      { ts: firstRun, durationMs: duration },
      { ts: isoDate(), durationMs: duration },
      { ts: isoDate(), durationMs: duration },
    ],
  });

  // doctest:L144
  await fs.rm(box.path("_tmp/fail"));
  t.check(await tick(box), { status: "ran", warnings: [] });

  // doctest:L148
  await t.checkText(await box.read("_tmp/seen.txt"), `since: add new
time: «date»
carry: told them about old
added: [_content/notes/third.doc.card]`);

  // ## A carry over 4 KB is truncated, with a warning

  // doctest:L155
  await box.write("_tmp/next-carry", "x".repeat(5000));
  const big = await tick(box);
  t.check(big.warnings, [
    "  watch: carry of 5000 bytes truncated to 4096",
  ]);

  // doctest:L162
  t.check((await loadScriptState(box.root, "watch")).carry, "x".repeat(4096));
});

// ## When the cursor advances
//
// `success` advances, and so does a deferral whose items were seen (`no-change`,
// `no-pass`). A failure, an inconclusive run, and a deferral for budget, an
// unavailable judge, or missing configuration hold it. The tick records the
// reason from an exit-75 marker (`test/cli/commands/tick.defer.doctest.md`); a
// `deferred` with no reason (an engine outage) holds it too.
void test("success advances, and so does a deferral whose items were seen (no-change, no...", async (t) => {
  // doctest:L179
  t.check(
    [
      cursorAdvances("success", null),
      cursorAdvances("deferred", "no-change"),
      cursorAdvances("deferred", "no-pass"),
      cursorAdvances("deferred", "budget"),
      cursorAdvances("deferred", "jev-unavailable"),
      cursorAdvances("deferred", null),
      cursorAdvances("failure", "no-change"),
      cursorAdvances("inconclusive", null),
    ],
    [true, true, true, false, false, false, false, false],
  );
});

// ## A procedure's shells see the variables
//
// `bbx procedure run` inside a schedule inherits the tick's environment, and its
// shell steps rebuild their environment through the script-env allowlist
// (`src/core/procedure/shell.ts`), which lists the seven names.
void test("bbx procedure run inside a schedule inherits the tick's environment, and its...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L199
  const box = await makeTmpBox();
  const names = ["BBX_SINCE_COMMIT", "BBX_SINCE_TIME", "BBX_CARRY_IN", "BBX_CARRY_OUT", "BBX_DEFER_FILE", "BBX_SCHEDULE_NAME", "BBX_SUMMARY_FILE"];
  for (const name of names) process.env[name] = `value-of-${name}`;
  const shell = await runShell(box.root, names.map((n) => `echo "$${n}"`).join("\n"));
  for (const name of names) delete process.env[name];
  await t.checkText(shell.stdout, `value-of-BBX_SINCE_COMMIT
value-of-BBX_SINCE_TIME
value-of-BBX_CARRY_IN
value-of-BBX_CARRY_OUT
value-of-BBX_DEFER_FILE
value-of-BBX_SCHEDULE_NAME
value-of-BBX_SUMMARY_FILE`);
});
