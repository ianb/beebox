# Question aging (nudge, then expire)

`ageQuestions` (`src/core/question-aging.ts`) ages every pending question by
its durable `asked-at`, never latch state: a re-notification ("nudge") fires
once past the nudge threshold, and the question flips to `expired` (via the
shared guarded transition, same as `answer`/`dismiss`) past the expiry
window. Both windows default to 30 days expire / 7 days nudge, or derive from
a card's `expires-after` override (nudge at half). Expiry never depends on a
notification channel being configured — only nudge *delivery* does.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { execSync } from "node:child_process";
import {
  ageQuestions,
  DEFAULT_EXPIRE_AFTER_MS,
  DEFAULT_NUDGE_AFTER_MS,
} from "../../src/core/question-aging.js";
import { getSystemState } from "../../src/core/state.js";
import { generateContext } from "../../src/webapp/context.js";
import { addSubscription } from "../../src/core/push-subscriptions.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const storeDir = path.join(os.tmpdir(), `cb-qaging-${process.pid}-${Date.now()}`);
process.env.CALLBACK_PUSH_STORE_DIR = storeDir;

const SUB = { endpoint: "https://push.example/qaging", keys: { p256dh: "p", auth: "a" } };

const ASKED_AT = new Date("2026-01-01T00:00:00Z");
const MARKER = JSON.stringify({ version: "1.0.0", created: ASKED_AT.toISOString() });

// makeTmpBox writes an empty .cb-box; ageQuestions calls getSystemState,
// which needs a real marker (getBoxMetadata parses it as JSON).
async function seedBox(box) {
  await box.seed(".cb-box", MARKER);
}

function addMs(date, ms) {
  return new Date(date.getTime() + ms);
}

function setTime(date) {
  process.env.CB_TIME = date.toISOString();
}

function question(opts) {
  const { prompt, askedAt, expiresAfter } = opts;
  const lines = ["---", "status: pending", `prompt: ${prompt}`, "input:", "  type: text"];
  if (askedAt !== undefined) lines.push(`asked-at: ${askedAt}`);
  if (expiresAfter !== undefined) lines.push(`expires-after: ${expiresAfter}`);
  lines.push("---", "");
  return lines.join("\n");
}

// Trailers on HEAD, one per line.
function headTrailers(root) {
  return execSync("git log -1 --format=%B", { cwd: root, stdio: "pipe" }).toString().trim();
}
```

## No nudge before the default 7-day threshold

```ts
const box = await makeTmpBox({ git: true });
await seedBox(box);
await addSubscription({ boxSlug: path.basename(box.root), subscription: SUB, now: ASKED_AT });
await box.write(
  "box/questions/Color.question.card",
  question({ prompt: "What color?", askedAt: ASKED_AT.toISOString() })
);
box.commitAll("seed question");

setTime(addMs(ASKED_AT, DEFAULT_NUDGE_AFTER_MS - 60_000));
const before = await ageQuestions(box.root);
JSON.stringify(before)
=> {"nudged":[],"expired":[]}
```

At the 7-day mark it nudges exactly once, and a web-push card is written:

```ts continue
setTime(addMs(ASKED_AT, DEFAULT_NUDGE_AFTER_MS));
const nudgedResult = await ageQuestions(box.root);
JSON.stringify(nudgedResult)
=> {"nudged":["box/questions/Color.question.card"],"expired":[]}

const cards = (await fs.readdir(path.join(box.root, "box/output"))).filter((f) => f.endsWith(".web-push.card"));
cards.length
=> 1
```

A second sweep at the same age (or later, still under expiry) does not
re-nudge — the latch dedups it:

```ts continue
setTime(addMs(ASKED_AT, DEFAULT_NUDGE_AFTER_MS + 60 * 60 * 1000));
JSON.stringify(await ageQuestions(box.root))
=> {"nudged":[],"expired":[]}
```

The question is still pending — nudging never touches status:

```ts continue
const card = await box.read("box/questions/Color.question.card");
card.includes("status: pending")
=> true
```

```ts cleanup
await box.cleanup();
delete process.env.CB_TIME;
```

## Expiry at the default 30-day window

```ts
const box = await makeTmpBox({ git: true });
await seedBox(box);
await box.write(
  "box/questions/Stale.question.card",
  question({ prompt: "Still relevant?", askedAt: ASKED_AT.toISOString() })
);
box.commitAll("seed question");

setTime(addMs(ASKED_AT, DEFAULT_EXPIRE_AFTER_MS));
const result = await ageQuestions(box.root);
JSON.stringify(result)
=> {"nudged":[],"expired":["box/questions/Stale.question.card"]}

const card = await box.read("box/questions/Stale.question.card");
card.includes("status: expired")
=> true

card.includes("expired-at:")
=> true
```

The commit carries the `Expired-By` trailer:

```ts continue
headTrailers(box.root).includes("Expired-By: question-aging")
=> true
```

Expired questions drop out of the pending count and pending-questions list:

```ts continue
const state = await getSystemState(box.root);
state.questions.filter((q) => q.status === "pending").length
=> 0

const { pendingQuestions } = await generateContext(box.root);
pendingQuestions.length
=> 0
```

```ts cleanup
await box.cleanup();
delete process.env.CB_TIME;
```

## `expires-after` override: nudge at half, expire at the full window

A 10-day override nudges at 5 days (half), not the default 7:

```ts
const box = await makeTmpBox({ git: true });
await seedBox(box);
await addSubscription({ boxSlug: path.basename(box.root), subscription: SUB, now: ASKED_AT });
const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;
await box.write(
  "box/questions/Deadline.question.card",
  question({ prompt: "Confirm by Friday?", askedAt: ASKED_AT.toISOString(), expiresAfter: "P10D" })
);
box.commitAll("seed question");

setTime(addMs(ASKED_AT, TEN_DAYS_MS / 2 - 60_000));
JSON.stringify(await ageQuestions(box.root))
=> {"nudged":[],"expired":[]}

setTime(addMs(ASKED_AT, TEN_DAYS_MS / 2));
JSON.stringify(await ageQuestions(box.root))
=> {"nudged":["box/questions/Deadline.question.card"],"expired":[]}
```

Past the full 10-day override window it expires (not the 30-day default):

```ts continue
setTime(addMs(ASKED_AT, TEN_DAYS_MS));
JSON.stringify(await ageQuestions(box.root))
=> {"nudged":[],"expired":["box/questions/Deadline.question.card"]}
```

```ts cleanup
await box.cleanup();
delete process.env.CB_TIME;
```

## Expiry runs with zero notification channels configured

No push subscription and no Telegram config — the lifecycle transition still
runs; only nudge delivery would be gated (and there's no nudge here, this
question is already past the expiry window).

```ts
const box = await makeTmpBox({ git: true });
await seedBox(box);
await box.write(
  "box/questions/NoChannel.question.card",
  question({ prompt: "Anyone listening?", askedAt: ASKED_AT.toISOString() })
);
box.commitAll("seed question");

setTime(addMs(ASKED_AT, DEFAULT_EXPIRE_AFTER_MS));
JSON.stringify(await ageQuestions(box.root))
=> {"nudged":[],"expired":["box/questions/NoChannel.question.card"]}
```

```ts cleanup
await box.cleanup();
delete process.env.CB_TIME;
```

## Missing `asked-at` warns and skips, never crashes

A pending question with no `asked-at` (shouldn't exist post-migration, but
the sweep degrades loudly rather than throwing):

```ts
const box = await makeTmpBox({ git: true });
await seedBox(box);
await box.write(
  "box/questions/NoAskedAt.question.card",
  "---\nstatus: pending\nprompt: When was this asked?\ninput:\n  type: text\n---\n"
);
box.commitAll("seed question");

setTime(addMs(ASKED_AT, DEFAULT_EXPIRE_AFTER_MS));
JSON.stringify(await ageQuestions(box.root))
=> {"nudged":[],"expired":[]}

const card = await box.read("box/questions/NoAskedAt.question.card");
card.includes("status: pending")
=> true
```

```ts cleanup
await box.cleanup();
delete process.env.CB_TIME;
```

## Race-loser: already-answered questions are simply not pending

The shared `withQuestionTransition` primitive (`question-transition.ts`)
re-checks status after acquiring both locks and skips silently when it's no
longer in the allowed set — that's exercised directly by the `answer`/
`dismiss` doctests' "already answered" cases. A true cross-process race
between the sweep and a simultaneous answer can't be manufactured in a
single-process sequential doctest without invasive mocking of the transition
internals; the observable case here is the simpler one: a question answered
before the sweep runs never appears in its pending scan at all, so it's
untouched.

```ts
const box = await makeTmpBox({ git: true });
await seedBox(box);
await box.write(
  "box/questions/AlreadyAnswered.question.card",
  question({ prompt: "Still open?", askedAt: ASKED_AT.toISOString() })
    .replace("status: pending", "status: answered\nanswered-at: 2026-01-02T00:00:00Z\nanswer:\n  text: Yes"),
);
box.commitAll("seed question");

setTime(addMs(ASKED_AT, DEFAULT_EXPIRE_AFTER_MS));
JSON.stringify(await ageQuestions(box.root))
=> {"nudged":[],"expired":[]}

const card = await box.read("box/questions/AlreadyAnswered.question.card");
card.includes("status: answered")
=> true
```

```ts cleanup
await box.cleanup();
delete process.env.CB_TIME;
await fs.rm(storeDir, { recursive: true, force: true });
```
