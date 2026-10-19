/**
 * Firing a chat check-in (`ChatSchedule`) back into the session that created it.
 *
 * A check-in records the id of the session whose turn set it
 * (`schedule.sessionId`); when the timer fires we resume THAT session and
 * inject the reminder. A check-in never moves to another conversation: see
 * `fireChatSchedule`.
 *
 * The failed-turn signal is the session's existing `done` event: its payload
 * is the terminal `ChatMessageResult`, whose `is_error` distinguishes a
 * completed turn from the unresumable one. No new surface is needed — a run
 * that instead closes/errors without a result counts as a failed delivery too.
 */

import { ProviderSetupError } from "../../../core/provider-setup-error.js";
import { BoxMaintenanceError } from "../../../lib/box-maintenance-error.js";
import type { ChatSession } from "../../../core/chat/session/run/core.js";
import type { ChatMessageResult } from "../../../core/chat/session/messages.js";
import type { ChatSessionRegistry } from "../../../core/chat/session/registry/core.js";
import { chatHistorySlice } from "../../../core/chat/session/load-history.js";
import type { EventBus } from "../../../core/event-bus/core.js";
import type { ChatSchedule } from "../../../core/chat/schedules/core.js";
import { resolveSessionAvailability } from "../../../core/chat/session/availability.js";

export interface ScheduleFireDeps {
  boxRoot: string;
  registry: ChatSessionRegistry;
  eventBus: EventBus;
  /** Bridge a session's events onto the global bus (idempotent). */
  wireSession: (session: ChatSession) => void;
}

/** Compose the `<schedule-fired>` reminder injected into the target session. */
function buildFiredMessage(schedule: ChatSchedule): string {
  const firedAt = new Date().toISOString();
  return [
    `<schedule-fired label="${schedule.label}" scheduled-at="${schedule.createdAt}" fired-at="${firedAt}">`,
    schedule.content,
    "",
    `A scheduled timer "${schedule.label}" has fired. Respond if you have something useful to say.`,
    "</schedule-fired>",
  ].join("\n");
}

/**
 * Send the reminder into a session and wait for its turn to settle. Broadcasts
 * the refreshed history so the originating tab updates. Resolves true when the
 * turn completed without error; false when the send was rejected, the turn
 * ended with `is_error` (the unresumable case), or the run closed/errored
 * before a result.
 */
/**
 * How a fired turn ended. `refused` means the chat's model cannot run on this
 * box — removed in admin, or its provider key is gone — and is not retried
 * anywhere: scheduled messages are low priority, and sending one to a
 * different model in a fresh chat would change who answers (boxholder,
 * 2026-09-19: "if the model is removed the message goes nowhere").
 */
type FiredTurnOutcome = "delivered" | "failed" | "refused";

function sendFiredTurn(deps: { session: ChatSession; eventBus: EventBus; firedMessage: string }): Promise<FiredTurnOutcome> {
  const { session, eventBus, firedMessage } = deps;
  return new Promise<FiredTurnOutcome>((resolve, reject) => {
    let settled = false;
    const finish = (ok: FiredTurnOutcome): void => {
      if (settled) return;
      settled = true;
      session.removeListener("done", onDone);
      session.removeListener("close", onFail);
      session.removeListener("error", onFail);
      resolve(ok);
    };
    const onDone = (msg: ChatMessageResult): void => {
      // Broadcast the refreshed transcript so the originating tab refreshes,
      // exactly as the old onFire did — harmless even on an errored turn.
      // `fresh: true`: this read is happening BECAUSE the turn we're
      // broadcasting about just completed, so it must not join (and be
      // answered by) a scan that started before that completion.
      session
        .getHistory(chatHistorySlice(), { fresh: true })
        .then((history) => {
          eventBus.emit("chat-history", {
            sessionId: history.sessionId,
            entries: history.entries,
          });
        })
        .catch((e: unknown) => {
          // Degraded but recovered: the turn itself already settled; only the
          // tab-refresh broadcast is lost.
          console.warn("[schedule] Post-fire history broadcast failed:", e);
        }).finally(() => finish(msg.is_error === true ? "failed" : "delivered"));
    };
    // A run that closes or errors without a `done` (crash, or a refused resume
    // that never reaches a result) counts as a failed delivery, not a hang.
    const onFail = (error?: unknown): void => finish(error instanceof ProviderSetupError ? "refused" : "failed");
    session.once("done", onDone);
    session.once("close", onFail);
    session.once("error", onFail);
    void session.send({ text: firedMessage, clientComposed: true }).then((sent) => {
      if (!sent) finish("failed");
    }).catch((error: unknown) => {
      if (error instanceof BoxMaintenanceError) reject(error);
      else console.error("[schedule] Send failed:", error);
      finish("failed");
    });
  });
}

/**
 * Fire a chat check-in into the conversation that set it, and only there. A
 * check-in belongs to one conversation (boxholder, 2026-10-18: if the
 * conversation ends, the check-in ends), so it is dropped, with a warning,
 * when it has no owner (a legacy entry), when that chat is being deleted or
 * can no longer be resumed (an archived chat cannot), or when its turn fails.
 * The target is checked before the alarm/TTS broadcast, so a dropped check-in
 * stays silent.
 */
export async function fireChatSchedule(deps: ScheduleFireDeps, schedule: ChatSchedule): Promise<void> {
  const { boxRoot, registry, eventBus, wireSession } = deps;
  const drop = (why: string): void => { console.warn(`[schedule] Dropping check-in "${schedule.label}": ${why}`); };
  const targetId = schedule.sessionId;
  if (targetId === undefined) return drop("it predates per-conversation check-ins and has no conversation");
  if (registry.deletion.isBlocked(targetId)) return;
  const availability = await resolveSessionAvailability({ boxRoot, sessionId: targetId, registry });
  if (availability.kind === "unavailable") return drop(`conversation ${targetId} cannot be resumed (${availability.reason})`);

  eventBus.emit("schedule-fired", {
    id: schedule.id,
    label: schedule.label,
    alarm: schedule.alarm,
    announce: schedule.announce,
  });

  const target = registry.getOrCreate(targetId);
  wireSession(target);
  registry.enforceLiveCap(targetId);
  registry.touch(targetId, { subprocessUse: true });
  const outcome = await sendFiredTurn({ session: target, eventBus, firedMessage: buildFiredMessage(schedule) });
  if (outcome === "refused") drop(`conversation ${targetId}'s model cannot run on this box`);
  else if (outcome === "failed" && !registry.deletion.isBlocked(targetId)) drop(`the turn in conversation ${targetId} failed`);
}
