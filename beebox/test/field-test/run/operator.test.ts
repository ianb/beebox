// # Field-test operator session
//
// The operator is one persistent conversation for a whole run — the persona that
// receives every checklist item and answers every debrief
// (`docs/implemented-plans/agent-field-tests.md`, Track 3). It is built on the `ChatBackend`
// service, so the fake backend gives a fully scripted operator here: no SDK, no
// subprocess, no cost.

import { test } from "tap";
import "agent-doctest/tap";
import { any, str } from "agent-doctest/check";
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
  const layers = operatorPromptLayers(promptParams);

  // Persona goes in verbatim.
  t.check(layers.persona, any(String).includes(promptParams.persona));

  // Mechanics are parameterized by this run's browse invocation and directories.
  // (Generated multi-page text, so each check keeps to the parameter it must carry.)
  t.check(layers.mechanics, any(String).includes("/checkout/bin/browse --session field-20260808"));
  t.check(layers.mechanics, any(String).includes("http://127.0.0.1:41234/box"));
  t.check(layers.mechanics, any(String).includes("/runs/demo/screenshots"));
  t.check(layers.mechanics, any(String).includes("/runs/demo/assets"));

  // The boundary layer is what keeps a developer-brained model out of the repo.
  t.checkText(layers.boundaries, `# Hard boundaries
«blankline»
The app is ONLY what you see through the browser. Never read the app's
source code, documentation, or files on disk. No CLI other than the browse
command above. Your Read tool is only for your screenshots and your own
asset files.`);

  // Assembly order is persona → mandate → mechanics → boundaries, so the hard
  // boundaries sit nearest the first activity message.
  t.check(assembleOperatorPrompt(promptParams), [layers.persona, layers.mandate, layers.mechanics, layers.boundaries].join("\n\n"));
  t.check(layers.persona, any(String).includes("Marisol"));
  t.check(layers.mandate, any(String).includes("USABLE"));
  t.check(layers.mechanics, any(String).includes("--session"));
  t.check(layers.boundaries, any(String).startsWith("# Hard boundaries"));
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
  const screenshotsDir = await mkdtemp(join(tmpdir(), "bbx-field-shots-"));
  await writeFile(join(screenshotsDir, "home-empty.png"), "");

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

  t.check(run.startOptions, {
    cwd: "/runs/demo",
    systemPrompt: assembleOperatorPrompt({ ...promptParams, screenshotsDir }),
    model: "opus",
    tools: ["Bash", "Read"],
    env: { BBX_BROWSE_API_KEY: "k" },
  });

  // The operator works the activity across several turns and ends with a free-text
  // note in its own words. The note is the SDK result text; the assistant turns
  // along the way are counted, not summarized.

  const activity = session.sendActivity("Save the recipe photo somewhere you can find it later.");
  run.emitAssistantText("Opening the app.");
  run.emitAssistantText("Taking a screenshot: home-empty.png");
  run.emitResult({ result: "I got it saved eventually, but I had to guess which button to use." });
  const turn = await activity;
  t.check(turn, {
    note: "I got it saved eventually, but I had to guess which button to use.",
    turns: 2,
    status: "completed",
    error: null,
  });

  // The debrief comes *after* the work, never before — the questions must not prime
  // the behaviour they ask about. Each question is asked on its own turn, so a
  // skipped one is identifiable; answers are stored verbatim.

  const questions = debriefQuestions(["Did the recipe look right when you found it again?"]);
  t.check(questions, [
    ...STANDARD_QUESTIONS.slice(0, 8),
    { id: "extra-1", kind: "free", text: "Did the recipe look right when you found it again?" },
    ...STANDARD_QUESTIONS.slice(8),
  ]);

  const debriefRun = session.runDebrief(questions);
  const replies = [
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
  ];
  await replyEach(run, replies);
  const debrief = await debriefRun;
  t.check(debrief, {
    answers: questions.map((q, i) => ({ id: q.id, question: q.text, answer: replies[i]!, reAsked: false })),
    outcome: "friction",
    outcomeReason: null,
    unanswered: [],
    screenshotRefs: [
      { filename: "home-empty.png", resolved: true },
      { filename: "recipe-saved.png", resolved: false },
    ],
    missingScreenshots: ["recipe-saved.png"],
  });

  // Cited screenshots are checked against the run's screenshots directory. A
  // citation that does not resolve is recorded as a finding, not thrown — an
  // operator citing evidence that does not exist is exactly the signal the report
  // needs to show.

  // A question left blank is re-asked exactly once, then recorded.

  const second = session.runDebrief(STANDARD_QUESTIONS.slice(0, 1));
  await replyEach(run, ["   ", "Sorry — yes, I did finish it."]);
  const secondResult = await second;
  t.check(secondResult, {
    answers: [{ id: "accomplished", question: STANDARD_QUESTIONS[0]!.text, answer: "Sorry — yes, I did finish it.", reAsked: true }],
    outcome: "unresolved",
    outcomeReason: "the outcome question was not asked",
    unanswered: [],
    screenshotRefs: [],
    missingScreenshots: [],
  });

  // An unparseable outcome answer never throws — it becomes `unresolved` with a
  // reason, so the eight good answers beside it survive into the report.

  const third = session.runDebrief(STANDARD_QUESTIONS.slice(8));
  await replyEach(run, ["Honestly it was somewhere between fine and awful."]);
  const thirdResult = await third;
  t.check(thirdResult, {
    answers: [{ id: "outcome", question: STANDARD_QUESTIONS[8]!.text, answer: "Honestly it was somewhere between fine and awful.", reAsked: false }],
    outcome: "unresolved",
    outcomeReason: "answer named none of smooth/friction/blocked",
    unanswered: [],
    screenshotRefs: [],
    missingScreenshots: [],
  });

  await session.stop();
  await t.checkThrows(async () => (await session.sendActivity("anything")), "OperatorSessionClosedError");
});

// ## Limits are enforced by the wrapper, not the SDK
//
// The SDK's `maxTurns` is per query, and this session is one query for the whole
// run — so a per-activity cap has to be counted here. Exceeding it ends the
// activity with a partial note rather than letting one stuck item eat the run.
void test("The SDK's maxTurns is per query, and this session is one query for the whole...", async (t) => {
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

  const capped = session.sendActivity("Find the dentist reminder.");
  run.emitAssistantText("Snapshotting.");
  run.emitAssistantText("Clicking around.");
  run.emitAssistantText("Still clicking around.");
  run.emitAssistantText("(this one arrives after the interrupt)");
  run.emitResult({ result: "(interrupted)" });
  const turn = await capped;
  t.check(turn, {
    note: "Snapshotting.\n\nClicking around.\n\nStill clicking around.",
    turns: 3,
    status: "turn-capped",
    error: "activity exceeded its 2-turn cap",
  });

  // The note is what the operator managed before the cap — the trailing
  // interrupt result is not the operator talking.

  const next = session.sendActivity("Never mind — check what needs your attention.");
  run.emitResult({ result: "Nothing seemed urgent." });
  const nextTurn = await next;
  t.check(nextTurn, { note: "Nothing seemed urgent.", turns: 0, status: "completed", error: null });

  await session.stop();
});

// An interrupt that never produces a result would leave the stream ambiguous
// forever, so the drain has its own time limit and the session is abandoned rather
// than reused — loudly, and only after the capped turn has been reported.
void test("An interrupt that never produces a result would leave the stream ambiguous fo...", async (t) => {
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

  const stuck = session.sendActivity("Do the thing.");
  run.emitAssistantText("Trying.");
  run.emitAssistantText("Still trying.");
  const turn = await stuck;
  t.check(turn, {
    note: "Trying.\n\nStill trying.",
    turns: 2,
    status: "turn-capped",
    error: "activity exceeded its 1-turn cap; the interrupted turn never produced a result",
  });

  await t.checkThrows(async () => (await session.sendActivity("Next item")), "OperatorSessionClosedError");

  await session.stop();
});

// An activity that goes quiet ends on the awake-time budget — awake time, not a
// raw `setTimeout`, which on macOS counts sleep and would fire the moment a
// laptop wakes.
void test("An activity that goes quiet ends on the awake-time budget — awake time, not a...", async (t) => {
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
  t.check(turn, {
    note: "",
    turns: 0,
    status: "timed-out",
    error: str`no completion after ${any(String)}ms of awake time; the interrupted turn never produced a result`,
  });

  await session.stop();
});

// ## Outcome parsing is tolerant but never guesses
void test("Outcome parsing is tolerant but never guesses", async (t) => {
  // A negated mention is the case worth being strict about: "I was never blocked"
  // must never be reported as `blocked`. The ambiguous cases say why, because "we
  // couldn't tell" belongs in the report.
  t.check(parseOutcome("Blocked."), { outcome: "blocked", reason: null });
  t.check(parseOutcome("smooth — I found it immediately"), { outcome: "smooth", reason: null });
  t.check(parseOutcome("Honestly, there was quite a bit of friction here."), { outcome: "friction", reason: null });
  t.check(parseOutcome(""), { outcome: "unresolved", reason: "answer was empty" });
  t.check(parseOutcome("It was not smooth; call it friction."), { outcome: "unresolved", reason: "answer named several of smooth/friction/blocked (smooth, friction) and did not lead with one" });
  t.check(parseOutcome("I was never blocked at any point."), { outcome: "unresolved", reason: "answer did not lead with an outcome word and its single mention may be negated" });
  t.check(parseOutcome("It wasn't blocked exactly."), { outcome: "unresolved", reason: "answer did not lead with an outcome word and its single mention may be negated" });
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
  const dir = await mkdtemp(join(tmpdir(), "bbx-field-refs-"));
  await writeFile(join(dir, "step-2.png"), "");

  const refs = await verifyScreenshotRefs(
    ["See /runs/demo/screenshots/step-2.png and step-3.jpg for the error."],
    dir,
  );
  t.check(refs, [
    { filename: "step-2.png", resolved: true },
    { filename: "step-3.jpg", resolved: false },
  ]);
});
