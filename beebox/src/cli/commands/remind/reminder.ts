/**
 * `bbx remind --in|--at`: write a reminder card and commit it.
 *
 * The card is the reminder shape the scheduler already sends
 * (`schemas/scheduled-script/instructions.ts`, "Example: a reminder"): `at`
 * with an explicit offset, `once: true`, `requested-by: boxholder`, and
 * `notify:`. Each reminder gets a fresh filename: scheduler state is keyed by
 * the filename stem, and an `at` card is due only while it has never run, so a
 * reused name would inherit a finished reminder's state and never fire.
 *
 * Refused before anything is written: a bad or past time, a `--context` card
 * that does not exist, and a box no channel can reach at the card's loudness.
 * A written card whose commit fails is still active, so that exits 0 with a
 * warning that says not to recreate it.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { createScheduledScriptTemplate } from "../../../schemas/scheduled-script/schema.js";
import type { ScheduleNotify } from "../../../scheduled-script-fields.js";
import { channelsToTry } from "../../../core/notification/channels.js";
import { LOUDNESS, type Loudness } from "../../../core/notification/intent.js";
import type { ChannelFlags, NotifyServices } from "../../../core/notify-boxholder.js";
import { stageAndCommitPaths } from "../../../lib/git/core/operations.js";
import { getBoxTime } from "../../../lib/time.js";
import { errnoCode, errorMessage } from "../../../shared/error-guards.js";
import { err, ok, type Result } from "../../../shared/result.js";
import { channelReach, notifyRoute } from "../../lib/notify-route.js";
import { formatCardAt, formatDate, formatWhen, resolveReminderTime } from "./time.js";

const SCHEDULES_DIR = "_config/schedules";
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const SUFFIX_LENGTH = 6;
const MAX_NAME_ATTEMPTS = 8;
const MAX_SLUG_LENGTH = 40;

export interface ReminderRequest {
  title: string;
  in: string | undefined;
  at: string | undefined;
  body: string | undefined;
  loudness: string | undefined;
  context: string | undefined;
}

/** Lowercase words joined by hyphens, cut at a word boundary: the readable part of a filename or label. */
export function textSlug(text: string, maxLength: number): string {
  const words = text.toLowerCase().normalize("NFKD").replace(/[^\da-z]+/g, " ").trim().split(" ").filter((w) => w !== "");
  let slug = "";
  for (const word of words) {
    const next = slug === "" ? word : `${slug}-${word}`;
    if (next.length > maxLength) break;
    slug = next;
  }
  return slug === "" ? (words[0] ?? "").slice(0, maxLength) : slug;
}

/** `_config/schedules/remind-<slug>-<suffix>.scheduled-script.card`. */
function reminderCardPath(title: string, suffix: string): string {
  const slug = textSlug(title, MAX_SLUG_LENGTH);
  return `${SCHEDULES_DIR}/remind-${slug === "" ? "" : `${slug}-`}${suffix}.scheduled-script.card`;
}

function randomSuffix(): string {
  return [...randomBytes(SUFFIX_LENGTH)].map((b) => BASE32[b % BASE32.length]).join("");
}

/**
 * The loudness the scheduler sends at: the card's own, else `loud`, because
 * the card says `requested-by: boxholder` (`core/schedule/run-action.ts`).
 */
function effectiveLoudness(loudness: Loudness | undefined): Loudness {
  return loudness ?? "loud";
}

/**
 * Whether any channel would carry a send at `loudness`. Presence is taken as
 * nobody: who is in the app when the reminder fires is unknown now, and a
 * `quiet` send held back for a present person still reaches them.
 */
function reachableAt(loudness: Loudness, reach: ChannelFlags): boolean {
  const audience = { apns: reach.apns, "web-push": reach.webPush };
  return channelsToTry({ intent: { loudness }, audience, presence: { activeWeb: 0 } }).channels.length > 0;
}

function unreachable(loudness: Loudness, reach: ChannelFlags): string {
  if (loudness === "dot" && reach.webPush) {
    return "A dot only badges the iPhone app, and no iPhone is paired with this box; use --loudness quiet or loud, or pair the iPhone app in Admin → Host → Notifications";
  }
  return `No notification channel can reach the boxholder at loudness ${loudness}; turn one on in Admin → Host → Notifications, then set the reminder`;
}

function pickLoudness(value: string | undefined): Result<Loudness | undefined> {
  if (value === undefined) return ok(undefined);
  const found = LOUDNESS.find((l) => l === value);
  return found === undefined ? err(`--loudness must be one of ${LOUDNESS.join(", ")} (got "${value}")`) : ok(found);
}

async function checkContext(boxRoot: string, context: string | undefined): Promise<Result<void>> {
  if (context === undefined) return ok(undefined);
  try {
    await fs.access(path.join(boxRoot, context));
    return ok(undefined);
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e;
    return err(`--context ${context} does not exist; give the path of a card in this box (_content/…)`);
  }
}

/** Write `content` under a fresh name, never over an existing card. Returns the box-relative path. */
async function writeFresh(boxRoot: string, opts: { title: string; content: string }): Promise<string> {
  await fs.mkdir(path.join(boxRoot, SCHEDULES_DIR), { recursive: true });
  for (let attempt = 1; ; attempt++) {
    const rel = reminderCardPath(opts.title, randomSuffix());
    try {
      await fs.writeFile(path.join(boxRoot, rel), opts.content, { flag: "wx" });
      return rel;
    } catch (e) {
      if (errnoCode(e) !== "EEXIST" || attempt >= MAX_NAME_ATTEMPTS) throw e;
    }
  }
}

/** Create the reminder; returns the exit code. */
export async function runReminder(boxRoot: string, opts: { request: ReminderRequest; zone: string | null; services: NotifyServices | undefined }): Promise<number> {
  const { request, zone, services } = opts;
  const refuse = (message: string): number => {
    console.error(`Not set: ${message}.`);
    return 1;
  };
  const now = getBoxTime(boxRoot);
  const when = resolveReminderTime({ in: request.in, at: request.at, now, zone });
  if (!when.ok) return refuse(when.error);
  const loudness = pickLoudness(request.loudness);
  if (!loudness.ok) return refuse(loudness.error);
  const context = await checkContext(boxRoot, request.context);
  if (!context.ok) return refuse(context.error);
  const reach = await channelReach(boxRoot, { route: notifyRoute(), services });
  const sendAt = effectiveLoudness(loudness.value);
  if (!reachableAt(sendAt, reach)) return refuse(unreachable(sendAt, reach));

  const notify: ScheduleNotify = {
    title: request.title,
    ...(request.body === undefined ? {} : { body: request.body }),
    ...(loudness.value === undefined ? {} : { loudness: loudness.value }),
    target: "chat:new",
    ...(request.context === undefined ? {} : { context: request.context }),
  };
  const content = createScheduledScriptTemplate({
    at: formatCardAt(when.value, zone),
    once: true,
    requestedBy: "boxholder",
    reason: `Asked for in chat on ${formatDate(now, zone)}`,
    notify,
  });
  const rel = await writeFresh(boxRoot, { title: request.title, content });
  console.log(`Reminder scheduled for ${formatWhen(when.value, zone)}: "${request.title}" (${rel})`);
  console.log(`To cancel it, remove the card: bbx rm ${rel}`);
  try {
    await stageAndCommitPaths(boxRoot, { paths: [rel], message: `Reminder: ${request.title}`, trailers: { "Created-By": "bbx remind" } });
  } catch (e) {
    console.error(`Reminder is active (${rel}); the commit failed: ${errorMessage(e)}. Do not recreate it.`);
  }
  return 0;
}
