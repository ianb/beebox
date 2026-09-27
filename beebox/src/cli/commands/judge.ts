/**
 * bbx judge — ask Jev a judgment card's questions about a state from stdin.
 *
 * One Jev call per state (`jev.judge`); one JSON line per state, `{ input,
 * answers }`. The decision is separate and basic (`core/judgment/decide.ts`):
 * `--min`, `--choice`, and `--decide` combine with AND; `--select` prints only
 * the inputs that passed; `--echo` passes stdin through when anything passed,
 * for a `pass-output` precheck that feeds an agent. The card's body is the
 * instructions, after the situation (`core/judgment/situation.ts`). See
 * docs/implemented-plans/notifications.md (Track D).
 *
 * Exit codes: 0 judged (or a dry run); 2 a bad card or flags; 75 deferred,
 * after writing `{ "reason" }` to `$BBX_DEFER_FILE` when set: `no-pass`
 * (nothing passed, under `--or-skip`), `unconfigured` (no OpenRouter key),
 * `budget` (the box's daily Jev cap), `jev-unavailable` (Jev failed or
 * answered badly). The last three keep a schedule's change cursor.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { errorMessage } from "../../lib/error-guards.js";
import { getBoxTime } from "../../lib/time.js";
import { resolveRefPath } from "../../shared/ref-path.js";
import { cardFields, parseCardText } from "../../core/card-io.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { JudgmentSchema, judgmentQuestions, type JudgmentFields } from "../../schemas/judgment.js";
import { CHECK_SKIP_CODE } from "../../core/procedure/shell.js";
import { MEMORY_ENV, readDeferMarker, writeDeferMarker } from "../../core/schedule/memory.js";
import type { DeferReason } from "../../core/schedule/defer-reason.js";
import { checkConditions, ConditionError, parseChoiceFlag, parseDecideFlag, parseMinFlag, passes, type Condition } from "../../core/judgment/decide.js";
import { resolveSituation, SituationRefError } from "../../core/judgment/situation.js";
import { reserveJevCalls } from "../../core/judgment/budget.js";
import { appendJevDebug, resolveJudgeService } from "../../core/judgment/service.js";
import { JevError } from "../../services/jev-wire.js";
import { serializeJudgeRequest, type JudgeInput, type JudgeResult } from "../../services/jev-judge.js";
import type { JevService } from "../../services/jev.js";
import { DEFAULT_MAX_BATCH, readStates, THIN_STATE_CHARS, type JudgedState } from "./judge-input.js";

export interface JudgeOptions {
  perLine?: boolean | undefined;
  cards?: boolean | undefined;
  min: string[];
  choice: string[];
  decide?: string | undefined;
  select?: boolean | undefined;
  orSkip?: boolean | undefined;
  echo?: boolean | undefined;
  dryRun?: boolean | undefined;
  replay?: string | undefined;
  maxBatch?: string | undefined;
}

class JudgeUsageError extends Error {
  constructor({ detail }: { detail: string }) {
    super(detail);
    this.name = "JudgeUsageError";
  }
}

function usage(detail: string): JudgeUsageError {
  return new JudgeUsageError({ detail });
}

function maxBatchOf(options: JudgeOptions): number {
  if (options.maxBatch === undefined) return DEFAULT_MAX_BATCH;
  const n = Number(options.maxBatch);
  if (!Number.isInteger(n) || n < 1) throw usage(`--max-batch must be a positive whole number (got "${options.maxBatch}")`);
  return n;
}

function conditionsOf(options: JudgeOptions): Condition[] {
  if (options.select === true && options.echo === true) throw usage("give --select or --echo, not both");
  if (options.cards === true && options.replay !== undefined) throw usage("--cards reads paths from stdin; --replay takes a saved state");
  return [
    ...options.min.map(parseMinFlag),
    ...options.choice.map(parseChoiceFlag),
    ...(options.decide === undefined ? [] : parseDecideFlag(options.decide)),
  ];
}

/** The judgment card at box-relative `cardPath`, validated. */
async function loadCard(boxRoot: string, cardPath: string): Promise<{ path: string; fields: JudgmentFields }> {
  const resolved = resolveRefPath({ fromPath: undefined, ref: cardPath, kind: "write-target" });
  if (resolved === null || !resolved.endsWith(".judgment.card")) throw usage(`${cardPath} is not a judgment card in the box (<name>.judgment.card)`);
  let text: string;
  try {
    text = await fs.readFile(path.join(boxRoot, resolved), "utf-8");
  } catch (e) {
    throw usage(`cannot read ${resolved}: ${errorMessage(e)}`);
  }
  try {
    const card = parseCardText(text, { source: resolved, schemas: await createCardSchemaMap(boxRoot) });
    return { path: resolved, fields: cardFields(card, JudgmentSchema) };
  } catch (e) {
    throw usage(`${resolved} is not a valid judgment card: ${errorMessage(e)}`);
  }
}

async function defer(reason: DeferReason, { env, detail }: { env: NodeJS.ProcessEnv; detail: string }): Promise<number> {
  const deferFile = env[MEMORY_ENV.deferFile];
  const written = deferFile === undefined || deferFile === "" || (await writeDeferMarker(deferFile, reason));
  // An earlier step's marker (`bbx changes --or-skip`) names the run's reason; say so rather than claim ours.
  console.error(written ? `bbx judge: deferred (${reason}): ${detail}` : `bbx judge: deferred: ${detail}; keeping the earlier reason in $${MEMORY_ENV.deferFile}`);
  return CHECK_SKIP_CODE;
}

/** Warn about each state under {@link THIN_STATE_CHARS}: without the body, answers sit near 50%. */
function warnThin(states: readonly JudgedState[]): void {
  for (const { input, state } of states) {
    if (state.length >= THIN_STATE_CHARS) continue;
    // Name a card path; a state that is its own input is not echoed back.
    const which = input === state ? "a state" : `the state for ${input.split("\n")[0] ?? ""}`;
    console.error(`bbx judge: warning: ${which} is ${String(state.length)} characters; a state without the body judges near 50%`);
  }
}

/**
 * No state on stdin: an upstream `bbx changes --or-skip` found nothing. No
 * call and no key are needed. When that step already wrote its marker, it
 * said why, and a second line would be noise: exit 75 silently.
 */
async function nothingToJudge({ env, orSkip }: { env: NodeJS.ProcessEnv; orSkip: boolean }): Promise<number> {
  if (!orSkip) return 0;
  const deferFile = env[MEMORY_ENV.deferFile];
  if (deferFile !== undefined && deferFile !== "" && (await readDeferMarker(deferFile)) !== null) return CHECK_SKIP_CODE;
  return defer("no-pass", { env, detail: "no state on stdin" });
}

interface JudgeRun {
  boxRoot: string;
  cardPath: string;
  options: JudgeOptions;
  /** The text read from stdin; ignored with `--replay`. */
  stdin: string;
  env: NodeJS.ProcessEnv;
  /** A service in place of the env fake or the box's key (tests). */
  jev?: JevService | undefined;
}

async function judgeAll(
  run: JudgeRun & { jev: JevService; fake: boolean; card: string; inputs: Array<JudgedState & { request: JudgeInput }>; conditions: Condition[] },
): Promise<{ results: Array<{ input: string; result: JudgeResult; passed: boolean }> } | { error: string }> {
  const results: Array<{ input: string; result: JudgeResult; passed: boolean }> = [];
  for (const { input, state, request } of run.inputs) {
    const at = getBoxTime(run.boxRoot).toISOString();
    const base = { at, card: run.card, input, state, ...(run.fake ? { fake: true } : {}) };
    let result: JudgeResult;
    try {
      result = await run.jev.judge(request);
    } catch (e) {
      if (!(e instanceof JevError)) throw e;
      await appendJevDebug(run.boxRoot, { ...base, error: e.message });
      return { error: e.message };
    }
    const passed = passes(run.conditions, result.answers);
    await appendJevDebug(run.boxRoot, { ...base, model: result.model, answers: result.answers, passed });
    results.push({ input, result, passed });
  }
  return { results };
}

async function runJudgeChecked(run: JudgeRun): Promise<number> {
  const { boxRoot, options, env } = run;
  const conditions = conditionsOf(options);
  const maxBatch = maxBatchOf(options);
  const card = await loadCard(boxRoot, run.cardPath);
  const questions = judgmentQuestions(card.fields);
  checkConditions(conditions, questions);
  const situation = await resolveSituation(boxRoot, { cardPath: card.path, situationRef: card.fields.situation?.ref });
  const text = options.replay === undefined ? run.stdin : await fs.readFile(path.resolve(options.replay), "utf-8");
  const read = await readStates(boxRoot, { text, perLine: options.perLine === true, cards: options.cards === true, maxBatch });
  if (!read.ok) throw usage(read.error);
  warnThin(read.states);
  const inputs = read.states.map((s) => ({
    ...s,
    request: { model: card.fields.model, situation: situation.text, instructions: card.fields.body.trim(), questions, state: s.state },
  }));
  if (options.dryRun === true) {
    console.log(`situation: ${situation.source}`);
    for (const { request } of inputs) console.log(serializeJudgeRequest(request));
    return 0;
  }
  if (inputs.length === 0) return nothingToJudge({ env, orSkip: options.orSkip === true });
  let jev = run.jev;
  let fake = false;
  if (jev === undefined) {
    const service = await resolveJudgeService(boxRoot, env);
    if (service.kind === "bad-fake") throw usage(`BBX_JEV_FAKE must be 1 (a confident yes) or 0 (a confident no), got "${service.value}"`);
    if (service.kind === "unconfigured") return defer("unconfigured", { env, detail: "the box has no OpenRouter key granted" });
    ({ jev, fake } = service);
  }
  if (!(await reserveJevCalls(boxRoot, { calls: inputs.length, now: getBoxTime(boxRoot) }))) {
    return defer("budget", { env, detail: `${String(inputs.length)} call(s) would pass the box's daily Jev cap` });
  }
  const judged = await judgeAll({ ...run, jev, fake, card: card.path, inputs, conditions });
  if ("error" in judged) return defer("jev-unavailable", { env, detail: judged.error });
  const anyPassed = judged.results.some((r) => r.passed);
  if (options.echo === true) {
    if (anyPassed) console.log(text.replace(/\n$/, ""));
  } else {
    for (const { input, result, passed } of judged.results) {
      if (options.select === true) {
        if (passed) console.log(input);
      } else {
        console.log(JSON.stringify({ input, answers: result.answers }));
      }
    }
  }
  if (!anyPassed && options.orSkip === true) return defer("no-pass", { env, detail: `none of ${String(judged.results.length)} state(s) passed` });
  return 0;
}

/** The command with the box, stdin, and environment given, returning the exit code. */
export async function runJudge(run: JudgeRun): Promise<number> {
  try {
    return await runJudgeChecked(run);
  } catch (e) {
    if (e instanceof JudgeUsageError || e instanceof ConditionError || e instanceof SituationRefError) {
      console.error(`Error: ${e.message}`);
      return 2;
    }
    throw e;
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf-8");
}

const collect = (value: string, previous: string[]): string[] => [...previous, value];

export const judgeCommand = new Command("judge")
  .description("Ask Jev a judgment card's questions about stdin and apply a basic decision")
  .argument("<card-path>", "Box-relative path of a <name>.judgment.card")
  .option("--per-line", "Judge each line of stdin as its own state")
  .option("--cards", "Each line of stdin is a card path; the state is the card's text")
  .option("--min <name=p>", "Pass when a noul's probability (or name.option's) is at least p (repeatable)", collect, [])
  .option("--choice <name=option>", "Pass when a choice question chose this option (repeatable)", collect, [])
  .option("--decide <json>", "Conditions as JSON: {\"name\": {\"min\": p, \"max\": p, \"is\": option}}")
  .option("--select", "Print only the inputs that passed, one per line")
  .option("--echo", "Print stdin unchanged when anything passed")
  .option("--or-skip", "Exit 75 when nothing passed, writing the reason to $BBX_DEFER_FILE when set")
  .option("--dry-run", "Print the situation used and the exact request(s); send nothing")
  .option("--replay <file>", "Read the state from this file instead of stdin")
  .option("--max-batch <n>", `Refuse a --cards batch over this many cards (default ${String(DEFAULT_MAX_BATCH)})`)
  .action(async (cardPath: string, options: JudgeOptions) => {
    try {
      const boxRoot = await requireBoxRoot();
      const stdin = options.replay === undefined ? await readStdin() : "";
      process.exit(await runJudge({ boxRoot, cardPath, options, stdin, env: process.env }));
    } catch (e) {
      console.error(`Error: ${errorMessage(e)}`);
      process.exit(1);
    }
  });
