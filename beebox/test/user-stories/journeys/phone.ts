/**
 * The walker's phone: what the box sent the person, as text, in the walk's own time.
 *
 * Usage: pnpm exec tsx beebox/test/user-stories/journeys/phone.ts <run-dir> [--wait 1w]
 *
 * Without `--wait` it shows what reached the phone since the last look. With
 * `--wait`, the walk clock moves forward, and each one-shot `notify:` reminder
 * due by then fires at its own time: `bbx tick --script <name>` with `BBX_TIME`
 * set, fake channels forced, and the real channel keys removed, so nothing can
 * reach a real device. The box itself keeps real time, which is why the
 * walker prompt makes a wait the walk's last act.
 *
 * The walk clock and the notifications already shown live in
 * `<run-dir>/phone.json`; every look is appended to `<run-dir>/phone.md`.
 * See docs/plans/journey-simulated-notifications.md.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { cardFields, parseCardText } from "../../../src/core/card-io.ts";
import { readRecent, type LoggedNotification } from "../../../src/core/notification/log.ts";
import { createCardSchemaMap } from "../../../src/schemas.ts";
import { ScheduledScriptSchema, parseScheduledScript } from "../../../src/schemas/scheduled-script/schema.tsx";
import { errorMessage } from "../../../src/shared/error-guards.ts";
import { firedFor, formatPhoneEntry, parseWait, pendingReminders, reachedPerson, type ReminderCard } from "./phone-core.ts";

const BEEBOX = resolve(import.meta.dirname, "../../..");
const SCHEDULES = join("_config", "schedules");
const CARD_SUFFIX = ".scheduled-script.card";
/** Enough to read every notification a walk box ever logged. */
const ALL_DAYS = 3650;
/** Real channels read these; a tick from the phone must not have them. */
const STRIPPED_ENV = /^(BBX_APNS_|BBX_VAPID_)|^(BBX_SERVER_URL|BBX_BOX_NAME|BBX_AGENT_TOKEN|BOX)$/u;

const beforeSchema = z.object({ box: z.string(), url: z.string() });
const stateSchema = z.object({ now: z.string(), shown: z.array(z.string()) });
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
  const real = new Date().toISOString();
  if (!existsSync(statePath)) return { now: real, shown: [] };
  const parsed = stateSchema.safeParse(JSON.parse(readFileSync(statePath, "utf8")));
  if (!parsed.success) fail(`${statePath} is not a phone state file: ${parsed.error.message}`);
  // Before any wait, the walk clock is the real time.
  return { ...parsed.data, now: parsed.data.now > real ? parsed.data.now : real };
}

async function readReminderCards(box: string): Promise<{ cards: ReminderCard[]; unreadable: string[] }> {
  const dir = join(box, SCHEDULES);
  if (!existsSync(dir)) return { cards: [], unreadable: [] };
  const schemas = await createCardSchemaMap(box);
  const cards: ReminderCard[] = [];
  const unreadable: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(CARD_SUFFIX)).toSorted()) {
    const name = file.slice(0, -CARD_SUFFIX.length);
    try {
      const card = parseCardText(readFileSync(join(dir, file), "utf8"), { source: file, schemas });
      const parsed = parseScheduledScript(cardFields(card, ScheduledScriptSchema));
      cards.push({
        name,
        notify: parsed.action.kind === "notify",
        enabled: parsed.enabled,
        at: parsed.at,
        recurring: parsed.cron !== undefined || parsed.rrule !== undefined,
      });
    } catch (e) {
      unreadable.push(`${name}: ${errorMessage(e)}`);
    }
  }
  return { cards, unreadable };
}

function tickEnv(at: Date): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!STRIPPED_ENV.test(key)) env[key] = value;
  }
  return { ...env, BBX_NOTIFY_FAKE: "1", BBX_TIME: new Date(at.getTime() + 1000).toISOString() };
}

/** Run one tick of `name` at `at`; returns its output either way. */
function tick(box: string, opts: { name: string; at: Date }): string {
  try {
    return execFileSync("pnpm", ["--silent", "--dir", BEEBOX, "bbx", "tick", "--box", box, "--script", opts.name], {
      env: tickEnv(opts.at), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000,
    });
  } catch (e) {
    const out = e instanceof Error && "stdout" in e && "stderr" in e ? `${String(e.stdout)}${String(e.stderr)}` : "";
    return `${out}${errorMessage(e)}`;
  }
}

async function readAllNotifications(box: string, now: Date): Promise<LoggedNotification[]> {
  return readRecent(box, { days: ALL_DAYS, now });
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
if (waitMs !== null) {
  const to = new Date(new Date(state.now).getTime() + waitMs);
  const { cards, unreadable } = await readReminderCards(box);
  const { pending, notSimulated } = pendingReminders(cards, to);
  const heldBack: string[] = unreadable.map((u) => `could not read ${u}`);
  for (const reminder of pending) {
    const seen = new Set((await readAllNotifications(box, to)).map((n) => n.intent.id));
    const output = tick(box, reminder);
    if (firedFor(await readAllNotifications(box, to), { seen, name: reminder.name }) === undefined) {
      // A tick that found the card not due by its own run record prints nothing.
      const why = output.trim() === "" ? "the tick did not run it (not due by the card's own run record)" : output.trim();
      heldBack.push(`${reminder.name} (due ${reminder.at.toISOString()}):\n${why}`);
    }
  }
  state.now = to.toISOString();
  if (heldBack.length > 0) lines.push("No record of these reaching the phone:", ...heldBack.map((h) => `- ${h}`), "");
  if (notSimulated.length > 0) lines.push(`Not simulated (repeating reminders): ${notSimulated.join(", ")}`, "");
}

const clock = new Date(state.now);
const shown = new Set(state.shown);
// In the order they arrived: the log is in the order they were written, and a
// wait writes a reminder due earlier after one sent live during the walk.
const fresh = (await readAllNotifications(box, clock))
  .filter((n) => reachedPerson(n) && !shown.has(n.intent.id))
  .toSorted((a, b) => Date.parse(a.intent.at) - Date.parse(b.intent.at));
const clockText = clock.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
if (fresh.length === 0) {
  lines.push(`Nothing new on your phone (walk clock: ${clockText}).`);
} else {
  lines.push(`Your phone, ${clockText}: ${String(fresh.length)} new`, "");
  for (const n of fresh) {
    lines.push(formatPhoneEntry(n, { boxSlug }), "");
    shown.add(n.intent.id);
  }
}

const text = lines.join("\n").trimEnd();
console.log(text);
appendFileSync(join(runDir, "phone.md"), `## ${clockText}${waitMs === null ? "" : " (after a wait)"}\n\n${text}\n\n`);
writeFileSync(statePath, `${JSON.stringify({ now: state.now, shown: [...shown] }, null, 2)}\n`);
