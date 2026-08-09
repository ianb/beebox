# Field-test `inject-email`, end to end (manual)

**What this diagnoses.** The `inject-email` pre action of the field-test
harness (`docs/implemented-plans/agent-field-tests.md`, Track 2), across the process
boundary it exists to cross: a fixture is appended to the run's fake-Gmail
state file, a REAL connector-scoped `cb wakeup` subprocess reads it through the
`CB_FAKE_GMAIL` gate, and the message becomes cards in the box.

**Why it can't be automated into `pnpm test`.** That wakeup runs the reactor,
which invokes a REAL box agent on the arriving mail — roughly two minutes and
one agent session per run, on top of a real `cb init` and two `cb wakeup`
subprocesses. Unattended runtime is ~4 minutes and it costs one agent session's
API credit. The in-process half of the same pipeline (the gate, the state
format, `sync()` producing cards) is covered for free in
`test/field-test/fake-gmail.doctest.md`; what only this can prove is that a
SUBPROCESS sees the fake mailbox at all.

Assertions are on shape — files present, counts — never on what the agent
decided to do with the mail.

```ts setup
import { mkdtemp, mkdir, rm, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFieldBox } from "../../src/field-test/run-box.js";
import { loadFieldScenario } from "../../src/field-test/scenario.js";
import { seedFieldBox, scenarioNeedsGmail } from "../../src/field-test/run-seed.js";
import { baselineGmailSync, injectEmail } from "../../src/field-test/pre-actions.js";
import { loadFakeGmailState } from "../../src/field-test/fake-gmail-state.js";
import { fileExists } from "../../src/lib/file-exists.js";

/** Every file under a directory, recursively, as box-relative paths. */
async function tree(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(dir.length + 1));
}
```

## A fixture arrives as mail and becomes a card

```ts
const runDir = await mkdtemp(join(tmpdir(), "cb-field-pre-"));
const scenarioDir = join(runDir, "scenario");
await mkdir(join(scenarioDir, "emails"), { recursive: true });
await writeFile(
  join(scenarioDir, "scenario.yaml"),
  [
    "name: pre-fixture",
    "description: One item whose pre action injects mail.",
    'startTime: "2026-08-10T09:00:00Z"',
    "checklist:",
    "  - id: mail",
    "    brief: See what arrived.",
    "    pre:",
    "      - inject-email: hello",
    "",
  ].join("\n"),
);
await writeFile(join(scenarioDir, "persona.md"), "A scripted operator.\n");
await writeFile(
  join(scenarioDir, "emails", "hello.yaml"),
  [
    "from: Riverside Clinic <appointments@example.com>",
    "to: boxholder@example.com",
    "subject: Reminder about Thursday",
    "body: |",
    "  Your appointment is on Thursday at 3:40pm.",
    "",
  ].join("\n"),
);

const scenario = await loadFieldScenario(scenarioDir);
scenarioNeedsGmail(scenario)
=> true
```

Box creation plus the harness-arranged setup: field tests never exercise
configuration, so the connector config is seeded and committed before the
operator exists.

```ts continue
const box = await createFieldBox(join(runDir, "run"));
await seedFieldBox({ box, scenario });

await fileExists(join(box.boxRoot, "config/connectors/gmail.json"))
=> true

// The pinned box-agent model is gitignored runtime state, not part of the
// committed baseline a `reset` rewinds to.
await fileExists(join(box.boxRoot, ".callback-box/chat-model.json"))
=> true
```

A baseline sync comes first, and it is not optional: a track rule's first sync
only sets the history checkpoint and baselines the rule against the mail already
there. Skip it and the run's first injected message is part of that baseline and
never arrives — which reads in a report as "the box ignored my email".

```ts continue
const statePath = join(runDir, "fake-gmail.json");
await baselineGmailSync({
  statePath,
  packageRoot: box.packageRoot,
  env: { CB_TIME: scenario.startTime },
});

(await tree(box.boxRoot)).filter((f) => f.endsWith(".email-thread.card")).length
=> 0
```

Injecting then appends the message plus its `messagesAdded` history record — the
cursor is not derived from array length — and the connector-scoped wakeup turns
it into cards.

```ts continue
const messageId = await injectEmail({
  emailsDir: scenario.emailsDir,
  fixture: "hello",
  statePath,
  packageRoot: box.packageRoot,
  env: { CB_TIME: scenario.startTime },
  now: new Date(scenario.startTime),
});
messageId
=> hello

const state = await loadFakeGmailState(statePath);
[state.messages.length, state.historyRecords.length].join(" ")
=> 1 1
```

The real proof: the box now holds email cards it did not have a moment ago.

```ts continue
const files = await tree(box.boxRoot);
files.filter((f) => f.endsWith(".email-thread.card")).length > 0
=> true

files.filter((f) => f.endsWith(".email-message.card")).length > 0
=> true
```

And it leaves no intake job pending. A single wakeup runs one reactor cycle, so
the intake job the arrival creates — or a follow-up it spawns — can outlive the
wakeup and sit in `box/jobs`, where it keeps the box from ever going quiescent
(the first onboarding run stalled every email item exactly this way). `inject`
now drains to completion, so the box is caught up before the operator looks.

```ts continue
files.filter((f) => f.endsWith(".intake.job.card"))
=> []
```

```ts cleanup
await rm(runDir, { recursive: true, force: true });
```
