/**
 * `bbx remind --here` and `bbx remind cancel`: a check-in in the current chat.
 *
 * The timers live in the `bbx serve` process (`ChatScheduleManager`), so both
 * forms ask the box server through `chat.addCheckIn` / `chat.cancelCheckIn`,
 * scoped to this chat's session so a cancel never hits another chat's
 * same-label check-in. Refused locally before any call: no chat session, a
 * malformed duration, or one over the 12 h cap (a reminder's job).
 */

import { TRPCClientError } from "@trpc/client";
import { CHECK_IN_MAX_MS } from "../../../core/chat/schedules/core.js";
import { parseDuration } from "../../../scheduled-script-duration.js";
import { isRecord } from "../../../shared/is-record.js";
import { errorMessage } from "../../../shared/error-guards.js";
import type { Result } from "../../../shared/result.js";
import { boxClient, type BoxClientUnavailable } from "../../lib/box-client.js";
import { textSlug } from "./reminder.js";
import { formatClock } from "./time.js";

export interface CheckInInput {
  sessionId: string;
  in: string;
  label: string;
  alarm: boolean;
  announce: string | null;
  content: string;
}

/** The two server calls, as a seam a test can replace. */
export interface CheckInClient {
  add: (input: CheckInInput) => Promise<{ id: string; label: string; firesAt: string }>;
  cancel: (input: { sessionId: string; label: string }) => Promise<{ ok: boolean }>;
}

export function serverCheckIns(): Result<CheckInClient, BoxClientUnavailable> {
  const client = boxClient();
  if (!client.ok) return client;
  const trpc = client.value;
  return {
    ok: true,
    value: {
      add: async (input) => trpc.chat.addCheckIn.mutate(input),
      cancel: async (input) => trpc.chat.cancelCheckIn.mutate(input),
    },
  };
}

export interface CheckInRequest {
  duration: string;
  text: string;
  label: string | undefined;
  alarm: boolean;
  announce: string | undefined;
}

const MAX_LABEL_LENGTH = 24;
const NO_SESSION =
  "this shell is not in a chat (no BBX_CHAT_SESSION_ID), and a check-in comes back to the chat that set it; for a reminder that reaches the person anywhere, use --in or --at without --here";

function refuse(message: string): number {
  console.error(`Not set: ${message}.`);
  return 1;
}

function trpcCode(e: unknown): string | undefined {
  if (!(e instanceof TRPCClientError) || !isRecord(e.data)) return undefined;
  const code = e.data["code"];
  return typeof code === "string" ? code : undefined;
}

/** Whether the check-in's duration is acceptable before asking the server; the refusal sentence if not. */
function checkInDurationProblem(duration: string): string | null {
  let ms: number;
  try {
    ms = parseDuration(duration.trim());
  } catch (_e) {
    // One error class for every malformed duration; the sentence below names the forms.
    return `--here "${duration}" is not a duration; use a number and a unit s, m, or h (20m, 2h)`;
  }
  if (ms <= 0) return `--here ${duration} is not in the future; give a positive duration`;
  if (ms > CHECK_IN_MAX_MS) {
    return `a check-in can be at most 12h (asked for ${duration}); for longer, set a reminder with bbx remind --in ${duration} (without --here)`;
  }
  return null;
}

/** Set a check-in; returns the exit code. */
export async function runCheckIn(opts: {
  request: CheckInRequest;
  sessionId: string | null;
  client: Result<CheckInClient, BoxClientUnavailable>;
  zone: string | null;
}): Promise<number> {
  const { request, sessionId, client, zone } = opts;
  if (sessionId === null) return refuse(NO_SESSION);
  const problem = checkInDurationProblem(request.duration);
  if (problem !== null) return refuse(problem);
  if (!client.ok) return refuse(client.error.message.replace(/\.$/, ""));
  const label = request.label ?? textSlug(request.text, MAX_LABEL_LENGTH);
  try {
    const set = await client.value.add({
      sessionId,
      in: request.duration.trim(),
      label: label === "" ? "check-in" : label,
      alarm: request.alarm,
      announce: request.announce ?? null,
      content: request.text,
    });
    console.log(`Check-in "${set.label}" in ${request.duration.trim()} (${formatClock(new Date(set.firesAt), zone)}), this chat.`);
    return 0;
  } catch (e) {
    const code = trpcCode(e);
    if (code === "NOT_FOUND") return refuse("this chat is ending or was deleted, so a check-in cannot come back to it; set a reminder with --in or --at instead");
    if (code === "BAD_REQUEST") return refuse(errorMessage(e).replace(/\.$/, ""));
    throw e;
  }
}

/** Cancel this chat's check-in by label; returns the exit code. */
export async function runCancelCheckIn(opts: {
  label: string;
  sessionId: string | null;
  client: Result<CheckInClient, BoxClientUnavailable>;
}): Promise<number> {
  const { label, sessionId, client } = opts;
  if (sessionId === null) {
    console.error("Not cancelled: this shell is not in a chat (no BBX_CHAT_SESSION_ID); a reminder card is removed with bbx rm <card path>.");
    return 1;
  }
  if (!client.ok) {
    console.error(`Not cancelled: ${client.error.message}`);
    return 1;
  }
  const result = await client.value.cancel({ sessionId, label });
  if (!result.ok) {
    console.error(`Not cancelled: no check-in labeled "${label}" in this chat; a reminder card is removed with bbx rm <card path>.`);
    return 1;
  }
  console.log(`Cancelled check-in "${label}" in this chat.`);
  return 0;
}
