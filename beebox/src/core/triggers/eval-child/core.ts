/**
 * The child half of a trigger evaluation (`bbx chat trigger eval-one`): read
 * one job from stdin, compile the trigger file for node, import it, validate
 * its exports, build `ctx`, call `trigger`, and write trace records to stdout
 * as JSON lines as they happen: every `ctx.log`, every judge call with its
 * verdict, then one `result`, `none` or `error` record last. The parent
 * (`eval.ts`) keeps every record it received, so a child killed at the
 * deadline still leaves its judge calls behind.
 *
 * Before the module is imported, `console.*` is pointed at stderr so a
 * trigger's own printing cannot sit between records. With `--inspect` the
 * command only imports the module and prints `{ label, tick }` for arming.
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { bundleView } from "../../../webapp/views/compiler/compile.js";
import { getBoxTime } from "../../../lib/time.js";
import { errorMessage } from "../../../shared/error-guards.js";
import { isRecord } from "../../../shared/is-record.js";
import { resolveRefPath } from "../../../shared/ref-path/core.js";
import { cardFields, parseCardText } from "../../card-io.js";
import { createCardSchemaMap } from "../../../schemas.js";
import { JudgmentSchema, judgmentQuestions } from "../../../schemas/judgment/schema.js";
import { resolveSituation } from "../../judgment/situation.js";
import { reserveJevCalls } from "../../judgment/budget.js";
import { appendJevDebug, resolveJudgeService } from "../../judgment/service.js";
import type { JudgeInput } from "../../../services/jev-judge.js";
import { activityLineSchema } from "../../activity/entry.js";
import { validateTriggerModule } from "./module.js";
import type { TraceRecord } from "../trace.js";
import type { TriggerContext, TriggerInput, TriggerJudgeInput, TriggerJudgeResult, TriggerModule, TriggerResult } from "../types.js";

/** What the parent hands the child on stdin. */
export const evalJobSchema = z.object({
  boxRoot: z.string(),
  /** Box-relative path of the trigger file. */
  file: z.string(),
  config: z.unknown(),
  reason: z.enum(["activity", "tick"]),
  entries: z.array(activityLineSchema),
  history: z.array(activityLineSchema),
  sinceLastActivityMs: z.number().nullable(),
  fires: z.number().int().nonnegative(),
  lastFireAt: z.string().nullable(),
  armedAt: z.string(),
  dryRun: z.boolean().optional(),
});
export type EvalJob = z.infer<typeof evalJobSchema>;

/** `--inspect`: the module's label for a config, and its tick. */
export const inspectJobSchema = z.object({ boxRoot: z.string(), file: z.string(), config: z.unknown() });
export type InspectJob = z.infer<typeof inspectJobSchema>;
export const inspectResultSchema = z.union([
  z.object({ label: z.string(), tick: z.number().optional() }),
  z.object({ error: z.string() }),
]);
export type InspectResult = z.infer<typeof inspectResultSchema>;

function now(boxRoot: string): string {
  return getBoxTime(boxRoot).toISOString();
}

function writeRecord(record: TraceRecord): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

/** Route the trigger's own printing to stderr, so a stray line cannot hide a record. */
function consoleToStderr(): void {
  const write = (...args: unknown[]): void => {
    process.stderr.write(`${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`);
  };
  console.log = write;
  console.info = write;
  console.warn = write;
  console.error = write;
  console.debug = write;
}

/** Compile the trigger file for node into a temp module and import it. The temp file is removed after import. */
async function importTrigger(boxRoot: string, file: string): Promise<{ module: TriggerModule } | { error: string }> {
  const entry = path.join(boxRoot, file);
  let output: string;
  try {
    ({ output } = await bundleView(entry, { target: "node", cache: false }));
  } catch (e) {
    return { error: `compiling ${file} failed: ${errorMessage(e)}` };
  }
  const compiled = path.join(os.tmpdir(), `bbx-trigger-${String(process.pid)}-${randomBytes(4).toString("hex")}.mjs`);
  await fsp.writeFile(compiled, output);
  let imported: unknown;
  try {
    imported = await import(pathToFileURL(compiled).href);
  } catch (e) {
    return { error: `loading ${file} failed: ${errorMessage(e)}` };
  } finally {
    await fsp.rm(compiled, { force: true });
  }
  const checked = validateTriggerModule(imported);
  if ("invalid" in checked) return { error: `${file}: ${checked.invalid}` };
  return { module: checked.module };
}

async function judgeRequest(boxRoot: string, input: TriggerJudgeInput): Promise<{ request: JudgeInput; card?: string } | { error: string }> {
  if (!("card" in input)) return { request: input };
  const resolved = resolveRefPath({ fromPath: undefined, ref: input.card, kind: "write-target" });
  if (resolved === null || !resolved.endsWith(".judgment.card")) return { error: `${input.card} is not a judgment card in the box (<name>.judgment.card)` };
  try {
    const text = await fsp.readFile(path.join(boxRoot, resolved), "utf-8");
    const card = parseCardText(text, { source: resolved, schemas: await createCardSchemaMap(boxRoot) });
    const fields = cardFields(card, JudgmentSchema);
    const situation = await resolveSituation(boxRoot, { cardPath: resolved, situationRef: fields.situation?.ref });
    return {
      card: resolved,
      request: { model: fields.model, situation: situation.text, instructions: fields.body.trim(), questions: judgmentQuestions(fields), state: input.state },
    };
  } catch (e) {
    return { error: `${resolved}: ${errorMessage(e)}` };
  }
}

/** The `ctx.judge` the function calls: resolve, reserve, judge, record. Never throws. */
function makeJudge(job: EvalJob): TriggerContext["judge"] {
  return async (input): Promise<TriggerJudgeResult> => {
    const at = now(job.boxRoot);
    const started = Date.now();
    const prepared = await judgeRequest(job.boxRoot, input);
    const asked = { questions: "error" in prepared ? [] : Object.keys(prepared.request.questions), ...("error" in prepared || prepared.card === undefined ? {} : { card: prepared.card }) };
    const unavailable = (reason: string): TriggerJudgeResult => {
      writeRecord({ kind: "judge", at, ...asked, verdict: { unavailable: reason }, ms: Date.now() - started });
      return { kind: "unavailable", reason };
    };
    if ("error" in prepared) return unavailable(prepared.error);
    const service = await resolveJudgeService(job.boxRoot, process.env);
    if (service.kind === "unconfigured") return unavailable("the box has no OpenRouter key granted");
    if (service.kind === "bad-fake") return unavailable(`BBX_JEV_FAKE must be 1 or 0, got "${service.value}"`);
    if (!(await reserveJevCalls(job.boxRoot, { calls: 1, now: getBoxTime(job.boxRoot) }))) return unavailable("the box's daily Jev cap is reached");
    const log = { at, card: prepared.card ?? `trigger:${job.file}`, input: JSON.stringify(prepared.request), state: JSON.stringify(prepared.request.state), ...(service.fake ? { fake: true } : {}) };
    try {
      const result = await service.jev.judge(prepared.request);
      await appendJevDebug(job.boxRoot, { ...log, model: result.model, answers: result.answers });
      writeRecord({ kind: "judge", at, ...asked, verdict: result.answers, ms: Date.now() - started });
      return result;
    } catch (e) {
      await appendJevDebug(job.boxRoot, { ...log, error: errorMessage(e) });
      return unavailable(errorMessage(e));
    }
  };
}

function checkResult(value: unknown): TriggerResult | null | { error: string } {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || typeof value["text"] !== "string") return { error: "trigger() returned something other than null or { text, note?, done? }" };
  const note = value["note"];
  const done = value["done"];
  if (note !== undefined && typeof note !== "string") return { error: "trigger() returned a `note` that is not a string" };
  if (done !== undefined && typeof done !== "boolean") return { error: "trigger() returned a `done` that is not a boolean" };
  return { text: value["text"], ...(note === undefined ? {} : { note }), ...(done === undefined ? {} : { done }) };
}

/** Run one evaluation; the last stdout line is a `result`, `none` or `error` record. */
export async function runEvalChild(raw: unknown): Promise<void> {
  const parsed = evalJobSchema.safeParse(raw);
  const at = parsed.success ? now(parsed.data.boxRoot) : new Date().toISOString();
  if (!parsed.success) {
    writeRecord({ kind: "error", at, message: `eval-one: malformed job: ${parsed.error.message}` });
    return;
  }
  const job = parsed.data;
  consoleToStderr();
  const loaded = await importTrigger(job.boxRoot, job.file);
  if ("error" in loaded) {
    writeRecord({ kind: "error", at: now(job.boxRoot), message: loaded.error });
    return;
  }
  const input: TriggerInput = {
    reason: job.reason,
    entries: job.entries,
    history: job.history,
    sinceLastActivityMs: job.sinceLastActivityMs,
    fires: job.fires,
    lastFireAt: job.lastFireAt,
    armedAt: job.armedAt,
  };
  const ctx: TriggerContext = {
    config: job.config,
    boxRoot: job.boxRoot,
    reason: job.reason,
    judge: makeJudge(job),
    log: (message) => { writeRecord({ kind: "log", at: now(job.boxRoot), message: String(message) }); },
  };
  let returned: unknown;
  try {
    returned = await loaded.module.trigger(input, ctx);
  } catch (e) {
    writeRecord({ kind: "error", at: now(job.boxRoot), message: `trigger() threw: ${errorMessage(e)}` });
    return;
  }
  const result = checkResult(returned);
  if (result === null) writeRecord({ kind: "none", at: now(job.boxRoot) });
  else if ("error" in result) writeRecord({ kind: "error", at: now(job.boxRoot), message: result.error });
  else writeRecord({ kind: "result", at: now(job.boxRoot), ...result });
}

/** `--inspect`: import and print `{ label, tick }` or `{ error }` as the last stdout line. */
export async function runInspectChild(raw: unknown): Promise<void> {
  const parsed = inspectJobSchema.safeParse(raw);
  const print = (result: InspectResult): void => { process.stdout.write(`${JSON.stringify(result)}\n`); };
  if (!parsed.success) {
    print({ error: `eval-one --inspect: malformed job: ${parsed.error.message}` });
    return;
  }
  consoleToStderr();
  const loaded = await importTrigger(parsed.data.boxRoot, parsed.data.file);
  if ("error" in loaded) {
    print({ error: loaded.error });
    return;
  }
  try {
    const label = loaded.module.label(parsed.data.config);
    if (typeof label !== "string" || label.trim() === "") {
      print({ error: `${parsed.data.file}: label(config) must return a non-empty string` });
      return;
    }
    print({ label: label.trim(), ...(loaded.module.tick === undefined ? {} : { tick: loaded.module.tick }) });
  } catch (e) {
    print({ error: `${parsed.data.file}: label(config) threw: ${errorMessage(e)}` });
  }
}

/** The whole of stdin, parsed as JSON. */
export function readStdinJson(): unknown {
  return JSON.parse(fs.readFileSync(0, "utf8"));
}
