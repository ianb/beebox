/**
 * Deliver one person's message into a resolved chat — the body of
 * `POST /api/chat/send` after target and identity resolution.
 *
 * The route and `quickChat` both send through the one sender that
 * `routes/chat/register.ts` creates per box, so they share one durable
 * message-id claim map and one in-flight table: a message id sent through
 * either path is posted once (docs/plans/box-screen.md, track 1).
 */

import { randomUUID } from "node:crypto";
import { acquireBoxWork } from "../../../lib/box-maintenance.js";
import { errorMessage } from "../../../shared/error-guards.js";
import type { SendOutcome, UserMessageSender } from "../../chat-runtime.js";
import type { ChatRoutesContext } from "./context.js";
import { type TurnCapture, captureTurn, startAckedRun } from "./send-run.js";
import { type InFlightSends, claimMessageId, recordDurableClaim } from "./send-dedup.js";
import { buildSendInput, injectUserAttr } from "./helpers.js";

export function createUserMessageSender(
  deps: Pick<ChatRoutesContext, "boxRoot" | "eventBus" | "registry" | "scheduleManager" | "wireSession" | "processedMessageIds"> & {
    inFlightSends: InFlightSends;
  },
): UserMessageSender {
  const { boxRoot, eventBus, registry, scheduleManager, wireSession, processedMessageIds, inFlightSends } = deps;
  return async ({ target, message, messageId, user, channel, images, cardFields }) => {
    const { session: chatSession, id: knownId } = target;
    wireSession(chatSession);
    // Slash commands (e.g. /compact) are parsed by the claude CLI when they
    // appear at the very start of the user text — any prefix/suffix would
    // break detection, so skip user-attr and pending-schedules injection.
    const isSlashCommand = message.startsWith("/");
    const attributed = user && !isSlashCommand ? injectUserAttr(message, user) : message;

    // Deduplicate retries: a duplicate either shares the in-flight request's
    // outcome or is answered `deduplicated: true` from the durable claim —
    // never from this process's volatile claim alone (see send-dedup.ts).
    const claim = messageId ? claimMessageId({ messageId, processedMessageIds, inFlightSends }) : null;
    if (claim !== null && claim.kind === "duplicate") return claim.outcome;
    // `respond` gives the volatile claim back with this request's real outcome.
    // EVERY exit below goes through it — a claim left unsettled would park each
    // duplicate send for this id until its client gave up.
    let settleInFlight = claim === null ? null : claim.settle;
    const respond = (outcome: SendOutcome): SendOutcome => {
      if (settleInFlight !== null) {
        settleInFlight(outcome);
        settleInFlight = null;
      }
      return outcome;
    };

    // Everything from here to the ack runs under the volatile claim, so an
    // unexpected throw (a bus listener, a registry call) must settle it before
    // it escapes — otherwise every duplicate and retry for this id parks on a
    // promise nobody resolves, which is worse than the 500 itself. The capture
    // is failed too when one exists: the pin it holds would otherwise keep the
    // session alive with no turn to finish.
    let capture: TurnCapture | null = null;
    try {
      // Broadcast the user message to other clients via the event bus. This is a
      // *persisted* event — the user's turn in the conversation history — and
      // recording it IS acceptance: it happens on both paths immediately before
      // the ack, whether the message was queued or is about to be handed to the
      // engine. A run that then fails to start no longer contradicts it: the
      // failure reaches the client on the turn stream instead of as a 500 that
      // invited a retry which recorded the message a second time
      // (issues/bugs/2026-08-03-intermittent-spawn-ebadf-sdk-chat-run.md).
      // For pending-new sessions, sessionId is still unknown; subscribers will
      // see it once `session-assigned` fires.
      //
      // The durable claim is taken here and nowhere else, so acceptance has ONE
      // durability point: a crash before this loses the claim and the message
      // together (the client's retry runs it once), a crash after loses neither
      // (the retry is answered `deduplicated: true` and history really has it).
      // Message first, claim second — the millisecond between them can only cost
      // a duplicate, never a message the client was told the box had.
      const recordUserMessage = (): void => {
        eventBus.emit("chat-user-message", {
          sessionId: knownId,
          message: attributed,
          user: user ? { email: user.email, name: user.name } : null,
          timestamp: new Date().toISOString(),
        });
        if (messageId) recordDurableClaim(boxRoot, { messageId, processedMessageIds });
      };
      const fields = cardFields ?? {};

      // If busy, record and queue — the queue drains on the next "done", and the
      // completed turn surfaces via the chat-complete event → history refresh.
      // Record first, enqueue second: a throw while recording then leaves nothing
      // queued, so the retry that follows the 500 runs the message once instead
      // of delivering the copy this request already handed to the session.
      if (chatSession.isBusy()) {
        recordUserMessage();
        chatSession.enqueue(buildSendInput({ text: attributed, images, channel, cardFields: fields }));
        return respond({ status: 200, body: { queued: true } });
      }

      // Append active schedule info so the agent knows what's pending.
      // Skip for slash commands so they remain at the start of the text.
      const pendingInfo = isSlashCommand ? "" : scheduleManager.formatPendingForPrompt();
      const fullMessage = pendingInfo ? attributed + "\n<pending-schedules>" + pendingInfo + "</pending-schedules>" : attributed;

      // Touch + enforce the live cap + mark most-active for an already-known
      // session. (A pending "new" session has no id yet for these.)
      if (knownId !== null) {
        registry.touch(knownId, { subprocessUse: true });
        registry.enforceLiveCap(knownId);
        await registry.markMostActive(knownId).catch((e: unknown) => {
          console.error(`[chat] markMostActive(${knownId}) failed:`, e);
        });
      }
      // Pin the session for the turn's lifetime so it survives the idle sweep and
      // a concurrent send's LRU eviction. pinSession works for a pending "new"
      // session too (it carries into the entry's refCount on id promotion), which
      // a by-id pin couldn't. Released when the turn settles (see captureTurn).
      const releasePin = registry.pinSession(chatSession);

      // Wire the session's output into a resumable buffer *before* sending, so a
      // frame emitted before send() resolves (e.g. a prewarmed subprocess) isn't
      // dropped. The output flows over chat.turnStream, resumable by this turnId.
      const turnId = randomUUID();
      capture = captureTurn(chatSession, { turnId, releasePin });

      // Record, ack, THEN start the run — the busy path's shape, extended to the
      // idle one. The response means "the box durably has your message", not "the
      // engine started": a cold spawn takes minutes, and waiting for it left every
      // client (and every retry timer) parked in a pending state for that whole
      // window. The turn buffer is already wired, so no frame the run emits is
      // lost between the ack and the client's subscribe, and a start failure
      // surfaces on that stream instead of as an HTTP status
      // (see startAckedRun; docs/plans/emission-model.md, Track A).
      recordUserMessage();
      const work = await acquireBoxWork(boxRoot, { reason: "chat send" });
      startAckedRun(chatSession, {
        work,
        input: buildSendInput({ text: fullMessage, images, channel, cardFields: fields }),
        capture,
      });
      return respond({ status: 200, body: { turnId } });
    } catch (e) {
      console.error("[chat] send failed after the message id was claimed:", e);
      capture?.fail(errorMessage(e));
      if (settleInFlight !== null) {
        settleInFlight({ status: 500, body: { error: errorMessage(e) } });
        settleInFlight = null;
      }
      throw e;
    }
  };
}
