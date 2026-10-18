// # Field-test operator session
//
// The operator is one persistent conversation for a whole run — the persona that
// receives every checklist item and answers every debrief
// (`docs/implemented-plans/agent-field-tests.md`, Track 3). It is built on the `ChatBackend`
// service, so the fake backend gives a fully scripted operator here: no SDK, no
// subprocess, no cost.

import { test } from "tap";
import "agent-doctest/tap";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFakeChatBackend, type FakeChatBackendRun } from "../../../src/services/claude-chat/core.js";
import { startOperatorSession } from "../../../src/field-test/run/operator.js";
import {
  assembleOperatorPrompt,
  operatorPromptLayers,
} from "../../../src/field-test/run/operator-prompt.js";
import {
  STANDARD_QUESTIONS,
  debriefQuestions,
  parseOutcome,
  verifyScreenshotRefs,
} from "../../../src/field-test/questionnaire.js";

const promptParams = {
  persona: "You are Marisol Vance. Two kids, a full week, and no patience for settings screens.",
  browseCommand: "/checkout/bin/browse",
  browseSession: "field-20260808",
  appBaseUrl: "http://127.0.0.1:41234/box",
  screenshotsDir: "/runs/demo/screenshots",
  assetsDir: "/runs/demo/assets",
};

/**
 * Answer the questions the session is asking, one scripted result each. The
 * first question is already in flight by the time this is called (the session
 * sends it synchronously), so each later reply waits for its own question to
 * be sent before answering.
 */
async function replyEach(run: FakeChatBackendRun, replies: string[]): Promise<void> {
  const sentBefore = run.sent.length;
  for (const [i, reply] of replies.entries()) {
    const deadline = Date.now() + 5000;
    while (run.sent.length < sentBefore + i) {
      if (Date.now() > deadline) {
        throw new Error(`expected ${sentBefore + i} sends, saw ${run.sent.length}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    run.emitResult({ result: reply });
  }
}

// ## The prompt is four separable layers
//
// Each layer has a different owner — the persona is scenario content, the
// mechanics are run-specific, the mandate and boundaries are the tier's own
// invariants — so they are assembled, not hardcoded together.
void test("Each layer has a different owner — the persona is scenario content, the mecha...", async (t) => {
  // doctest:L63
  const layers = operatorPromptLayers(promptParams);

  // doctest:L65
  await t.checkText(
    // Persona goes in verbatim.
    layers.persona.includes("Marisol Vance") && layers.persona.includes("no patience for settings"),
    "true",
  );

  // doctest:L69
  t.check(
    // Mechanics are parameterized by this run's browse invocation and directories.
    [
      layers.mechanics.includes("/checkout/bin/browse --session field-20260808"),
      layers.mechanics.includes("http://127.0.0.1:41234/box"),
      layers.mechanics.includes("/runs/demo/screenshots"),
      layers.mechanics.includes("/runs/demo/assets"),
    ].join(","),
    "true,true,true,true",
  );

  // doctest:L78
  t.check(
    // The boundary layer is what keeps a developer-brained model out of the repo.
    [
      layers.boundaries.includes("ONLY what you see through the browser"),
      layers.boundaries.includes("Never read the app's"),
      layers.boundaries.includes("No CLI other than the browse"),
    ].join(","),
    "true,true,true",
  );

  // Assembly order is persona → mandate → mechanics → boundaries, so the hard
  // boundaries sit nearest the first activity message.

  // doctest:L91
  const prompt = assembleOperatorPrompt(promptParams);
  t.check(
    [
      prompt.indexOf("Marisol") < prompt.indexOf("USABLE"),
      prompt.indexOf("USABLE") < prompt.indexOf("--session"),
      prompt.indexOf("--session") < prompt.indexOf("Hard boundaries"),
    ].join(","),
    "true,true,true",
  );
});

// ## An activity, then its debrief, on one session
//
// The session pins the scenario's operator model and hands the SDK the tool set
// the operator gets at all. That narrows the surface — no editing, no fetching —
// but "browser only" itself stays instruction-level in v1 (the boundaries prompt
// layer), since `Bash` is how the operator drives the browser in the first place.
void test("The session pins the scenario's operator model and hands the SDK the tool set...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(screenshotsDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L108
  const screenshotsDir = await mkdtemp(join(tmpdir(), "bbx-field-shots-"));
  await writeFile(join(screenshotsDir, "home-empty.png"), "");

  // doctest:L111
  const backend = createFakeChatBackend();
  const session = startOperatorSession({
    backend,
    systemPrompt: assembleOperatorPrompt({ ...promptParams, screenshotsDir }),
    cwd: "/runs/demo",
    model: "opus",
    tools: ["Bash", "Read"],
    env: { BBX_BROWSE_API_KEY: "k" },
    screenshotsDir,
  });
  const run = backend.lastRun();
  if (run === null) throw new Error("no run");

  // doctest:L124
  t.check([run.startOptions.model, run.startOptions.tools?.join("+"), run.startOptions.cwd].join(" | "), "opus | Bash+Read | /runs/demo");

  // The operator works the activity across several turns and ends with a free-text
  // note in its own words. The note is the SDK result text; the assistant turns
  // along the way are counted, not summarized.

  // doctest:L133
  const activity = session.sendActivity("Save the recipe photo somewhere you can find it later.");
  run.emitAssistantText("Opening the app.");
  run.emitAssistantText("Taking a screenshot: home-empty.png");
  run.emitResult({ result: "I got it saved eventually, but I had to guess which button to use." });
  const turn = await activity;
  t.check([turn.status, String(turn.turns), turn.note].join(" | "), "completed | 2 | I got it saved eventually, but I had to guess which button to use.");

  // The debrief comes *after* the work, never before — the questions must not prime
  // the behaviour they ask about. Each question is asked on its own turn, so a
  // skipped one is identifiable; answers are stored verbatim.

  // doctest:L147
  const questions = debriefQuestions(["Did the recipe look right when you found it again?"]);
  await t.checkText(questions.length, "10");

  // doctest:L151
  const debriefRun = session.runDebrief(questions);
  await replyEach(run, [
    "Yes — the recipe card showed up in the list.",
    "I tried the big + button first because it was the only obvious control.",
    "I hesitated at the 'capture' label; I wasn't sure it meant photos.",
    "Nothing broke, but nothing confirmed the save either.",
    "I expected a 'saved' toast.",
    "'Capture' — I didn't know if that meant camera or upload.",
    "The tag chips overlapped the title a little — see home-empty.png; might be nothing.",
    "home-empty.png shows the empty state; recipe-saved.png shows it afterwards.",
    "It looked right, yes.",
    "Friction — it worked, but I guessed twice.",
  ]);
  const debrief = await debriefRun;
  t.check([debrief.outcome, String(debrief.unanswered.length), debrief.answers[5]?.answer].join(" | "), "friction | 0 | 'Capture' — I didn't know if that meant camera or upload.");

  // Cited screenshots are checked against the run's screenshots directory. A
  // citation that does not resolve is recorded as a finding, not thrown — an
  // operator citing evidence that does not exist is exactly the signal the report
  // needs to show.

  // doctest:L175
  t.check(debrief.screenshotRefs.map((r) => `${r.filename}:${String(r.resolved)}`).join(", "), "home-empty.png:true, recipe-saved.png:false");

  // doctest:L178
  t.check(debrief.missingScreenshots.join(", "), "recipe-saved.png");

  // A question left blank is re-asked exactly once, then recorded.

  // doctest:L185
  const second = session.runDebrief(STANDARD_QUESTIONS.slice(0, 1));
  await replyEach(run, ["   ", "Sorry — yes, I did finish it."]);
  const secondResult = await second;
  t.check([secondResult.answers[0]?.reAsked, secondResult.answers[0]?.answer].join(" | "), "true | Sorry — yes, I did finish it.");

  // An unparseable outcome answer never throws — it becomes `unresolved` with a
  // reason, so the eight good answers beside it survive into the report.

  // doctest:L196
  const third = session.runDebrief(STANDARD_QUESTIONS.slice(8));
  await replyEach(run, ["Honestly it was somewhere between fine and awful."]);
  const thirdResult = await third;
  t.check([thirdResult.outcome, thirdResult.outcomeReason].join(" | "), "unresolved | answer named none of smooth/friction/blocked");

  // doctest:L202
  await session.stop();
  await t.checkThrows(async () => (await session.sendActivity("anything")), "OperatorSessionClosedError");
});

// ## Limits are enforced by the wrapper, not the SDK
//
// The SDK's `maxTurns` is per query, and this session is one query for the whole
// run — so a per-activity cap has to be counted here. Exceeding it ends the
// activity with a partial note rather than letting one stuck item eat the run.
void test("The SDK's maxTurns is per query, and this session is one query for the whole...", async (t) => {
  // doctest:L218
  const backend = createFakeChatBackend();
  const session = startOperatorSession({
    backend,
    systemPrompt: "test",
    cwd: "/runs/demo",
    model: "opus",
    tools: ["Bash", "Read"],
    env: {},
    screenshotsDir: "/runs/demo/screenshots",
    maxTurnsPerActivity: 2,
  });
  const run = backend.lastRun();
  if (run === null) throw new Error("no run");
  t.check(run.startOptions.model, "opus");

  // The capped activity settles on the interrupt's own `result`, not the moment the
  // cap is hit: everything still in the stream belongs to the activity we gave up
  // on, and the next activity must not be handed its predecessor's tail.

  // doctest:L240
  const capped = session.sendActivity("Find the dentist reminder.");
  run.emitAssistantText("Snapshotting.");
  run.emitAssistantText("Clicking around.");
  run.emitAssistantText("Still clicking around.");
  run.emitAssistantText("(this one arrives after the interrupt)");
  run.emitResult({ result: "(interrupted)" });
  const turn = await capped;
  t.check([turn.status, String(turn.turns), turn.error].join(" | "), "turn-capped | 3 | activity exceeded its 2-turn cap");

  // doctest:L250
  await t.checkText(
    // The note is what the operator managed before the cap — the trailing
    // interrupt result is not the operator talking.
    JSON.stringify(turn.note),
    "\"Snapshotting.\\n\\nClicking around.\\n\\nStill clicking around.\"",
  );

  // doctest:L255
  const next = session.sendActivity("Never mind — check what needs your attention.");
  run.emitResult({ result: "Nothing seemed urgent." });
  const nextTurn = await next;
  t.check([nextTurn.status, String(nextTurn.turns), nextTurn.note].join(" | "), "completed | 0 | Nothing seemed urgent.");

  // doctest:L261
  await session.stop();
});

// An interrupt that never produces a result would leave the stream ambiguous
// forever, so the drain has its own time limit and the session is abandoned rather
// than reused — loudly, and only after the capped turn has been reported.
void test("An interrupt that never produces a result would leave the stream ambiguous fo...", async (t) => {
  // doctest:L269
  const backend = createFakeChatBackend();
  const session = startOperatorSession({
    backend,
    systemPrompt: "test",
    cwd: "/runs/demo",
    model: "opus",
    tools: ["Bash"],
    env: {},
    screenshotsDir: "/runs/demo/screenshots",
    maxTurnsPerActivity: 1,
    drainGraceMs: 120,
    timeoutPollMs: 20,
  });
  const run = backend.lastRun();
  if (run === null) throw new Error("no run");

  // doctest:L285
  const stuck = session.sendActivity("Do the thing.");
  run.emitAssistantText("Trying.");
  run.emitAssistantText("Still trying.");
  const turn = await stuck;
  t.check([turn.status, turn.error].join(" | "), "turn-capped | activity exceeded its 1-turn cap; the interrupted turn never produced a result");

  // doctest:L292
  await t.checkThrows(async () => (await session.sendActivity("Next item")), "OperatorSessionClosedError");

  // doctest:L295
  await session.stop();
});

// An activity that goes quiet ends on the awake-time budget — awake time, not a
// raw `setTimeout`, which on macOS counts sleep and would fire the moment a
// laptop wakes.
void test("An activity that goes quiet ends on the awake-time budget — awake time, not a...", async (t) => {
  // doctest:L303
  const backend = createFakeChatBackend();
  const session = startOperatorSession({
    backend,
    systemPrompt: "test",
    cwd: "/runs/demo",
    model: "opus",
    tools: ["Bash"],
    env: {},
    screenshotsDir: "/runs/demo/screenshots",
    activityTimeoutMs: 120,
    drainGraceMs: 120,
    timeoutPollMs: 20,
  });
  const turn = await session.sendActivity("Do something that never finishes.");
  t.check(turn.status, "timed-out");

  // doctest:L320
  await session.stop();
});

// ## Outcome parsing is tolerant but never guesses
void test("Outcome parsing is tolerant but never guesses", async (t) => {
  // doctest:L326
  t.check(
    [
      parseOutcome("Blocked.").outcome,
      parseOutcome("smooth — I found it immediately").outcome,
      parseOutcome("Honestly, there was quite a bit of friction here.").outcome,
      parseOutcome("").outcome,
      parseOutcome("It was not smooth; call it friction.").outcome,
      parseOutcome("I was never blocked at any point.").outcome,
      parseOutcome("It wasn't blocked exactly.").outcome,
    ].join(", "),
    "blocked, smooth, friction, unresolved, unresolved, unresolved, unresolved",
  );

  // A negated mention is the case worth being strict about: "I was never blocked"
  // must never be reported as `blocked`. The ambiguous cases say why, because "we
  // couldn't tell" belongs in the report:

  // doctest:L343
  t.check(parseOutcome("It was not smooth; call it friction.").reason, "answer named several of smooth/friction/blocked (smooth, friction) and did not lead with one");

  // doctest:L346
  t.check(parseOutcome("I was never blocked at any point.").reason, "answer did not lead with an outcome word and its single mention may be negated");
});

// ## Screenshot references resolve by basename
//
// The operator may cite a bare filename or the path it wrote; both name the same
// file in the run's screenshots directory.
void test("The operator may cite a bare filename or the path it wrote; both name the sam...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L356
  const dir = await mkdtemp(join(tmpdir(), "bbx-field-refs-"));
  await writeFile(join(dir, "step-2.png"), "");

  // doctest:L359
  const refs = await verifyScreenshotRefs(
    ["See /runs/demo/screenshots/step-2.png and step-3.jpg for the error."],
    dir,
  );
  t.check(refs.map((r) => `${r.filename}:${String(r.resolved)}`).join(", "), "step-2.png:true, step-3.jpg:false");
});
