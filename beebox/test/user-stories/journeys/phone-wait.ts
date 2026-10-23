/**
 * A wait on the walker's phone: the walk box lives through an interval of
 * simulated time, then its clock moves to the end of it.
 *
 * Every scheduled occurrence in the interval runs in time order, each as
 * `bbx tick --script <name>` at its own `BBX_TIME`, with fake channels forced
 * and the real channel keys removed. A `runs:` occurrence is read back from the
 * script's run state, since `bbx tick` exits 0 when it skipped or failed; its
 * jobs are drained (a failed job is reported, as the box records it), and the cards are listed again so a schedule it created is
 * run too. At the end the box wakes up once at the new time, and only then is
 * `.beebox/clock-offset.json` written. A wait that stops keeps its record in
 * `phone.json`, and the next `phone.ts` call resumes it: completed occurrences
 * are skipped, and one that was started but not finished is reported and not
 * run again, because its command may already have written or committed.
 * See docs/plans/walk-simulated-time.md (Track 7).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { cardFields, parseCardText } from "../../../src/core/card-io.ts";
import { readRecent } from "../../../src/core/notification/log.ts";
import { loadScriptState } from "../../../src/core/schedule/state.ts";
import { clockOffsetPath } from "../../../src/lib/time.ts";
import { createCardSchemaMap } from "../../../src/schemas.ts";
import { ScheduledScriptSchema, parseScheduledScript } from "../../../src/schemas/scheduled-script/schema.tsx";
import { errorMessage } from "../../../src/shared/error-guards.ts";
import { firedFor, occurrenceKey, planWait, type Occurrence, type ScheduleCard } from "./phone-core.ts";

const BBX = resolve(import.meta.dirname, "../../../bin/bbx");
const SCHEDULES = join("_config", "schedules");
const CARD_SUFFIX = ".scheduled-script.card";
const ALL_DAYS = 3650;
const COMMAND_TIMEOUT_MS = 15 * 60_000;
/** Real channels read these; a tick from the phone must not have them. */
const STRIPPED_ENV = /^(BBX_APNS_|BBX_VAPID_)|^(BBX_SERVER_URL|BBX_BOX_NAME|BBX_AGENT_TOKEN|BOX)$/u;

export interface WaitRecord {
  from: string;
  to: string;
  started: string[];
  done: string[];
}

export interface WaitOutcome {
  /** True when the box reached the end of the wait and its clock moved. */
  finished: boolean;
  /** Lines for the phone, before the notifications. */
  lines: string[];
}

class WaitStepError extends Error {
  /** The occurrence the box confirmed did not run: the wait forgets it started, so a resume runs it. */
  readonly notRun: string | undefined;
  constructor(message: string, opts?: { notRun?: string }) {
    super(message);
    this.name = "WaitStepError";
    this.notRun = opts?.notRun;
  }
}

/** What a wait found along the way, reported before the notifications. */
interface Findings {
  unreadable: string[];
  interrupted: string[];
  failed: string[];
  deferred: string[];
  noRecord: string[];
}

async function readScheduleCards(box: string): Promise<{ cards: ScheduleCard[]; unreadable: string[] }> {
  const dir = join(box, SCHEDULES);
  if (!existsSync(dir)) return { cards: [], unreadable: [] };
  const schemas = await createCardSchemaMap(box);
  const cards: ScheduleCard[] = [];
  const unreadable: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(CARD_SUFFIX)).toSorted()) {
    const name = file.slice(0, -CARD_SUFFIX.length);
    try {
      const card = parseCardText(readFileSync(join(dir, file), "utf8"), { source: file, schemas });
      const parsed = parseScheduledScript(cardFields(card, ScheduledScriptSchema));
      cards.push({
        name,
        kind: parsed.action.kind === "notify" ? "notify" : "runs",
        enabled: parsed.enabled,
        at: parsed.at,
        cron: parsed.cron,
        rrule: parsed.rrule,
        until: parsed.until,
      });
    } catch (e) {
      unreadable.push(`${name}: ${errorMessage(e)}`);
    }
  }
  return { cards, unreadable };
}

function envAt(at: Date): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!STRIPPED_ENV.test(key)) env[key] = value;
  }
  return { ...env, BBX_NOTIFY_FAKE: "1", BBX_TIME: at.toISOString() };
}

/** Run `bbx` in the box at a simulated time; returns its output, and whether it exited 0. */
function bbx(box: string, opts: { args: string[]; at: Date }): { ok: boolean; output: string } {
  try {
    const output = execFileSync(BBX, opts.args, {
      cwd: box, env: envAt(opts.at), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: COMMAND_TIMEOUT_MS,
    });
    return { ok: true, output };
  } catch (e) {
    const out = e instanceof Error && "stdout" in e && "stderr" in e ? `${String(e.stdout)}${String(e.stderr)}` : "";
    return { ok: false, output: `${out}${errorMessage(e)}` };
  }
}

/** The first line of a command's output that says what went wrong. */
function firstLine(output: string): string {
  const lines = output.split("\n").map((l) => l.trim());
  return lines.find((l) => /^(error|✗)|failed|not logged in/iu.test(l) && !/\b0 errors\b/u.test(l)) ?? lines.find((l) => l !== "") ?? "";
}

/**
 * `bbx reactor`, as the field-test day advance drains (`src/field-test/run/pre-actions.ts`).
 * A failed job is the box's own failure, recorded as it would be on any day,
 * so it is reported and the wait goes on.
 */
function drain(box: string, opts: { at: Date; failed: string[] }): void {
  const result = bbx(box, { args: ["reactor", "--max-cycles", "5"], at: opts.at });
  if (!result.ok) opts.failed.push(`jobs at ${opts.at.toISOString()}: ${firstLine(result.output)}`);
}

/** The box time a tick of `o` runs at: a second past the due time, as the scheduler sees it come due. */
function tickTime(o: Occurrence): Date {
  return new Date(o.at.getTime() + 1000);
}

async function runOccurrence(box: string, opts: { o: Occurrence; found: Findings }): Promise<void> {
  const { o, found } = opts;
  const { failed, noRecord } = found;
  const at = tickTime(o);
  const seen = new Set((await readRecent(box, { days: ALL_DAYS, now: at })).map((n) => n.intent.id));
  // `--force` for `runs:`: an open chat would otherwise defer it; liveness gates still apply.
  const result = bbx(box, { args: ["tick", "--script", o.name, ...(o.kind === "runs" ? ["--force"] : [])], at });
  if (o.kind === "notify") {
    if (firedFor(await readRecent(box, { days: ALL_DAYS, now: at }), { seen, name: o.name }) === undefined) {
      noRecord.push(`${occurrenceKey(o)}:\n${result.output.trim() || "the tick did not run it (not due by the card's own run record)"}`);
    }
    return;
  }
  const state = await loadScriptState(box, o.name);
  if (state.lastRun === null || Date.parse(state.lastRun) < o.at.getTime()) {
    throw new WaitStepError(`${occurrenceKey(o)} did not run:\n${result.output.trim()}`, { notRun: occurrenceKey(o) });
  }
  if (state.lastResult === "failure") failed.push(`${occurrenceKey(o)}: ${firstLine(state.lastError ?? "failed")}`);
  // Often "nothing to do"; a real box records it the same way and runs the card again next time.
  if (state.lastResult === "deferred") found.deferred.push(`${occurrenceKey(o)}: ${state.lastDeferReason ?? "deferred"}`);
  drain(box, { at, failed });
}

function refusal(refused: string[]): WaitStepError {
  return new WaitStepError(`these come due too often for one wait:\n${refused.map((r) => `- ${r}`).join("\n")}`);
}

function saveRecord(statePath: string, opts: { shown: string[]; wait: WaitRecord | null }): void {
  const data = opts.wait === null ? { shown: opts.shown } : { shown: opts.shown, wait: opts.wait };
  writeFileSync(statePath, `${JSON.stringify(data, null, 2)}\n`);
}

/** Live through `record`'s interval (fresh or resumed), then move the box clock to its end. */
export async function runWait(box: string, opts: { record: WaitRecord; statePath: string; shown: string[] }): Promise<WaitOutcome> {
  const { record, statePath, shown } = opts;
  const from = new Date(record.from);
  const to = new Date(record.to);
  let end = to;
  const interrupted = record.started.filter((k) => !record.done.includes(k));
  for (const k of interrupted) record.done.push(k);
  const { cards, unreadable } = await readScheduleCards(box);
  const found: Findings = { unreadable, interrupted, failed: [], deferred: [], noRecord: [] };
  const plan = planWait(cards, { from, to });
  if (plan.refused.length > 0 && record.started.length === 0) {
    return { finished: false, lines: ["The wait did not start; these come due too often for one wait:", ...plan.refused.map((r) => `- ${r}`)] };
  }
  let queue = plan.queue.filter((o) => !record.done.includes(occurrenceKey(o)));
  saveRecord(statePath, { shown, wait: record });
  try {
    if (plan.refused.length > 0) throw refusal(plan.refused);
    for (let o = queue.shift(); o !== undefined; o = queue.shift()) {
      record.started.push(occurrenceKey(o));
      saveRecord(statePath, { shown, wait: record });
      await runOccurrence(box, { o, found });
      // The wait ends no earlier than its last tick, so nothing it sent is stamped after the box's new now.
      if (tickTime(o).getTime() > end.getTime()) end = tickTime(o);
      record.done.push(occurrenceKey(o));
      saveRecord(statePath, { shown, wait: record });
      if (o.kind !== "runs") continue;
      // A run can create, edit, or remove schedules: the rest of the wait is planned
      // again from the cards as they are now.
      const replan = planWait((await readScheduleCards(box)).cards, { from: o.at, to });
      if (replan.refused.length > 0) throw refusal(replan.refused);
      queue = replan.queue.filter((n) => !record.done.includes(occurrenceKey(n)));
    }
    const wake = bbx(box, { args: ["engine", "wakeup", "--skip-push"], at: end });
    if (!wake.ok) found.failed.push(`waking the box at ${end.toISOString()}: ${firstLine(wake.output)}`);
    drain(box, { at: end, failed: found.failed });
  } catch (e) {
    if (!(e instanceof WaitStepError)) throw e;
    if (e.notRun !== undefined) {
      record.started = record.started.filter((k) => k !== e.notRun);
      saveRecord(statePath, { shown, wait: record });
    }
    return {
      finished: false,
      lines: [...describe(found), `The wait stopped: ${e.message}`, "Fix the cause, then run phone.ts again (without --wait) to resume it.", ""],
    };
  }
  const offsetPath = clockOffsetPath(box);
  mkdirSync(dirname(offsetPath), { recursive: true });
  writeFileSync(offsetPath, `${JSON.stringify({ offsetMs: Math.max(0, end.getTime() - Date.now()), setAt: new Date().toISOString() })}\n`);
  saveRecord(statePath, { shown, wait: null });
  return { finished: true, lines: describe(found) };
}

function describe(found: Findings): string[] {
  const section = (title: string, items: string[]): string[] => (items.length === 0 ? [] : [title, ...items.map((i) => `- ${i}`), ""]);
  return [
    ...section("Could not read these schedules:", found.unreadable),
    ...section("Cut off by an earlier stop, and not run again:", found.interrupted),
    ...section("Ran and failed (the box records it, as it would any failed run):", found.failed),
    ...section("Ran and held itself back (the box records why):", found.deferred),
    ...section("No record of these reaching the phone:", found.noRecord),
  ];
}
