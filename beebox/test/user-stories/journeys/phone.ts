/**
 * The walker's phone: what the box sent the person, as text, in the box's time.
 *
 * Usage: pnpm exec tsx beebox/test/user-stories/journeys/phone.ts <run-dir> [--wait 1w]
 *
 * Without `--wait` it shows what reached the phone since the last look, and
 * resumes a wait that stopped. With `--wait`, the walk box lives through the
 * interval (phone-wait.ts) and its clock moves forward: the server, the agent,
 * commits, and the app's dates all read the later time. A walk box's
 * notifications are fake, so nothing reaches a real device.
 *
 * The notifications already shown and an unfinished wait live in
 * `<run-dir>/phone.json`; every look is appended to `<run-dir>/phone.md`.
 * See docs/plans/walk-simulated-time.md (Track 7).
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { readRecent } from "../../../src/core/notification/log.ts";
import { isWalkFixture } from "../../../src/lib/box-fixture.ts";
import { getBoxTime } from "../../../src/lib/time.ts";
import { errorMessage } from "../../../src/shared/error-guards.ts";
import { formatPhoneEntry, parseWait, reachedPerson } from "./phone-core.ts";
import { runWait, type WaitRecord } from "./phone-wait.ts";

/** Enough to read every notification a walk box ever logged. */
const ALL_DAYS = 3650;

const beforeSchema = z.object({ box: z.string(), url: z.string() });
// `now` was the walk clock before the box had one; it is read and ignored.
const stateSchema = z.object({
  now: z.string().optional(),
  shown: z.array(z.string()),
  wait: z.object({ from: z.string(), to: z.string(), started: z.array(z.string()), done: z.array(z.string()) }).optional(),
});
type PhoneState = z.infer<typeof stateSchema>;

function fail(message: string): never {
  console.error(`phone: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): { runDir: string; waitMs: number | null } {
  const [runDir, flag, value, ...rest] = argv;
  if (runDir === undefined || rest.length > 0) fail("usage: phone.ts <run-dir> [--wait <2d|36h|1w>]");
  if (flag === undefined) return { runDir, waitMs: null };
  if (flag !== "--wait" || value === undefined) fail(`unknown argument "${flag}"; usage: phone.ts <run-dir> [--wait <2d|36h|1w>]`);
  try {
    return { runDir, waitMs: parseWait(value) };
  } catch (e) {
    return fail(errorMessage(e));
  }
}

function readState(statePath: string): PhoneState {
  if (!existsSync(statePath)) return { shown: [] };
  const parsed = stateSchema.safeParse(JSON.parse(readFileSync(statePath, "utf8")));
  if (!parsed.success) fail(`${statePath} is not a phone state file: ${parsed.error.message}`);
  return parsed.data;
}

const { runDir, waitMs } = parseArgs(process.argv.slice(2));
const beforePath = join(runDir, "before.json");
if (!existsSync(beforePath)) fail(`${beforePath} not found; pass the run directory prepare printed`);
const before = beforeSchema.parse(JSON.parse(readFileSync(beforePath, "utf8")));
const box = before.box;
const boxSlug = new URL(before.url).pathname.split("/").findLast(Boolean) ?? fail(`no box in ${before.url}`);
const statePath = join(runDir, "phone.json");
const state = readState(statePath);

const lines: string[] = [];
let waited = false;
if (waitMs !== null && !isWalkFixture(box)) {
  fail(`${box} is not a walk fixture (no fakeNotifications in _config/box.json), so a wait cannot move its clock`);
}
if (waitMs !== null && state.wait !== undefined) {
  fail("an earlier wait has not finished; run phone.ts without --wait to resume it first");
}
const record: WaitRecord | null = state.wait
  ?? (waitMs === null ? null : (() => {
    const from = getBoxTime(box);
    return { from: from.toISOString(), to: new Date(from.getTime() + waitMs).toISOString(), started: [], done: [] };
  })());
if (record !== null) {
  if (state.wait !== undefined) lines.push(`Resuming the wait to ${record.to}.`, "");
  const outcome = await runWait(box, { record, statePath, shown: state.shown });
  lines.push(...outcome.lines);
  waited = outcome.finished;
}

const clock = getBoxTime(box);
const shown = new Set(state.shown);
// In the order they arrived: the log is in the order they were written, and a
// wait writes a reminder due earlier after one sent live during the walk.
const fresh = (await readRecent(box, { days: ALL_DAYS, now: clock }))
  // One stamped after the box's now has not arrived yet.
  .filter((n) => reachedPerson(n) && !shown.has(n.intent.id) && Date.parse(n.intent.at) <= clock.getTime())
  .toSorted((a, b) => Date.parse(a.intent.at) - Date.parse(b.intent.at));
const clockText = clock.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
if (fresh.length === 0) {
  lines.push(`Nothing new on your phone (it is ${clockText}).`);
} else {
  lines.push(`Your phone, ${clockText}: ${String(fresh.length)} new`, "");
  for (const n of fresh) {
    lines.push(formatPhoneEntry(n, { boxSlug }), "");
    shown.add(n.intent.id);
  }
}

const text = lines.join("\n").trimEnd();
console.log(text);
appendFileSync(join(runDir, "phone.md"), `## ${clockText}${waited ? " (after a wait)" : ""}\n\n${text}\n\n`);
// runWait saved the wait record (or cleared it); keep it, and add what was shown now.
const saved = readState(statePath);
appendShown(statePath, { saved, shown: [...shown] });

function appendShown(path: string, opts: { saved: PhoneState; shown: string[] }): void {
  const data = opts.saved.wait === undefined ? { shown: opts.shown } : { shown: opts.shown, wait: opts.saved.wait };
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}
