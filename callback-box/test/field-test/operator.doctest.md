# Field-test operator session

The operator is one persistent conversation for a whole run — the persona that
receives every checklist item and answers every debrief
(`docs/plans/agent-field-tests.md`, Track 3). It is built on the `ChatBackend`
service, so the fake backend gives a fully scripted operator here: no SDK, no
subprocess, no cost.

```ts setup
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFakeChatBackend, type FakeChatBackendRun } from "../../src/services/claude-chat.js";
import { startOperatorSession } from "../../src/field-test/operator.js";
import {
  assembleOperatorPrompt,
  operatorPromptLayers,
} from "../../src/field-test/operator-prompt.js";
import {
  STANDARD_QUESTIONS,
  debriefQuestions,
  parseOutcome,
  verifyScreenshotRefs,
} from "../../src/field-test/questionnaire.js";

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
```

## The prompt is four separable layers

Each layer has a different owner — the persona is scenario content, the
mechanics are run-specific, the mandate and boundaries are the tier's own
invariants — so they are assembled, not hardcoded together.

```ts
const layers = operatorPromptLayers(promptParams);

// Persona goes in verbatim.
layers.persona.includes("Marisol Vance") && layers.persona.includes("no patience for settings")
=> true

// The mandate is the evaluator stance, not a task instruction.
[
  layers.mandate.includes("USABLE"),
  layers.mandate.includes("try the obvious thing first"),
  layers.mandate.includes("that is a RESULT to report"),
  layers.mandate.includes("Never work around brokenness silently"),
  layers.mandate.includes("hidden paths a real person wouldn't try"),
  layers.mandate.includes("Asking the app's own chat for help IS a legitimate user move"),
].join(",")
=> true,true,true,true,true,true

// Mechanics are parameterized by this run's browse invocation and directories.
[
  layers.mechanics.includes("/checkout/bin/browse --session field-20260808"),
  layers.mechanics.includes("http://127.0.0.1:41234/box"),
  layers.mechanics.includes("/runs/demo/screenshots"),
  layers.mechanics.includes("/runs/demo/assets"),
  layers.mechanics.includes("Re-snapshot after anything changes the page"),
  layers.mechanics.includes("Screenshot liberally"),
  layers.mechanics.includes("up to about two minutes"),
].join(",")
=> true,true,true,true,true,true,true

// The boundary layer is what keeps a developer-brained model out of the repo.
[
  layers.boundaries.includes("ONLY what you see through the browser"),
  layers.boundaries.includes("Never read the app's"),
  layers.boundaries.includes("No CLI other than the browse"),
].join(",")
=> true,true,true
```

Assembly order is persona → mandate → mechanics → boundaries, so the hard
boundaries sit nearest the first activity message.

```ts continue
const prompt = assembleOperatorPrompt(promptParams);
[
  prompt.indexOf("Marisol") < prompt.indexOf("USABLE"),
  prompt.indexOf("USABLE") < prompt.indexOf("--session"),
  prompt.indexOf("--session") < prompt.indexOf("Hard boundaries"),
].join(",")
=> true,true,true
```

## An activity, then its debrief, on one session

The session pins the scenario's operator model and hands the SDK the tool set
the operator gets at all. That narrows the surface — no editing, no fetching —
but "browser only" itself stays instruction-level in v1 (the boundaries prompt
layer), since `Bash` is how the operator drives the browser in the first place.

```ts
const screenshotsDir = await mkdtemp(join(tmpdir(), "cb-field-shots-"));
await writeFile(join(screenshotsDir, "home-empty.png"), "");

const backend = createFakeChatBackend();
const session = startOperatorSession({
  backend,
  systemPrompt: assembleOperatorPrompt({ ...promptParams, screenshotsDir }),
  cwd: "/runs/demo",
  model: "opus",
  tools: ["Bash", "Read"],
  env: { CB_BROWSE_API_KEY: "k" },
  screenshotsDir,
});
const run = backend.lastRun();
if (run === null) throw new Error("no run");

[run.startOptions.model, run.startOptions.tools?.join("+"), run.startOptions.cwd].join(" | ")
=> opus | Bash+Read | /runs/demo
```

The operator works the activity across several turns and ends with a free-text
note in its own words. The note is the SDK result text; the assistant turns
along the way are counted, not summarized.

```ts continue
const activity = session.sendActivity("Save the recipe photo somewhere you can find it later.");
run.emitAssistantText("Opening the app.");
run.emitAssistantText("Taking a screenshot: home-empty.png");
run.emitResult({ result: "I got it saved eventually, but I had to guess which button to use." });
const turn = await activity;
[turn.status, String(turn.turns), turn.note].join(" | ")
=> completed | 2 | I got it saved eventually, but I had to guess which button to use.
```

The debrief comes *after* the work, never before — the questions must not prime
the behaviour they ask about. Each question is asked on its own turn, so a
skipped one is identifiable; answers are stored verbatim.

```ts continue
const questions = debriefQuestions(["Did the recipe look right when you found it again?"]);
questions.length
=> 9

const debriefRun = session.runDebrief(questions);
await replyEach(run, [
  "Yes — the recipe card showed up in the list.",
  "I tried the big + button first because it was the only obvious control.",
  "I hesitated at the 'capture' label; I wasn't sure it meant photos.",
  "Nothing broke, but nothing confirmed the save either.",
  "I expected a 'saved' toast.",
  "'Capture' — I didn't know if that meant camera or upload.",
  "home-empty.png shows the empty state; recipe-saved.png shows it afterwards.",
  "It looked right, yes.",
  "Friction — it worked, but I guessed twice.",
]);
const debrief = await debriefRun;
[debrief.outcome, String(debrief.unanswered.length), debrief.answers[5]?.answer].join(" | ")
=> friction | 0 | 'Capture' — I didn't know if that meant camera or upload.
```

Cited screenshots are checked against the run's screenshots directory. A
citation that does not resolve is recorded as a finding, not thrown — an
operator citing evidence that does not exist is exactly the signal the report
needs to show.

```ts continue
debrief.screenshotRefs.map((r) => `${r.filename}:${String(r.resolved)}`).join(", ")
=> home-empty.png:true, recipe-saved.png:false

debrief.missingScreenshots.join(", ")
=> recipe-saved.png
```

A question left blank is re-asked exactly once, then recorded.

```ts continue
const second = session.runDebrief(STANDARD_QUESTIONS.slice(0, 1));
await replyEach(run, ["   ", "Sorry — yes, I did finish it."]);
const secondResult = await second;
[secondResult.answers[0]?.reAsked, secondResult.answers[0]?.answer].join(" | ")
=> true | Sorry — yes, I did finish it.
```

An unparseable outcome answer never throws — it becomes `unresolved` with a
reason, so the eight good answers beside it survive into the report.

```ts continue
const third = session.runDebrief(STANDARD_QUESTIONS.slice(7));
await replyEach(run, ["Honestly it was somewhere between fine and awful."]);
const thirdResult = await third;
[thirdResult.outcome, thirdResult.outcomeReason].join(" | ")
=> unresolved | answer named none of smooth/friction/blocked

await session.stop();
await session.sendActivity("anything")
=> throws OperatorSessionClosedError
```

```ts cleanup
await rm(screenshotsDir, { recursive: true, force: true });
```

## Limits are enforced by the wrapper, not the SDK

The SDK's `maxTurns` is per query, and this session is one query for the whole
run — so a per-activity cap has to be counted here. Exceeding it ends the
activity with a partial note rather than letting one stuck item eat the run.

```ts
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
run.startOptions.model
=> opus
```

The capped activity settles on the interrupt's own `result`, not the moment the
cap is hit: everything still in the stream belongs to the activity we gave up
on, and the next activity must not be handed its predecessor's tail.

```ts continue
const capped = session.sendActivity("Find the dentist reminder.");
run.emitAssistantText("Snapshotting.");
run.emitAssistantText("Clicking around.");
run.emitAssistantText("Still clicking around.");
run.emitAssistantText("(this one arrives after the interrupt)");
run.emitResult({ result: "(interrupted)" });
const turn = await capped;
[turn.status, String(turn.turns), turn.error].join(" | ")
=> turn-capped | 3 | activity exceeded its 2-turn cap

// The note is what the operator managed before the cap — the trailing
// interrupt result is not the operator talking.
JSON.stringify(turn.note)
=> "Snapshotting.\n\nClicking around.\n\nStill clicking around."

const next = session.sendActivity("Never mind — check what needs your attention.");
run.emitResult({ result: "Nothing seemed urgent." });
const nextTurn = await next;
[nextTurn.status, String(nextTurn.turns), nextTurn.note].join(" | ")
=> completed | 0 | Nothing seemed urgent.

await session.stop();
```

An interrupt that never produces a result would leave the stream ambiguous
forever, so the drain has its own grace and the session is abandoned rather
than reused — loudly, and only after the capped turn has been reported.

```ts
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
[turn.status, turn.error].join(" | ")
=> turn-capped | activity exceeded its 1-turn cap; the interrupted turn never produced a result

await session.sendActivity("Next item")
=> throws OperatorSessionClosedError

await session.stop();
```

An activity that goes quiet ends on the awake-time budget — awake time, not a
raw `setTimeout`, which on macOS counts sleep and would fire the moment a
laptop wakes.

```ts
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
turn.status
=> timed-out

await session.stop();
```

## Outcome parsing is tolerant but never guesses

```ts
[
  parseOutcome("Blocked.").outcome,
  parseOutcome("smooth — I found it immediately").outcome,
  parseOutcome("Honestly, there was quite a bit of friction here.").outcome,
  parseOutcome("").outcome,
  parseOutcome("It was not smooth; call it friction.").outcome,
  parseOutcome("I was never blocked at any point.").outcome,
  parseOutcome("It wasn't blocked exactly.").outcome,
].join(", ")
=> blocked, smooth, friction, unresolved, unresolved, unresolved, unresolved
```

A negated mention is the case worth being strict about: "I was never blocked"
must never be reported as `blocked`. The ambiguous cases say why, because "we
couldn't tell" belongs in the report:

```ts continue
parseOutcome("It was not smooth; call it friction.").reason
=> answer named several of smooth/friction/blocked (smooth, friction) and did not lead with one

parseOutcome("I was never blocked at any point.").reason
=> answer did not lead with an outcome word and its single mention may be negated
```

## Screenshot references resolve by basename

The operator may cite a bare filename or the path it wrote; both name the same
file in the run's screenshots directory.

```ts
const dir = await mkdtemp(join(tmpdir(), "cb-field-refs-"));
await writeFile(join(dir, "step-2.png"), "");

const refs = await verifyScreenshotRefs(
  ["See /runs/demo/screenshots/step-2.png and step-3.jpg for the error."],
  dir,
);
refs.map((r) => `${r.filename}:${String(r.resolved)}`).join(", ")
=> step-2.png:true, step-3.jpg:false
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
```
