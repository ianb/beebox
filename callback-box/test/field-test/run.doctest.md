# Field-test activity loop

`runFieldScenario` is the whole run: box, server, operator session, and then the
per-item loop of pre-actions → brief → activity → debrief → quiescence → checks
→ cleanup (`docs/plans/agent-field-tests.md`, Track 2).

The operator here is the fake chat backend — a fully scripted persona, no SDK
and no cost — but the box and the server are REAL, for the same reason the
lifecycle doctest uses a real one: the failures this loop exists to catch (a
checkpoint that doesn't rewind, a server that keeps serving reset state, a
debrief asked of a dead session) are invisible against a mocked box.

```ts setup
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";
import { createFakeChatBackend, type FakeChatBackend } from "../../src/services/claude-chat.js";
import { runFieldScenario } from "../../src/field-test/run.js";
import { createFieldBox } from "../../src/field-test/run-box.js";
import { loadFieldScenario } from "../../src/field-test/scenario.js";
import { seedFieldBox, scenarioNeedsGmail } from "../../src/field-test/run-seed.js";
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
          run.emitResult({ result: `Worked through it. See 01-start.png.` });
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
```

## Quiescence is composite, and names what stayed busy

Everything must read idle twice, `settleMs` apart — a single all-idle reading
can land in the gap between two stages of one reactor cycle.

```ts
const outcome = await waitForQuiescence({
  probes: [scriptedProbe("chat", [{ busy: false, detail: null }]), scriptedProbe("jobs", [{ busy: false, detail: null }])],
  timeoutMs: 5_000,
  pollMs: 10,
  settleMs: 10,
});
[outcome.quiescent, outcome.stuck.length].join(" ")
=> true 0
```

A component that never goes idle times out — and the report says which one, and
why. A timeout that only said "not quiescent" would make every run's triage
start from scratch.

```ts
const stuck = await waitForQuiescence({
  probes: [
    scriptedProbe("chat", [{ busy: false, detail: null }]),
    scriptedProbe("jobs", [{ busy: true, detail: "1 pending job card: intake.job.card" }]),
  ],
  timeoutMs: 300,
  pollMs: 10,
  settleMs: 10,
});
stuck.quiescent
=> false

stuck.stuck.map((s) => `${s.name}: ${s.detail}`).join("; ")
=> jobs: 1 pending job card: intake.job.card
```

## Setup is arranged, never operated

A scenario that involves email starts with the connector already configured, as
if the boxholder had connected their mail last month — field tests exercise
operating order, never setup. The box-agent model is pinned at the same moment,
and deliberately as gitignored runtime state, so a `reset` cannot rewind the
run onto a different model than it started with.

```ts
const seedTmp = await mkdtemp(join(tmpdir(), "cb-field-seed-"));
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
    "  box: sonnet",
    "checklist:",
    "  - id: mail",
    "    brief: See what arrived.",
    "    pre:",
    "      - inject-email: hello",
    "",
  ].join("\n"),
);

const seedScenario = await loadFieldScenario(seedScenarioDir);
scenarioNeedsGmail(seedScenario)
=> true

const seedBox = await createFieldBox(join(seedTmp, "run"));
await seedFieldBox({ box: seedBox, scenario: seedScenario });

await fileExists(join(seedBox.boxRoot, "config/connectors/gmail.json"))
=> true

JSON.parse(await readFile(join(seedBox.boxRoot, ".callback-box/chat-model.json"), "utf-8")).model
=> sonnet

// The connector config is part of the committed baseline; the model file is not.
const seedStatus = await execa("git", ["status", "--porcelain"], { cwd: seedBox.packageRoot });
seedStatus.stdout
=>
```

A scenario with no mail in it gets no connector at all — the box is as bare as a
new boxholder's.

```ts continue
scenarioNeedsGmail({ ...seedScenario, checklist: [{ ...seedScenario.checklist[0]!, pre: [] }] })
=> false
```

```ts cleanup
await rm(seedTmp, { recursive: true, force: true });
```

## A real run: four items, four shapes

One run covers the cases worth a real server: a normal item with a passing and a
failing check, an activity whose session errors (no debrief), an item whose
`reset` cleanup rewinds the box and restarts the server, and an item whose `pre`
action fails before the operator is ever asked.

```ts
const tmp = await mkdtemp(join(tmpdir(), "cb-field-loop-"));
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
const boxRoot = join(runsRoot, "run", "box", "content");
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

result.items.map((i) => i.id).join(",")
=> first,busted,messy,broken-setup
```

The first item ran everything: both checks, verbatim, exit codes and all.

```ts continue
const first = result.items[0]!;
[first.activity.status, first.debrief?.outcome, String(first.debriefSkipped)].join(" | ")
=> completed | smooth | null

// The box really went quiet, which means the chat probe reached the run
// server's `chat.statusAll` with the run's diagnostic key — an unreachable or
// unauthorized probe reports busy forever and would time out here.
[first.quiescence.quiescent, first.quiescence.stuck.length].join(" ")
=> true 0

first.checks.map((c) => `${c.script}=${String(c.exitCode)}`).join(" ")
=> passes.sh=0 fails.sh=3

// The failing check's own stderr survives into the result — that is what the
// report shows a human.
first.checks[1]!.stderr.trim()
=> no such card

// The item's extra question was asked alongside the standard nine.
first.debrief!.answers.map((a) => a.id).join(",")
=> accomplished,first-attempt,hesitations,surprises,missing,wording,rendering,screenshots,extra-1,outcome
```

An activity that ended in `error` gets NO debrief: nine questions into a dead
session collect the same error nine times, at a real Opus turn each.

```ts continue
const busted = result.items[1]!;
[busted.activity.status, String(busted.debrief), busted.debriefSkipped].join(" | ")
=> error | null | activity ended with status "error" (SDK result error_during_execution)

await fileExists(join(result.runDir, "questionnaires", "busted.md"))
=> false

// The activity note is still written — a failed activity is still evidence.
await fileExists(join(result.runDir, "activities", "busted.md"))
=> true
```

`reset` rewinds the box to the previous checkpoint and restarts the server, so
nothing is left serving state that no longer exists.

```ts continue
const messy = result.items[2]!;
[messy.cleanup.policy, messy.cleanup.resetTo, String(messy.cleanup.serverRestarted)].join(" | ")
=> reset | field-run/02-busted | true

// The residue the messy attempt left is gone.
await fileExists(join(boxRoot, "junk-residue.txt"))
=> false
```

The item after the reset still went quiescent, which means the chat probe
reached the RESTARTED server — a restart is not a run-ending event.

```ts continue
result.items[3]!.quiescence.quiescent
=> true
```

An item whose `pre` action failed never reaches the operator at all, and its
checks do not run: the world is not what the brief assumes, so an activity there
would spend a real operator on a question the harness already broke — and the
report would read as a product failure.

```ts continue
const broken = result.items[3]!;
[broken.activity.status, broken.checks.length, broken.pre[0]!.ok].join(" | ")
=> harness-skipped | 0 | false

broken.debriefSkipped!.startsWith("setup failed: inject-email broken")
=> true
```

Every item leaves a checkpoint tag whatever its policy — that is what makes
`reset` and post-hoc inspection cheap.

```ts continue
const tags = await execa("git", ["tag", "--list"], { cwd: join(runsRoot, "run", "box") });
tags.stdout.split("\n").toSorted().join(" ")
=> field-run/01-first field-run/02-busted field-run/03-messy field-run/04-broken-setup field-run/baseline
```

The raw result is on disk for the report writer, written after every item so a
run that dies part-way still leaves the completed items behind.

```ts continue
const onDisk = JSON.parse(await readFile(join(result.runDir, "results.json"), "utf-8"));
[onDisk.scenario, onDisk.items.length, onDisk.models.box, String(onDisk.aborted)].join(" | ")
=> loop-fixture | 4 | opus | null
```

The run also writes `report.md` in the same `finally`, so a triage read never
needs to regenerate one by hand — `cb field-test report <run-dir>` exists for
the rare case a run directory moves or the writer's format changes later.

```ts continue
const reportMd = await readFile(join(result.runDir, "report.md"), "utf-8");
[reportMd.includes("# Field test report: loop-fixture"), reportMd.includes("| first | completed | smooth |")].join(" | ")
=> true | true
```

```ts cleanup
await rm(tmp, { recursive: true, force: true });
```
