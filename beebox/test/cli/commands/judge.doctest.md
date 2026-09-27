# `bbx judge`: a judgment card's questions over a state from stdin

`runJudge({ boxRoot, cardPath, options, stdin, env, jev })` is the command with
the box, stdin, the environment, and the Jev service given; it prints to stdout
and returns the exit code. One Jev call per state, one JSON line per state;
`--min`, `--choice`, and `--decide` make the decision. Every test here uses the
fake Jev, whose scripted answers go through the real response parser. See
docs/implemented-plans/notifications.md (Track D).

```ts setup
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runJudge } from "../../../src/cli/commands/judge.js";
import { createFakeJev } from "../../../src/services/jev.js";
import { JevError } from "../../../src/services/jev-wire.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

const TRIP = `---
questions:
  trip:
    type: noul
    criteria:
      true: "At least one of these emails is from the school about the spring field trip."
      false: "None is; a newsletter that mentions the school, or a receipt, does not count."
---
You are looking at the email cards that arrived in a family inbox since the last check.
`;

const REPLY = `---
questions:
  reply:
    type: choice
    criteria:
      expects: "The sender is waiting on an answer from the recipient."
      none: "Nothing is asked of the recipient."
      unclear: "Cannot tell from what is here."
  urgency:
    type: score
    criteria: ["Can wait.", "This week.", "Today."]
---
The state is one email card: frontmatter (from, to, subject) and body.
`;

/** An email card long enough not to draw the thin-state warning. */
const email = (subject, text) => `---\nfrom: school@example.org\nto: parent@example.org\nsubject: ${subject}\n---\n${text}\n${"Details follow in the rest of this message. ".repeat(8)}\n`;

/** The fake: a trip email is a trip, a question expects a reply today. */
const jev = () => createFakeJev({
  answers: (name, { state }) => {
    const text = String(state);
    if (name === "trip") return { type: "noul", probability: text.includes("field trip") ? 0.92 : 0.08 };
    if (name === "reply") {
      const choice = text.includes("?") ? "expects" : "none";
      const probabilities = choice === "expects" ? { expects: 0.9, none: 0.05, unclear: 0.05 } : { expects: 0.05, none: 0.9, unclear: 0.05 };
      return { type: "choice", choice, confidence: 0.9, probabilities };
    }
    const score = text.includes("?") ? 2 : 0;
    return { type: "score", score, confidence: 0.8, probabilities: score === 2 ? { 0: 0.1, 1: 0.1, 2: 0.8 } : { 0: 0.8, 1: 0.1, 2: 0.1 } };
  },
});

/** Run with output captured; stdout, then `stderr:` lines, then the exit code. */
async function judge(box, cardPath, options, run = {}) {
  const { stdin = "", env = {} } = run;
  // `service: undefined` means no injected service: the env fake or the box's key.
  const service = "service" in run ? run.service : jev();
  const out = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => { out.push(args.join(" ")); };
  console.error = (...args) => { out.push(`stderr: ${args.join(" ")}`); };
  let code;
  try {
    code = await runJudge({ boxRoot: box.root, cardPath, options: { min: [], choice: [], ...options }, stdin, env, jev: service });
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return [...out, `exit ${code}`].join("\n");
}

async function seededBox() {
  const box = await makeTmpBox({ git: true });
  await box.write("_config/judgments/field-trip.judgment.card", TRIP);
  await box.write("_config/judgments/needs-reply.judgment.card", REPLY);
  await box.write("_content/inbox/trip.email.card", email("Spring field trip", "The field trip is on May 3. Please sign the form."));
  await box.write("_content/inbox/lunch.email.card", email("Can we do lunch?", "Are you free Thursday?"));
  await box.write("_content/inbox/receipt.email.card", email("Your receipt", "Thank you for your order."));
  return box;
}
const CARDS = "_content/inbox/trip.email.card\n_content/inbox/lunch.email.card\n_content/inbox/receipt.email.card\n";
```

## Per line, each card judged alone

`--per-line --cards` reads each line as a card path and judges the card's
text. The JSON line carries the path as `input`.

```ts
const box = await seededBox();
await judge(box, "_config/judgments/field-trip.judgment.card", { perLine: true, cards: true }, { stdin: CARDS })
=> {"input":"_content/inbox/trip.email.card","answers":{"trip":{"type":"noul","probability":0.92}}}
{"input":"_content/inbox/lunch.email.card","answers":{"trip":{"type":"noul","probability":0.08}}}
{"input":"_content/inbox/receipt.email.card","answers":{"trip":{"type":"noul","probability":0.08}}}
exit 0
```

An email-message card keeps the email's text in a `body-file` sidecar. With
`--cards` the state is the card followed by that text, as `bbx changes --cat`
prints it, so the judge sees the body and not only the subject.

```ts continue
const thread = "_content/inbox/email/Trip.email-thread.attach";
await box.write(`${thread}/msg-001.email-message.card`, "---\ntype: email-message\nsubject: Spring outing\nbody-file:\n  ref: attach/msg-001.body.txt\n---\n");
await box.write(`${thread}/msg-001.attach/msg-001.body.txt`, `The field trip is on May 3. ${"Please read on. ".repeat(20)}\n`);
await judge(box, "_config/judgments/field-trip.judgment.card", { perLine: true, cards: true }, { stdin: `${thread}/msg-001.email-message.card\n` })
=> {"input":"_content/inbox/email/Trip.email-thread.attach/msg-001.email-message.card","answers":{"trip":{"type":"noul","probability":0.92}}}
exit 0
```

`--min` sets the bar and `--select` prints only the inputs that passed, so the
next command in the pipe gets paths.

```ts continue
await judge(box, "_config/judgments/field-trip.judgment.card", { perLine: true, cards: true, min: ["trip=0.8"], select: true }, { stdin: CARDS })
=> _content/inbox/trip.email.card
exit 0
```

`--choice` asks for an option; `name.option=p` bounds one option's
probability; `--decide` takes several conditions as JSON. All combine with AND.

```ts continue
const reply = "_config/judgments/needs-reply.judgment.card";
await judge(box, reply, { perLine: true, cards: true, choice: ["reply=expects"], select: true }, { stdin: CARDS })
=> _content/inbox/lunch.email.card
exit 0

await judge(box, reply, { perLine: true, cards: true, min: ["reply.none=0.8"], select: true }, { stdin: CARDS })
=> _content/inbox/trip.email.card
_content/inbox/receipt.email.card
exit 0

await judge(box, reply, { perLine: true, cards: true, decide: '{"reply": {"is": "expects"}, "urgency": {"min": 2}}', select: true }, { stdin: CARDS })
=> _content/inbox/lunch.email.card
exit 0

await judge(box, reply, { perLine: true, cards: true, decide: '{"reply.expects": {"max": 0.5}}', min: ["urgency.2=0.5"], select: true }, { stdin: CARDS })
=> exit 0
```

```ts cleanup
await box.cleanup();
```

## One state from all of stdin, for a precheck: `--echo` and `--or-skip`

Without `--per-line`, all of stdin is one state: the shape `bbx changes --cat`
feeds. `--echo` prints stdin unchanged when it passed, so a `pass-output`
precheck hands the agent the same material the judge saw.

```ts
const box = await seededBox();
const trip = "_config/judgments/field-trip.judgment.card";
const cat = `=== _content/inbox/trip.email.card\n${email("Spring field trip", "The field trip is on May 3.")}`;
const echoed = await judge(box, trip, { min: ["trip=0.8"], echo: true }, { stdin: cat });
echoed === `${cat.replace(/\n$/, "")}\nexit 0`
=> true
```

When nothing passed, `--or-skip` writes `{ "reason": "no-pass" }` to
`$BBX_DEFER_FILE` and exits 75, which a schedule records as deferred.

```ts continue
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-judge-"));
const BBX_DEFER_FILE = path.join(dir, "defer.json");
const quiet = `=== _content/inbox/receipt.email.card\n${email("Your receipt", "Thank you for your order.")}`;
await judge(box, trip, { min: ["trip=0.8"], echo: true, orSkip: true }, { stdin: quiet, env: { BBX_DEFER_FILE } })
=> stderr: bbx judge: deferred (no-pass): none of 1 state(s) passed
exit 75

await fs.readFile(BBX_DEFER_FILE, "utf-8")
=> {"reason":"no-pass"}
```

When `bbx changes --or-skip` found nothing, it wrote `no-change` and exited
75, and the judge downstream reads an empty stdin. That marker already says
why, so the judge exits 75 without a word. With no marker yet, it defers and
says so.

```ts continue
const upstream = path.join(dir, "upstream.json");
await fs.writeFile(upstream, '{"reason":"no-change"}\n');
await judge(box, trip, { min: ["trip=0.8"], echo: true, orSkip: true }, { stdin: "", env: { BBX_DEFER_FILE: upstream } })
=> exit 75

await fs.readFile(upstream, "utf-8")
=> {"reason":"no-change"}

await judge(box, trip, { min: ["trip=0.8"], echo: true, orSkip: true }, { stdin: "", env: { BBX_DEFER_FILE: path.join(dir, "fresh.json") } })
=> stderr: bbx judge: deferred (no-pass): no state on stdin
exit 75
```

Every call is in `.beebox/jev-debug.log`: the card, the input, the state cut
at 500 characters, the answers, and whether it passed.

```ts continue
const log = (await box.read(".beebox/jev-debug.log")).trim().split("\n").map((l) => JSON.parse(l));
const last = log.at(-1);
JSON.stringify([log.length, last.card, last.passed, last.answers])
=> [2,"_config/judgments/field-trip.judgment.card",false,{"trip":{"type":"noul","probability":0.08}}]
```

```ts cleanup
await fs.rm(dir, { recursive: true, force: true });
await box.cleanup();
```

## `--dry-run` prints the exact request and the situation it used

Nothing is sent and nothing is logged. The instructions are the situation,
then the card body, then the question's own. With no `situation:` ref, the
situation is the root briefing's purpose statement.

```ts
const box = await seededBox();
await box.write("_content/briefing.briefing.card", "---\ntype: briefing\n---\n{% purpose %}\nThe household box for the Rivera family: two parents and a child in second grade.\n{% /purpose %}\n");
const service = jev();
const out = await judge(box, "_config/judgments/field-trip.judgment.card", { dryRun: true }, { stdin: "One short state.", service });
const [situation, request, exit] = out.split("\n").filter((l) => !l.startsWith("stderr:"));
situation
=> situation: the root briefing's purpose (_content/briefing.briefing.card)

JSON.stringify(JSON.parse(request), null, 2)
=> {
  "model": "typesafe/jev-1.13",
  "provider": {
    "only": [
      "TypeSafe"
    ],
    "allow_fallbacks": false,
    "data_collection": "deny"
  },
  "state": "One short state.",
  "questions": {
    "trip": {
      "type": "noul",
      "instructions": [
        "The household box for the Rivera family: two parents and a child in second grade.",
        "You are looking at the email cards that arrived in a family inbox since the last check."
      ],
      "criteria": {
        "true": "At least one of these emails is from the school about the spring field trip.",
        "false": "None is; a newsletter that mentions the school, or a receipt, does not count."
      }
    }
  }
}

`${exit} ${service.judgeCalls.length}`
=> exit 0 0

await fs.access(box.path(".beebox/jev-debug.log")).then(() => "logged", () => "not logged")
=> not logged
```

A state under 300 characters draws a warning: without the body, answers sit
near 50%. It gives the length and does not echo the state back.

```ts continue
out.split("\n").find((l) => l.startsWith("stderr:"))
=> stderr: bbx judge: warning: a state is 16 characters; a state without the body judges near 50%
```

A `situation:` ref replaces the briefing; with neither, the dry run says so.

```ts continue
await box.write("_content/about/household.memo.card", "---\ntitle: Household\n---\nTwo adults share this box.\n");
await box.write("_config/judgments/with-situation.judgment.card", TRIP.replace("---\nY", "situation:\n  ref: /_content/about/household.memo.card\n---\nY"));
const stdout = (out) => out.split("\n").filter((l) => !l.startsWith("stderr:"));
stdout(await judge(box, "_config/judgments/with-situation.judgment.card", { dryRun: true }, { stdin: "x" }))[0]
=> situation: _content/about/household.memo.card

await fs.rm(box.path("_content/briefing.briefing.card"));
stdout(await judge(box, "_config/judgments/field-trip.judgment.card", { dryRun: true }, { stdin: "x" }))[0]
=> situation: none (the root briefing _content/briefing.briefing.card has no purpose statement)
```

```ts cleanup
await box.cleanup();
```

## `--replay` judges a saved state

For tuning a card against a kept example: the file is the state, and stdin is
not read.

```ts
const box = await seededBox();
const saved = box.path("_tmp/kept-trip.txt");
await box.write("_tmp/kept-trip.txt", email("Spring field trip", "The field trip form is due Friday."));
(await judge(box, "_config/judgments/field-trip.judgment.card", { replay: saved, min: ["trip=0.8"] }, { stdin: "ignored" })).split("\n").map((l) => l.startsWith("{") ? JSON.parse(l).answers.trip.probability : l).join(" ")
=> 0.92 exit 0
```

```ts cleanup
await box.cleanup();
```

## Refusals and errors

A `--cards` batch over `--max-batch` is refused: a batch is right only when the
whole says something the items do not, and a large one dilutes a clear
positive.

```ts
const box = await seededBox();
const trip = "_config/judgments/field-trip.judgment.card";
await judge(box, trip, { cards: true, maxBatch: "2" }, { stdin: CARDS })
=> stderr: Error: 3 cards is more than --max-batch 2. A batch is only right when the whole says something the items do not; judge each card with --per-line
exit 2
```

Within the limit, the batch is one state: every card after a `=== <path>` line.

```ts continue
const service = jev();
await judge(box, trip, { cards: true }, { stdin: CARDS, service });
service.judgeCalls.length + " " + String(service.judgeCalls[0].state).split("\n").filter((l) => l.startsWith("===")).join(", ")
=> 1 === _content/inbox/trip.email.card, === _content/inbox/lunch.email.card, === _content/inbox/receipt.email.card
```

A state over 60,000 characters exits 2 before any call: Jev's request limit
is about 80,000, so it would fail on every run and defer as `jev-unavailable`
forever. The message says what to change.

```ts continue
const huge = await judge(box, trip, {}, { stdin: "x".repeat(60_001), service });
`${huge.split("\n").length} | ${huge.includes("is 60001 characters, over the 60000 a Jev request can carry; judge smaller states with --per-line or a narrower --match")} | ${huge.endsWith("exit 2")} | ${service.judgeCalls.length}`
=> 2 | true | true | 1
```

A bad card or flag exits 2 with the message, before any call.

```ts continue
await judge(box, "_content/inbox/trip.email.card", {}, { stdin: "x" })
=> stderr: Error: _content/inbox/trip.email.card is not a judgment card in the box (<name>.judgment.card)
exit 2

await judge(box, trip, { min: ["trip=high"] }, { stdin: "x" })
=> stderr: Error: --min trip=high: write name=p or name.option=p with p between 0 and 1
exit 2

await judge(box, trip, { choice: ["trip=yes"] }, { stdin: "x" })
=> stderr: Error: trip: a noul takes min and max (its probability), not is
exit 2

await judge(box, "_config/judgments/needs-reply.judgment.card", { choice: ["reply=maybe"] }, { stdin: "x" })
=> stderr: Error: reply: "maybe" is not one of expects, none, unclear
exit 2

await judge(box, trip, { min: ["school=0.5"] }, { stdin: "x" })
=> stderr: Error: school: the card has no question "school" (it has trip)
exit 2
```

A probability bound (a noul, or `name.option`) lies between 0 and 1; a score's
level bound keeps its range.

```ts continue
await judge(box, trip, { decide: '{"trip": {"min": 70}}' }, { stdin: "x" })
=> stderr: Error: trip: min 70 is a probability, between 0 and 1
exit 2

await judge(box, "_config/judgments/needs-reply.judgment.card", { decide: '{"reply.expects": {"max": -0.1}}' }, { stdin: "x" })
=> stderr: Error: reply.expects: max -0.1 is a probability, between 0 and 1
exit 2

(await judge(box, "_config/judgments/needs-reply.judgment.card", { decide: '{"urgency": {"min": 2}}' }, { stdin: "x", service })).split("\n").at(-1)
=> exit 0

await judge(box, trip, { select: true, echo: true }, { stdin: "x" })
=> stderr: Error: give --select or --echo, not both
exit 2
```

Jev failing, or answering badly, defers with `jev-unavailable`; with no service
and no OpenRouter key the box is `unconfigured`. (Each run gets a fresh defer
file from the tick, and the first marker written wins, so the file is removed
between the two here.) Both exit 75 whether or not
`--or-skip` was given, so a schedule keeps its items for the next run.

```ts continue
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-judge-"));
const BBX_DEFER_FILE = path.join(dir, "defer.json");
const down = createFakeJev({ error: new JevError("HTTP 503", "request") });
await judge(box, trip, {}, { stdin: CARDS, env: { BBX_DEFER_FILE }, service: down })
=> stderr: bbx judge: warning: «*»
stderr: bbx judge: deferred (jev-unavailable): Jev request error: HTTP 503
exit 75

await fs.readFile(BBX_DEFER_FILE, "utf-8")
=> {"reason":"jev-unavailable"}

await fs.rm(BBX_DEFER_FILE);
await judge(box, trip, { dryRun: false }, { stdin: CARDS, env: { BBX_DEFER_FILE }, service: undefined })
=> stderr: bbx judge: warning: «*»
stderr: bbx judge: deferred (unconfigured): the box has no OpenRouter key granted
exit 75

await fs.readFile(BBX_DEFER_FILE, "utf-8")
=> {"reason":"unconfigured"}
```

`BBX_JEV_FAKE` stands in for the key on a dev box: `1` answers a confident
yes, `0` a confident no.

```ts continue
await judge(box, trip, { perLine: true, cards: true, min: ["trip=0.8"], select: true }, { stdin: CARDS, env: { BBX_JEV_FAKE: "1" }, service: undefined })
=> _content/inbox/trip.email.card
_content/inbox/lunch.email.card
_content/inbox/receipt.email.card
exit 0

await judge(box, "_config/judgments/needs-reply.judgment.card", { perLine: true, cards: true, choice: ["reply=unclear"], select: true }, { stdin: CARDS, env: { BBX_JEV_FAKE: "0" }, service: undefined })
=> _content/inbox/trip.email.card
_content/inbox/lunch.email.card
_content/inbox/receipt.email.card
exit 0
```

```ts cleanup
await fs.rm(dir, { recursive: true, force: true });
await box.cleanup();
```
