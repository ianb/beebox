// # Question card schema
//
// Question cards ask the user something and route the answer back for
// processing. An answer has two products: the immediate effect (`directive:`)
// and, optionally, durable knowledge the answer teaches (`learning:` — see
// `docs/implemented-plans/questions-end-to-end.md`). This covers the `input` cross-field
// refinement, the lifecycle state, the learning/expiry vocabulary, and the three template
// builders. Round-trip answer behavior lives in
// `test/core/commands/answer.test.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, str } from "@ianbicking/tap-check/check";
import {
  QuestionSchema,
  questionState,
  createSelectQuestionTemplate,
  createTextQuestionTemplate,
  createConfirmQuestionTemplate,
} from "../../src/schemas/question.js";
import { getTemplate } from "../../src/templates-registry.js";
import { getBoxTime } from "../../src/lib/time.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

const ASKED_AT = "2026-07-10T09:00:00-07:00";

function baseFields(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "question",
    prompt: "What color?",
    input: { type: "text" },
    ...overrides,
  };
}

/**
 * The parse outcome of `baseFields(overrides)`: `valid`, or each issue as
 * `path: message`. Where the message is zod's own wording, a check pins only
 * the path, since that wording changes between zod releases.
 */
function issues(overrides: Record<string, unknown>): string {
  const parsed = QuestionSchema.frontmatterSchema.safeParse(baseFields(overrides));
  return parsed.success ? "valid" : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
}

// ## Registered templates expose the answer contract (directive / learning / expires-after)
//
// The `question`, `question-text`, and `question-confirm` bbx-create templates
// accept optional `directive`, `learning`, and `expires-after` args and pass them
// through to the builders. Validation is strict: a bad `expires-after` or a
// `learning` missing its `proposal` is rejected at the args boundary.
// Parse raw args through the template's own schema, then generate — exercising
// both the argsSchema (accepts the contract fields) and the passthrough.
function renderTemplate(name: string, rawArgs: unknown) {
  const def = getTemplate(name);
  if (def === undefined) throw new Error(`no template ${name}`);
  return def.generate(def.argsSchema.parse(rawArgs), { now: new Date(ASKED_AT) });
}

// ## `input` refinement: select requires at least two options
void test("`input` refinement: select requires at least two options", async (t) => {
  t.check(issues({ input: { type: "select" } }), "input.options: select questions require at least two options");

  t.check(issues({ input: { type: "select", options: [{ id: "a", label: "A" }] } }), "input.options: select questions require at least two options");

  t.check(issues({ input: { type: "select", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] } }), "valid");
});

// ## `input` refinement: confirm and text must not carry options
void test("`input` refinement: confirm and text must not carry options", async (t) => {
  t.check(issues({ input: { type: "confirm", options: [{ id: "yes", label: "Yes" }] } }), "input.options: confirm questions must not carry options");

  t.check(issues({ input: { type: "text", options: [{ id: "a", label: "A" }] } }), "input.options: text questions must not carry options");

  t.check(issues({ input: { type: "confirm" } }), "valid");
});

// ## State: read from which lifecycle timestamp the card carries
//
// `questionState` is the one place a question's state is derived. It also takes
// loose frontmatter, which the nav count reads without a full load.
void test("questionState is the one place a question's state is derived.", async (t) => {
  t.check(
    [
      baseFields(),
      baseFields({ answer: { text: "Blue" }, "answered-at": ASKED_AT }),
      baseFields({ "dismissed-at": ASKED_AT }),
      baseFields({ "expired-at": ASKED_AT }),
    ].map(questionState),
    ["pending", "answered", "dismissed", "expired"],
  );
});

// ## `answered-by` is gone — an unknown key is stripped, not rejected
void test("`answered-by` is gone — an unknown key is stripped, not rejected", async (t) => {
  t.check(QuestionSchema.frontmatterSchema.safeParse(baseFields({ "answered-by": "triage-agent" })).data, { type: "question", prompt: "What color?", input: { type: "text" } });
});

// ## `learning`: sink/ref/proposal — proposal is required, sink is the retro vocabulary minus `question`
void test("`learning`: sink/ref/proposal — proposal is required, sink is the retro vocabulary minus `question`", async (t) => {
  t.check(issues({ learning: { sink: "guide", proposal: "Receipts go in finance/." } }), "valid");

  t.check(issues({ learning: { sink: "briefing", ref: "briefing.briefing.card", proposal: "Boxholder is in Pacific time." } }), "valid");

  t.check(issues({ learning: { sink: "guide" } }), str`learning.proposal: ${any(String)}`);

  t.check(issues({ learning: { sink: "question", proposal: "x" } }), str`learning.sink: ${any(String)}`);
});

// ## `expires-after`: ISO-8601 duration format
//
// Our duration pattern accepts day and time parts and refuses the bare designators:
void test("Our duration pattern accepts day and time parts and refuses the bare designat...", async (t) => {
  t.check(Object.fromEntries(["P30D", "PT12H", "P1DT12H", "30d", "P", "PT"].map((value) => [value, issues({ "expires-after": value })])), {
    P30D: "valid",
    PT12H: "valid",
    P1DT12H: "valid",
    "30d": "expires-after: must be an ISO-8601 duration, e.g. P30D or PT12H",
    P: "expires-after: must be an ISO-8601 duration, e.g. P30D or PT12H",
    PT: "expires-after: must be an ISO-8601 duration, e.g. P30D or PT12H",
  });
});

// ## `asked-at`: ISO datetime with offset
void test("`asked-at`: ISO datetime with offset", async (t) => {
  t.check(issues({ "asked-at": ASKED_AT }), "valid");

  t.check(issues({ "asked-at": "2026-07-10" }), str`asked-at: ${any(String)}`);
});

// ## Select template: sets `asked-at`, carries `learning`
void test("Select template: sets `asked-at`, carries `learning`", async (t) => {
  await t.checkText(
    createSelectQuestionTemplate({
      memo: "Context here",
      prompt: "What do you want?",
      options: [
        { id: "a", label: "Choice A" },
        { id: "b", label: "Choice B" },
      ],
      askedAt: ASKED_AT,
      learning: { sink: "guide", proposal: "Items like this belong in category A." },
    }),
    `---
memo: Context here
prompt: What do you want?
input:
  type: select
  options:
    - id: a
      label: Choice A
    - id: b
      label: Choice B
learning:
  sink: guide
  proposal: Items like this belong in category A.
asked-at: 2026-07-10T09:00:00-07:00
---`,
  );
});

// ## Text template: `asked-at` required, `learning`/`directive`/`expires-after` optional
void test("Text template: `asked-at` required, `learning`/`directive`/`expires-after` optional", async (t) => {
  await t.checkText(
    createTextQuestionTemplate({
      memo: "Context",
      prompt: "What is this?",
      askedAt: ASKED_AT,
      directive: "File it.",
      expiresAfter: "P7D",
    }),
    `---
memo: Context
prompt: What is this?
input:
  type: text
directive: File it.
asked-at: 2026-07-10T09:00:00-07:00
expires-after: P7D
---`,
  );
});

// ## Option uniqueness: ids unique, labels unique case-insensitively
//
// Answer resolution matches typed answers against option labels with
// `toLowerCase()`, so two options differing only in case would be ambiguous:
void test("Answer resolution matches typed answers against option labels with toLowerCas...", async (t) => {
  t.check(issues({ input: { type: "select", options: [{ id: "a", label: "A" }, { id: "a", label: "B" }] } }), "input.options.1.id: duplicate option id \"a\"");

  t.check(issues({ input: { type: "select", options: [{ id: "a", label: "Yes" }, { id: "b", label: "yes" }] } }), "input.options.1.label: duplicate option label \"yes\" (labels must be unique case-insensitively)");

  t.check(issues({ input: { type: "select", options: [{ id: "a", label: "Yes" }, { id: "b", label: "No" }] } }), "valid");
});

// ## Lifecycle coherence: at most one timestamp, and an answer only with `answered-at`
//
// `answered-at` requires `answer`; `answer` and `answered-via` require
// `answered-at`; a card carries at most one of `answered-at`, `dismissed-at`,
// `expired-at`.
void test("answered-at requires answer; answer and answered-via require answered-at; a c...", async (t) => {
  t.check(issues({ "answered-at": ASKED_AT }), "answer: \"answered-at\" requires \"answer\"");

  t.check(issues({ answer: { text: "Blue" }, "answered-at": ASKED_AT, "answered-via": "web" }), "valid");

  t.check(issues({ answer: { text: "x" } }), "answer: \"answer\" requires \"answered-at\"");

  t.check(issues({ "answered-via": "cli" }), "answered-via: \"answered-via\" requires \"answered-at\"");

  t.check(issues({ answer: { text: "Blue" }, "answered-at": ASKED_AT, "dismissed-at": ASKED_AT }), "dismissed-at: \"dismissed-at\" must not appear with \"answered-at\"");

  t.check(issues({ "dismissed-at": ASKED_AT, "expired-at": ASKED_AT }), "expired-at: \"expired-at\" must not appear with \"dismissed-at\"");
});

// ## `provisional` requires a closing timestamp; an answered card keeps it
//
// `provisional` is what the box decided in place of an answer
// (`bbx question decide`). A pending card has no decision to record; a later
// answer keeps it as history.
const PROVISIONAL = {
  decision: "Filed it under Taxes",
  reasoning: "Same vendor as last year",
  undo: "Move the receipt back to the inbox",
  "decided-at": ASKED_AT,
};
void test("`provisional` requires a closing timestamp; an answered card keeps it", async (t) => {
  t.check(issues({ provisional: PROVISIONAL }), "provisional: \"provisional\" requires \"dismissed-at\", \"expired-at\" or \"answered-at\"");

  t.check(issues({ provisional: PROVISIONAL, "dismissed-at": ASKED_AT }), "valid");

  t.check(issues({ provisional: PROVISIONAL, "expired-at": ASKED_AT }), "valid");

  t.check(issues({ provisional: PROVISIONAL, answer: { text: "Blue" }, "answered-at": ASKED_AT }), "valid");

  // A partial object is refused on the missing fields; zod's wording is not pinned.
  t.check(
    issues({ provisional: { decision: "x" }, "dismissed-at": ASKED_AT }).split("\n").map((line) => line.split(":")[0]),
    ["provisional.reasoning", "provisional.undo", "provisional.decided-at"],
  );
});

// ## Confirm template: no options, `asked-at` still set
void test("Confirm template: no options, `asked-at` still set", async (t) => {
  await t.checkText(
    createConfirmQuestionTemplate({
      memo: "Context",
      prompt: "Is this right?",
      askedAt: ASKED_AT,
    }),
    `---
memo: Context
prompt: Is this right?
input:
  type: confirm
asked-at: 2026-07-10T09:00:00-07:00
---`,
  );
});

// The text template carries `directive`, a `learning` block, and `expires-after`:
void test("The text template carries directive, a learning block, and expires-after:", async (t) => {
  const card = renderTemplate("question-text", {
    memo: "Why",
    prompt: "What is this?",
    directive: "File it.",
    learning: { sink: "guide", proposal: "Items like this belong in category A." },
    "expires-after": "P7D",
  });
  t.check(card, str`---
memo: Why
prompt: What is this?
input:
  type: text
learning:
  sink: guide
  proposal: Items like this belong in category A.
directive: File it.
asked-at: ${isoDate()}
expires-after: P7D
---
`);
});

// The select template threads the same fields alongside its options:
void test("The select template threads the same fields alongside its options:", async (t) => {
  const card = renderTemplate("question", {
    memo: "Why",
    prompt: "Pick one",
    options: ["Finance", "Personal"],
    directive: "File the receipt",
  });
  t.check(card, str`---
memo: Why
prompt: Pick one
input:
  type: select
  options:
    - id: a
      label: Finance
    - id: b
      label: Personal
directive: File the receipt
asked-at: ${isoDate()}
---
`);
});

// Strict arg validation — a malformed `expires-after` and a `learning` without a
// `proposal` are both rejected at the args boundary (a `ZodError`):
void test("Strict arg validation — a malformed expires-after and a learning without a pr...", async (t) => {
  await t.checkThrows(async () => (renderTemplate("question-confirm", { memo: "m", prompt: "p", "expires-after": "7 days" })), "ZodError");

  await t.checkThrows(async () => (renderTemplate("question-text", { memo: "m", prompt: "p", learning: { sink: "guide" } })), "ZodError");
});

// ## A walk fixture box with a clock offset stamps `asked-at` on the box clock
void test("A walk fixture box with a clock offset stamps asked-at on the box clock", async (t) => {
  const savedTime = process.env["BBX_TIME"];
  delete process.env["BBX_TIME"];
  const box = await makeTmpBox();
  t.teardown(async () => {
    if (savedTime !== undefined) process.env["BBX_TIME"] = savedTime;
    await box.cleanup();
  });
  await box.write("_config/box.json", JSON.stringify({ timezone: "UTC", fakeNotifications: true }));
  await box.write(".beebox/clock-offset.json", JSON.stringify({ offsetMs: 604800000, setAt: "2026-10-23T00:00:00Z" }));

  const def = getTemplate("question-confirm");
  if (def === undefined) throw new Error("no template question-confirm");
  const content = def.generate(def.argsSchema.parse({ memo: "m", prompt: "p" }), { now: getBoxTime(box.root) });
  const askedAt = /asked-at: (\S+)/.exec(content)?.[1] ?? "";
  // A week ahead of real time, to the nearest hour.
  t.check(Math.round((Date.parse(askedAt) - Date.now()) / 3_600_000), 168);
});
