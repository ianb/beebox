// # Trigger evaluation in a child
//
// `bbx chat trigger eval-one` compiles a box's trigger file, imports it,
// calls `trigger`, and streams trace records. The parent keeps every record
// it received, so a child killed at the deadline still leaves its judge call
// behind, and a module that breaks the contract is an `error` naming the
// export. The judge runs through the fake (`BBX_JEV_FAKE`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate } from "@ianbicking/tap-check/check";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { evaluateInChild, inspectTrigger } from "../../../src/core/triggers/eval.js";
import { validateTriggerModule } from "../../../src/core/triggers/eval-child/module.js";
import type { EvalJob } from "../../../src/core/triggers/eval-child/core.js";
import type { ActivityLine } from "../../../src/core/activity/entry.js";

const WATER = `import type { TriggerContext, TriggerInput, TriggerResult } from "beebox/triggers";
export const tick = 60;
export function label(config: unknown): string { return "Water check (" + String((config as { target: string }).target) + ")"; }
export async function trigger(input: TriggerInput, ctx: TriggerContext): Promise<TriggerResult | null> {
  ctx.log("entries: " + String(input.entries.length) + ", history: " + String(input.history.length) + ", reason: " + input.reason);
  console.log("a stray print");
  const last = input.entries.at(-1);
  if (last === undefined) return null;
  const verdict = await ctx.judge({ instructions: "Is this water?", questions: { water: { type: "noul", instructions: "H2O?", criteria: { true: "yes", false: "no" } } }, state: last.activity });
  if ("kind" in verdict) return { text: "I could not check: " + verdict.reason };
  const answer = verdict.answers["water"];
  if (answer?.type === "noul" && answer.probability > 0.5) return { text: "That's water.", note: "judged " + String(answer.probability), done: true };
  return null;
}
`;

const line = (seq: number, activity: Record<string, unknown>): ActivityLine => ({
  seq, at: "2026-11-14T10:00:00.000Z", user: null, card: "Lab.figure.card", kind: "modified", chat: "s1", activity,
});

const job = (boxRoot: string, over: Partial<EvalJob>): EvalJob => ({
  boxRoot,
  file: "src/triggers/water.ts",
  config: { target: "H2O" },
  reason: "activity",
  entries: [line(1, { molecules: ["H2O"] })],
  history: [line(1, { molecules: ["H2O"] })],
  sinceLastActivityMs: 500,
  fires: 0,
  lastFireAt: null,
  armedAt: "2026-11-14T09:59:00.000Z",
  ...over,
});

void test("A trigger file is compiled, imported, judged through the fake, and its records streamed.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write("src/triggers/water.ts", WATER);
  process.env["BBX_JEV_FAKE"] = "1";
  t.teardown(() => { delete process.env["BBX_JEV_FAKE"]; });

  t.check(await inspectTrigger({ boxRoot: box.root, file: "src/triggers/water.ts", config: { target: "H2O" } }), { label: "Water check (H2O)", tick: 60 });

  const started = Date.now();
  const out = await evaluateInChild(job(box.root, {}));
  const coldMs = Date.now() - started;
  t.comment(`cold evaluation: ${String(coldMs)} ms`);
  t.check(out, {
    records: [
      { kind: "log", at: isoDate(), message: "entries: 1, history: 1, reason: activity" },
      { kind: "judge", at: isoDate(), questions: ["water"], verdict: { water: { type: "noul", probability: any(Number) } }, ms: any(Number) },
      { kind: "result", at: isoDate(), text: "That's water.", note: any(String), done: true },
      // The stray console.log went to stderr and is kept as a log record after the records proper.
      { kind: "log", at: isoDate(), message: "stderr: a stray print" },
    ],
    final: { kind: "result", at: isoDate(), text: "That's water.", note: any(String), done: true },
    ms: any(Number),
  });

  // A tick with nothing new returns none.
  const quiet = await evaluateInChild(job(box.root, { reason: "tick", entries: [] }));
  t.check(quiet.final, { kind: "none", at: isoDate() });

  // Unconfigured judge: the function sees `unavailable` and decides.
  delete process.env["BBX_JEV_FAKE"];
  const unjudged = await evaluateInChild(job(box.root, {}));
  t.check(unjudged.records.filter((r) => r.kind !== "log"), [
    { kind: "judge", at: isoDate(), questions: ["water"], verdict: { unavailable: "the box has no OpenRouter key granted" }, ms: any(Number) },
    { kind: "result", at: isoDate(), text: "I could not check: the box has no OpenRouter key granted" },
  ]);
});

void test("A module that breaks the contract or never returns is an error that keeps the records before it.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write("src/triggers/no-trigger.ts", "export function label() { return \"x\"; }\n");
  await box.write("src/triggers/loop.ts", `export function label() { return "Loop"; }
export async function trigger(input, ctx) { ctx.log("before the loop"); for (;;) {} }
`);
  await box.write("src/triggers/throws.ts", "export function label() { return \"T\"; }\nexport function trigger() { throw new Error(\"nope\"); }\n");
  await box.write("src/triggers/bad-result.ts", "export function label() { return \"B\"; }\nexport function trigger() { return { nope: 1 }; }\n");

  t.check(validateTriggerModule({ label: () => "x" }), { invalid: "the file exports no `trigger` function (export async function trigger(input, ctx): Promise<TriggerResult | null>)" });
  t.check(validateTriggerModule({ label: () => "x", trigger: () => null, tick: 5 }), { invalid: "`tick` must be a number of seconds, at least 10 (got 5)" });
  t.check(validateTriggerModule(null), { invalid: "the file has no exports (import type { TriggerModule } from \"beebox/triggers\")" });

  t.check(await inspectTrigger({ boxRoot: box.root, file: "src/triggers/no-trigger.ts", config: null }), { error: "src/triggers/no-trigger.ts: the file exports no `trigger` function (export async function trigger(input, ctx): Promise<TriggerResult | null>)" });
  t.check(await inspectTrigger({ boxRoot: box.root, file: "src/triggers/missing.ts", config: null }), { error: any(String).startsWith("compiling src/triggers/missing.ts failed: ") });

  const killed = await evaluateInChild(job(box.root, { file: "src/triggers/loop.ts" }), { timeoutMs: 3000 });
  t.check(killed.records, [
    { kind: "log", at: isoDate(), message: "before the loop" },
    { kind: "error", at: isoDate(), message: "stopped after 3 s: trigger() never returned (an endless loop, or an await that never settles?)" },
  ]);
  t.check((await evaluateInChild(job(box.root, { file: "src/triggers/throws.ts" }))).final, { kind: "error", at: isoDate(), message: "trigger() threw: nope" });
  t.check((await evaluateInChild(job(box.root, { file: "src/triggers/bad-result.ts" }))).final, { kind: "error", at: isoDate(), message: "trigger() returned something other than null or { text, note?, done? }" });
});
