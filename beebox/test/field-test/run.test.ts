// # Field-test activity loop
//
// `runFieldScenario` is the whole run: box, server, operator session, and then the
// per-item loop of pre-actions → brief → activity → debrief → quiescence → checks
// → cleanup (`docs/implemented-plans/agent-field-tests.md`, Track 2).
//
// The operator here is the fake chat backend — a fully scripted persona, no SDK
// and no cost — but the box and the server are REAL, for the same reason the
// lifecycle test uses a real one: the failures this loop exists to catch (a
// checkpoint that doesn't rewind, a server that keeps serving reset state, a
// debrief asked of a dead session) are invisible against a mocked box.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, str } from "@ianbicking/tap-check/check";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";
import { createFakeChatBackend, type FakeChatBackend, type ChatBackend } from "../../src/services/claude-chat/core.js";
import { MODEL_ID } from "../../src/shared/model-ids.js";
import { loadBoxModel } from "../../src/core/box/config.js";
import { runFieldScenario } from "../../src/field-test/run/core.js";
import { createFieldBox } from "../../src/field-test/run-box.js";
import { loadFieldScenario } from "../../src/field-test/scenario.js";
import { seedFieldBox, scenarioNeedsGmail } from "../../src/field-test/run/seed.js";
import { waitForQuiescence, type QuiescenceProbe } from "../../src/field-test/quiescence.js";
import { fileExists } from "../../src/lib/file-exists.js";

/** A probe that reports whatever the test tells it to, whenever it is asked. */
function scriptedProbe(name: string, readings: { busy: boolean; detail: string | null }[]): QuiescenceProbe {
  let i = 0;
  return {
    name,
    read: async () => readings[Math.min(i++, readings.length - 1)]!,
  };
}

/**
 * Answer the operator session automatically, one scripted reply per message the
 * harness sends. `onSend` gets each outgoing message first, so a test can make
 * the world change during an activity the way a real operator would.
 */
function driveOperator(
  backend: FakeChatBackend,
  opts: { onSend?: (text: string) => Promise<void>; errorOn?: (text: string) => boolean },
): { stop: () => void } {
  const state = { stopped: false, answered: 0 };
  const pump = async (): Promise<void> => {
    while (!state.stopped) {
      const run = backend.lastRun();
      while (run !== null && run.sent.length > state.answered) {
        const blocks = run.sent[state.answered]!;
        const text = blocks.map((b) => (b.type === "text" ? b.text : "")).join("");
        state.answered += 1;
        await opts.onSend?.(text);
        if (opts.errorOn?.(text)) {
          run.emitResult({ isError: true });
        } else if (text.includes("smooth, friction, or blocked")) {
          run.emitResult({ result: "smooth\n\nIt did what I expected." });
        } else if (text.startsWith("# Activity")) {
          run.emitResult({ result: "Worked through it. See 01-start.png." });
        } else {
          run.emitResult({ result: "Answering from what I saw." });
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  void pump().catch((e: unknown) => console.error("driveOperator failed", e));
  return { stop: () => { state.stopped = true; } };
}

/** Write a two-or-three item scenario into a temp directory. */
async function writeScenario(dir: string, checklist: string): Promise<string> {
  await mkdir(join(dir, "checks"), { recursive: true });
  await writeFile(
    join(dir, "scenario.yaml"),
    `name: loop-fixture\ndescription: A scripted loop fixture.\nstartTime: "2026-08-10T09:00:00Z"\nchecklist:\n${checklist}`,
  );
  await writeFile(join(dir, "persona.md"), "You are a scripted operator.\n");
  await writeFile(join(dir, "checks", "passes.sh"), "#!/bin/sh\necho looked around\nexit 0\n");
  await writeFile(join(dir, "checks", "fails.sh"), "#!/bin/sh\necho 'no such card' >&2\nexit 3\n");
  // The loader checks that a named email fixture EXISTS; its shape is the
  // fixture loader's business, so this one gets through load and fails at
  // injection — the cheapest way to exercise a failed `pre` action.
  await mkdir(join(dir, "emails"), { recursive: true });
  await writeFile(join(dir, "emails", "broken.yaml"), "from: nobody\n");
  return dir;
}

const GIT_SHA = any(String).matches(/^[\da-f]{40}$/);
const QUIET = { quiescent: true, waitedMs: any(Number).positive(), stuck: [] };

function answered(id: string, answer: string) {
  return { id, question: any(String), answer, reAsked: false };
}

/** The standard questionnaire, answered by the scripted operator, plus any extra question ids. */
function smoothDebrief(extraIds: string[]) {
  const standard = ["accomplished", "first-attempt", "hesitations", "surprises", "missing", "wording", "rendering", "screenshots"];
  return {
    answers: [
      ...[...standard, ...extraIds].map((id) => answered(id, "Answering from what I saw.")),
      answered("outcome", "smooth\n\nIt did what I expected."),
    ],
    outcome: "smooth",
    outcomeReason: null,
    unanswered: [],
    screenshotRefs: [],
    missingScreenshots: [],
  } as const;
}

function cleanedUp(c: { policy: "keep" | "reset"; tag: string; resetTo: string | null }) {
  return { policy: c.policy, tag: c.tag, head: GIT_SHA, resetTo: c.resetTo, serverRestarted: c.resetTo !== null, error: null };
}

/** The whole result of the four-item loop run in `tmp`. */
function expectedLoopResult(tmp: string) {
  const completed = { status: "completed", turns: 0, note: "Worked through it. See 01-start.png.", error: null } as const;
  const diedMessage = 'activity ended with status "error" (SDK result error_during_execution)';
  return {
    scenario: "loop-fixture",
    scenarioDir: join(tmp, "scenario"),
    runDir: join(tmp, "runs", "run"),
    startedAt: isoDate(),
    finishedAt: isoDate(),
    boxTimeStart: "2026-08-10T09:00:00Z",
    boxTimeEnd: "2026-08-10T09:00:00Z",
    models: { operator: "opus", chat: MODEL_ID.opus },
    serverBaseUrl: str`http://127.0.0.1:${any(String)}/box`,
    browseSession: "field-run",
    items: [
      {
        id: "first",
        brief: "Look around and tell me what this is.",
        screenshotsDir: "screenshots/first",
        pre: [],
        activity: completed,
        debrief: smoothDebrief(["extra-1"]),
        debriefSkipped: null,
        quiescence: QUIET,
        checks: [
          { script: "passes.sh", passed: true, exitCode: 0, stdout: "looked around", stderr: "" },
          { script: "fails.sh", passed: false, exitCode: 3, stdout: "", stderr: "no such card" },
        ],
        cleanup: cleanedUp({ policy: "keep", tag: "field-run/01-first", resetTo: null }),
        events: [],
      },
      {
        id: "busted",
        brief: "This one dies mid-activity.",
        screenshotsDir: "screenshots/busted",
        pre: [],
        activity: { status: "error", turns: 0, note: "", error: "SDK result error_during_execution" },
        debrief: null,
        debriefSkipped: diedMessage,
        quiescence: QUIET,
        checks: [],
        cleanup: cleanedUp({ policy: "keep", tag: "field-run/02-busted", resetTo: null }),
        events: [diedMessage],
      },
      {
        id: "messy",
        brief: "Make a mess (leave-junk).",
        screenshotsDir: "screenshots/messy",
        pre: [],
        activity: completed,
        debrief: smoothDebrief([]),
        debriefSkipped: null,
        quiescence: QUIET,
        checks: [],
        cleanup: cleanedUp({ policy: "reset", tag: "field-run/03-messy", resetTo: "field-run/02-busted" }),
        events: ["box reset to field-run/02-busted; server restarted"],
      },
      {
        id: "broken-setup",
        brief: "This one never reaches the operator.",
        screenshotsDir: "screenshots/broken-setup",
        pre: [
          {
            type: "inject-email",
            detail: "broken",
            ok: false,
            error: `Email fixture ${join(tmp, "scenario", "emails", "broken.yaml")}: does not match the format — to: Invalid input: expected string, received undefined; subject: Invalid input: expected string, received undefined; body: Invalid input: expected string, received undefined`,
          },
        ],
        activity: { status: "harness-skipped", turns: 0, note: "", error: "setup failed: inject-email broken" },
        debrief: null,
        debriefSkipped: "setup failed: inject-email broken",
        quiescence: QUIET,
        checks: [],
        cleanup: cleanedUp({ policy: "keep", tag: "field-run/04-broken-setup", resetTo: null }),
        events: ["setup failed: inject-email broken"],
      },
    ],
    aborted: null,
    events: [],
  } as const;
}

// ## Quiescence is composite, and names what stayed busy
//
// Everything must read idle twice, `settleMs` apart — a single all-idle reading
// can land in the gap between two stages of one reactor cycle.
void test("Everything must read idle twice, settleMs apart — a single all-idle reading c...", async (t) => {
  const outcome = await waitForQuiescence({
    probes: [scriptedProbe("chat", [{ busy: false, detail: null }]), scriptedProbe("jobs", [{ busy: false, detail: null }])],
    timeoutMs: 5_000,
    pollMs: 10,
    settleMs: 10,
  });
  t.check(outcome, { quiescent: true, waitedMs: any(Number).positive(), stuck: [] });
});

// A component that never goes idle times out — and the report says which one, and
// why. A timeout that only said "not quiescent" would make every run's triage
// start from scratch.
void test("A component that never goes idle times out — and the report says which one, a...", async (t) => {
  const stuck = await waitForQuiescence({
    probes: [
      scriptedProbe("chat", [{ busy: false, detail: null }]),
      scriptedProbe("jobs", [{ busy: true, detail: "1 pending job card: intake.job.card" }]),
    ],
    timeoutMs: 300,
    pollMs: 10,
    settleMs: 10,
  });
  t.check(stuck, {
    quiescent: false,
    waitedMs: any(Number).positive(),
    stuck: [{ name: "jobs", detail: "1 pending job card: intake.job.card" }],
  });
});

// ## Setup is arranged, never operated
//
// A scenario that involves email starts with the connector already configured, as
// if the boxholder had connected their mail last month — field tests exercise
// operating order, never setup. The box's chat model is pinned at the same moment,
// and deliberately as gitignored runtime state, so a `reset` cannot rewind the
// run onto a different model than it started with.
void test("A scenario that involves email starts with the connector already configured,...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(seedTmp, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const seedTmp = await mkdtemp(join(tmpdir(), "bbx-field-seed-"));
  const seedScenarioDir = join(seedTmp, "scenario");
  await mkdir(join(seedScenarioDir, "emails"), { recursive: true });
  await writeFile(join(seedScenarioDir, "persona.md"), "A scripted operator.\n");
  await writeFile(
    join(seedScenarioDir, "emails", "hello.yaml"),
    "from: A Clinic <c@example.com>\nto: b@example.com\nsubject: Hi\nbody: |\n  Hello.\n",
  );
  await writeFile(
    join(seedScenarioDir, "scenario.yaml"),
    [
      "name: seed-fixture",
      "description: One item whose pre action injects mail.",
      'startTime: "2026-08-10T09:00:00Z"',
      "models:",
      "  chat: sonnet",
      "checklist:",
      "  - id: mail",
      "    brief: See what arrived.",
      "    pre:",
      "      - inject-email: hello",
      "",
    ].join("\n"),
  );

  const seedScenario = await loadFieldScenario(seedScenarioDir);
  t.check(scenarioNeedsGmail(seedScenario), true);

  const seedBox = await createFieldBox(join(seedTmp, "run"));
  await seedFieldBox({ box: seedBox, scenario: seedScenario });

  t.check(await fileExists(join(seedBox.boxRoot, "_config/connectors/gmail.json")), true);

  t.check(await loadBoxModel(seedBox.boxRoot), MODEL_ID.sonnet);

  // The connector config and the pinned model (_config/box.json) are both part of the committed baseline.
  const seedStatus = await execa("git", ["status", "--porcelain"], { cwd: seedBox.boxRoot });
  t.check(seedStatus.stdout, "");

  // A scenario with no mail in it gets no connector at all — the box is as bare as a
  // new boxholder's.

  t.check(scenarioNeedsGmail({ ...seedScenario, checklist: [{ ...seedScenario.checklist[0]!, pre: [] }] }), false);
});

// ## A real run: four items, four shapes
//
// One run covers the cases worth a real server: a normal item with a passing and a
// failing check, an activity whose session errors (no debrief), an item whose
// `reset` cleanup rewinds the box and restarts the server, and an item whose `pre`
// action fails before the operator is ever asked.
void test("One run covers the cases worth a real server:", async (t) => {
  t.teardown(async () => {
    try {
      await rm(tmp, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const tmp = await mkdtemp(join(tmpdir(), "bbx-field-loop-"));
  const scenarioDir = await writeScenario(join(tmp, "scenario"), [
    "  - id: first",
    "    cleanup: keep",
    "    brief: Look around and tell me what this is.",
    "    checks: [passes.sh, fails.sh]",
    "    questions: [Anything else?]",
    "  - id: busted",
    "    cleanup: keep",
    "    brief: This one dies mid-activity.",
    "  - id: messy",
    "    cleanup: reset",
    "    brief: Make a mess (leave-junk).",
    "  - id: broken-setup",
    "    cleanup: keep",
    "    brief: This one never reaches the operator.",
    "    checks: [passes.sh]",
    "    pre:",
    "      - inject-email: broken",
    "",
  ].join("\n"));

  const runsRoot = join(tmp, "runs");
  const boxRoot = join(runsRoot, "run", "box");
  const backend = createFakeChatBackend();
  // The scripted operator leaves untracked residue during the third activity —
  // which is exactly what `reset` exists to undo.
  const driver = driveOperator(backend, {
    onSend: async (text) => {
      if (!text.includes("leave-junk")) return;
      await writeFile(join(boxRoot, "junk-residue.txt"), "left behind by a messy attempt\n");
    },
    errorOn: (text) => text.includes("This one dies mid-activity"),
  });

  const result = await runFieldScenario({
    scenarioDir,
    runsRoot,
    runDirName: "run",
    backend,
    browseCommand: "/bin/echo",
    browseKey: "test-browse-key",
    quiescence: { timeoutMs: 30_000, pollMs: 200, settleMs: 200 },
    operator: { activityTimeoutMs: 60_000, timeoutPollMs: 100 },
    onEvent: () => {},
  });
  driver.stop();

  // Every item's quiescence reads quiet, which means the chat probe reached the run
  // server's `chat.statusAll` with the run's diagnostic key (an unreachable or
  // unauthorized probe reports busy forever and would time out here) — and, for the
  // item after the reset, that the probe reached the RESTARTED server.
  t.check(result, expectedLoopResult(tmp));

  // An activity that ended in `error` gets NO debrief: nine questions into a dead
  // session collect the same error nine times, at a real Opus turn each.
  t.check(await fileExists(join(result.runDir, "questionnaires", "busted.md")), false);

  // The activity note is still written — a failed activity is still evidence.
  t.check(await fileExists(join(result.runDir, "activities", "busted.md")), true);

  // `reset` rewinds the box to the previous checkpoint and restarts the server, so
  // nothing is left serving state that no longer exists.

  // The residue the messy attempt left is gone.
  t.check(await fileExists(join(boxRoot, "junk-residue.txt")), false);

  // Every item leaves a checkpoint tag whatever its policy — that is what makes
  // `reset` and post-hoc inspection cheap.

  const tags = await execa("git", ["tag", "--list"], { cwd: join(runsRoot, "run", "box") });
  t.check(tags.stdout.split("\n").toSorted(), [
    "field-run/01-first",
    "field-run/02-busted",
    "field-run/03-messy",
    "field-run/04-broken-setup",
    "field-run/baseline",
  ]);

  // The raw result is on disk for the report writer, written after every item so a
  // run that dies part-way still leaves the completed items behind.

  t.check(JSON.parse(await readFile(join(result.runDir, "results.json"), "utf-8")), result);

  // The run also writes `report.md` in the same `finally`, so a triage read never
  // needs to regenerate one by hand — `bbx field-test report <run-dir>` exists for
  // the rare case a run directory moves or the writer's format changes later.

  const reportMd = await readFile(join(result.runDir, "report.md"), "utf-8");
  // The report is large generated markdown (its full text is pinned in report.test.ts), so
  // these two checks keep to its title and the first item's table row.
  t.check(reportMd, any(String).startsWith("# Field test report: loop-fixture"));
  t.check(reportMd, any(String).includes("| first | completed | smooth |"));
});

// ## A setup failure after the server starts still tears down and reports
//
// The box and server exist before the operator session opens, so a failure
// starting the operator is a teardown gap, not a "run never existed" case. It must
// still stop the server, close the browse session, and leave a `results.json` +
// `report.md` recording the abort — otherwise a run that broke while booting the
// persona leaves a live server and no evidence.
void test("The box and server exist before the operator session opens, so a failure star...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(bootTmp, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const bootTmp = await mkdtemp(join(tmpdir(), "bbx-field-boot-"));
  const bootScenarioDir = await writeScenario(join(bootTmp, "scenario"), [
    "  - id: never-runs",
    "    cleanup: keep",
    "    brief: The operator never boots, so this item is never reached.",
    "",
  ].join("\n"));

  // A backend whose start() throws is exactly the operator-session boot failure
  // this guards: it happens after prepareRun has a real box and server live.
  const throwingBackend: ChatBackend = {
    start: () => {
      throw new Error("operator boot failed");
    },
  };

  const bootResult = await runFieldScenario({
    scenarioDir: bootScenarioDir,
    runsRoot: join(bootTmp, "runs"),
    runDirName: "run",
    backend: throwingBackend,
    browseCommand: "/bin/echo",
    browseKey: "test-browse-key",
    onEvent: () => {},
  });

  // No item ran; the abort is recorded with a null item id (the report renders
  // that as "(setup)"), and the run resolved rather than threw.
  t.check(bootResult, {
    scenario: "loop-fixture",
    scenarioDir: bootScenarioDir,
    runDir: join(bootTmp, "runs", "run"),
    startedAt: isoDate(),
    finishedAt: isoDate(),
    boxTimeStart: "2026-08-10T09:00:00Z",
    boxTimeEnd: "2026-08-10T09:00:00Z",
    models: { operator: "opus", chat: MODEL_ID.opus },
    serverBaseUrl: str`http://127.0.0.1:${any(String)}/box`,
    browseSession: "field-run",
    items: [],
    aborted: { itemId: null, reason: "operator boot failed" },
    events: [],
  });

  // Both artifacts are on disk — the teardown `finally` ran even though nothing
  // after the operator boot did.

  t.check(JSON.parse(await readFile(join(bootResult.runDir, "results.json"), "utf-8")), bootResult);
  t.check(await fileExists(join(bootResult.runDir, "report.md")), true);

  const bootReport = await readFile(join(bootResult.runDir, "report.md"), "utf-8");
  t.check(bootReport, any(String).includes("Aborted** at item `(setup)`: operator boot failed"));
});
