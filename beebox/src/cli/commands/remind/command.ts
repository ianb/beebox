/**
 * bbx remind — the agent's one verb for coming back later.
 *
 * - `--here <duration>`: a check-in in this chat (at most 12h), `check-in.ts`.
 * - `--in <duration>` / `--at <datetime>`: a reminder card that reaches the
 *   person wherever they are, `reminder.ts`.
 * - `cancel <label>`: cancel this chat's check-in.
 *
 * Every form prints one line naming what it made and when, or refuses with
 * exit 1 and one sentence naming the fix. See docs/implemented-plans/bbx-remind.md.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../../lib/paths/core.js";
import { loadBoxTimezone } from "../../../core/box/config.js";
import { resolveChatSessionId } from "../../../core/chat/session/id-file.js";
import type { NotifyServices } from "../../../core/notify-boxholder.js";
import { errorMessage } from "../../../shared/error-guards.js";
import type { Result } from "../../../shared/result.js";
import type { BoxClientUnavailable } from "../../lib/box-client.js";
import { runCancelCheckIn, runCheckIn, serverCheckIns, type CheckInClient } from "./check-in.js";
import { runReminder } from "./reminder.js";

export interface RemindCliOptions {
  here?: string | undefined;
  in?: string | undefined;
  at?: string | undefined;
  body?: string | undefined;
  loudness?: string | undefined;
  context?: string | undefined;
  label?: string | undefined;
  alarm?: boolean | undefined;
  announce?: string | undefined;
}

export interface RemindRun {
  text: string;
  options: RemindCliOptions;
  sessionId: string | null;
  /** The server's check-in calls; a test passes a fake. */
  checkIns: Result<CheckInClient, BoxClientUnavailable>;
  /** Services for an in-process reachability check (tests). */
  services?: NotifyServices | undefined;
}

const REMINDER_ONLY = ["body", "loudness", "context"] as const;
const CHECK_IN_ONLY = ["label", "alarm", "announce"] as const;

/** The flags given for the other form, as `--flag` names. */
function strayFlags(options: RemindCliOptions, names: readonly (keyof RemindCliOptions)[]): string[] {
  return names.filter((name) => options[name] !== undefined).map((name) => `--${name}`);
}

/** The command's logic with `boxRoot` given, returning the exit code: the seam the tests drive. */
export async function runRemind(boxRoot: string, run: RemindRun): Promise<number> {
  const { options } = run;
  const text = run.text.trim();
  const here = options.here !== undefined;
  const stray = here
    ? [...strayFlags(options, REMINDER_ONLY), ...strayFlags(options, ["in", "at"])]
    : strayFlags(options, CHECK_IN_ONLY);
  if (stray.length > 0) {
    console.error(`Not set: ${stray.join(", ")} ${stray.length === 1 ? "does" : "do"} not apply ${here ? "to a check-in (--here)" : "to a reminder; add --here for a check-in in this chat"}.`);
    return 1;
  }
  if (text === "") {
    console.error(`Not set: give the ${here ? "check-in's text" : "reminder's title"} as the argument.`);
    return 1;
  }
  const zone = await loadBoxTimezone(boxRoot);
  if (options.here !== undefined) {
    return runCheckIn({
      request: { duration: options.here, text, label: options.label, alarm: options.alarm === true, announce: options.announce },
      sessionId: run.sessionId,
      client: run.checkIns,
      zone,
    });
  }
  return runReminder(boxRoot, {
    request: { title: text, in: options.in, at: options.at, body: options.body, loudness: options.loudness, context: options.context },
    zone,
    services: run.services,
  });
}

function exitWith(run: () => Promise<number>): Promise<void> {
  return run().then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(`Error: ${errorMessage(e)}`);
      process.exit(1);
    },
  );
}

const cancelCommand = new Command("cancel")
  .description("Cancel a check-in in this chat by its label (a reminder card is removed with bbx rm)")
  .argument("<label>", "The check-in's label")
  .action(async (label: string) =>
    exitWith(async () => runCancelCheckIn({ label, sessionId: await resolveChatSessionId(), client: serverCheckIns() })),
  );

export const remindCommand = new Command("remind")
  .description("Come back later: a check-in in this chat (--here), or a reminder that reaches the boxholder anywhere (--in/--at)")
  .argument("[text...]", "The reminder's title, or the check-in's text")
  .option("--here <duration>", "Check-in in this chat after this long (20m, 2h; at most 12h)")
  .option("--in <duration>", "Reminder after this long (20m, 3d, 2w)")
  .option("--at <datetime>", "Reminder at this time: YYYY-MM-DDTHH:MM in the box's timezone, or with an offset")
  .option("--body <text>", "Reminder: body text")
  .option("--loudness <loudness>", "Reminder: dot (iPhone badge only), quiet, or loud (default loud)")
  .option("--context <card>", "Reminder: a card path the notification links to")
  .option("--label <label>", "Check-in: its label (default: a slug of the text)")
  .option("--alarm", "Check-in: ring an alarm when it fires")
  .option("--announce <text>", "Check-in: text spoken aloud when it fires")
  .addCommand(cancelCommand)
  .action(async (words: string[], options: RemindCliOptions) =>
    exitWith(async () =>
      runRemind(await requireBoxRoot(), {
        text: words.join(" "),
        options,
        sessionId: options.here === undefined ? null : await resolveChatSessionId(),
        checkIns: serverCheckIns(),
      }),
    ),
  );
