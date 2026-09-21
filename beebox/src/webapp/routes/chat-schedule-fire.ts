/**
 * Firing a chat `<schedule>` back into the session that created it.
 *
 * A schedule records the id of the session whose turn emitted it
 * (`schedule.sessionId`); when the timer fires we resume THAT session and
 * inject the reminder, so the reply lands in the originating conversation
 * rather than whatever chat was last active. Legacy entries persisted before
 * this field existed have no `sessionId` and fall back to the most-active
 * session.
 *
 * If the targeted session can't run its turn — a pre-v2 session id the SDK
 * refuses to resume errors instantly (`is_error=true`, `num_turns=0`) — the
 * reminder is re-sent once into a brand-new session, so a fired schedule's
 * response is never silently lost.
 *
 * The failed-turn signal is the session's existing `done` event: its payload
 * is the terminal `ChatMessageResult`, whose `is_error` distinguishes a
 * completed turn from the unresumable one. No new surface is needed — a run
 * that instead closes/errors without a result counts as a failed delivery too.
 */

import { ProviderSetupError } from "../../core/provider-setup-error.js";
import { BoxMaintenanceError } from "../../lib/box-maintenance-error.js";
import type { ChatSession } from "../../core/chat/session/index.js";
import type { ChatMessageResult } from "../../core/chat/session/messages.js";
import type { ChatSessionRegistry } from "../../core/chat/session/registry.js";
import { getMostActive } from "../../core/chat/session/history.js";
import { chatHistorySlice } from "../../core/chat/session/load-history.js";
import type { EventBus } from "../../core/event-bus.js";
import type { ChatSchedule } from "../../core/chat/schedules.js";
import { resolveSessionAvailability } from "../../core/chat/session/availability.js";
import { resolveChatTarget } from "../../core/chat/session/target.js";

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
 * before a result — a false is the caller's cue to try a fresh session.
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
    void session.send(firedMessage).then((sent) => {
      if (!sent) finish("failed");
    }).catch((error: unknown) => {
      if (error instanceof BoxMaintenanceError) reject(error);
      else console.error("[schedule] Send failed:", error);
      finish("failed");
    });
  });
}

/**
 * Fire a chat schedule: broadcast the alarm/TTS event, then inject the reminder
 * into the originating session (or the most-active one for a legacy entry),
 * with a one-shot fresh-session fallback when the target can't run its turn.
 */
export async function fireChatSchedule(deps: ScheduleFireDeps, schedule: ChatSchedule): Promise<void> {
  const { boxRoot, registry, eventBus, wireSession } = deps;

  if (schedule.sessionId !== undefined && registry.deletion.isBlocked(schedule.sessionId)) return;

  // Alarm/TTS broadcast stays first, before any session work.
  eventBus.emit("schedule-fired", {
    id: schedule.id,
    label: schedule.label,
    alarm: schedule.alarm,
    announce: schedule.announce,
  });

  const firedMessage = buildFiredMessage(schedule);

  // Target the originating session; legacy entries (no sessionId) fall back to
  // the most-active session, preserving the old behavior.
  let targetId = schedule.sessionId ?? null;
  if (targetId === null) {
    targetId = await getMostActive(boxRoot);
    if (targetId === null) {
      console.warn("[schedule] No most-active session, dropping fire");
      return;
    }
  }

  const availability = await resolveSessionAvailability({
    boxRoot,
    sessionId: targetId,
    registry,
  });
  if (availability.kind === "unavailable") {
    console.warn(`[schedule] Session ${targetId} is unavailable locally; using a fresh session`);
    const { session: fresh } = await resolveChatTarget({ boxRoot, registry }, { kind: "fresh" });
    wireSession(fresh);
    await sendFiredTurn({ session: fresh, eventBus, firedMessage });
    return;
  }

  const target = registry.getOrCreate(targetId);
  wireSession(target);
  registry.enforceLiveCap(targetId);
  registry.touch(targetId, { subprocessUse: true });
  const outcome = await sendFiredTurn({
    session: target,
    eventBus,
    firedMessage,
  });
  if (outcome === "delivered") return;
  if (outcome === "refused") {
    console.warn(`[schedule] Session ${targetId}'s model cannot run on this box; dropping schedule "${schedule.label}"`);
    return;
  }
  if (registry.deletion.isBlocked(targetId)) return;

  // Fresh-session fallback: the target couldn't run its turn (e.g. an
  // unresumable pre-v2 session). Re-send once into a brand-new session so the
  // fired schedule's response is never silently lost.
  console.warn(`[schedule] Fired turn failed for session ${targetId}; retrying in a fresh session`);
  const { session: fresh } = await resolveChatTarget({ boxRoot, registry }, { kind: "fresh" });
  wireSession(fresh);
  const retried = await sendFiredTurn({
    session: fresh,
    eventBus,
    firedMessage,
  });
  if (retried !== "delivered") {
    console.error(`[schedule] Fresh-session retry also failed for schedule "${schedule.label}"; giving up`);
  }
}
