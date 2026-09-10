/**
 * The messages the box has accepted but cannot yet show you.
 *
 * `POST /api/chat/send` answers 200 once the message is durably recorded: it
 * emits the persisted `chat-user-message` onto the event bus and takes the
 * durable claim, and the route's own comment says *"recording it IS
 * acceptance"* (`webapp/routes/chat-send-routes.ts`). The transcript is written
 * later, by the agent subprocess, and `chat.bootstrap` — everything a freshly
 * loaded page knows — reads only the transcript.
 *
 * Between those two facts is a window where the box has told the client it has
 * the message, holds a durable record proving it, and would answer a reload
 * with a conversation that does not contain it. A live client bridges the gap
 * from memory; a reloaded one has no memory. For a message that opens a NEW
 * chat the window lasts until the engine assigns a session id — a cold spawn is
 * allowed ten minutes — so the reload lands on a blank chat with no sign the
 * message was ever sent
 * (`issues/bugs/2026-08-09-reload-loses-in-flight-question.md`).
 *
 * This reads the other record. It deliberately does NOT decide what is already
 * durable: it hands back a recent, bounded slice of what was accepted, and the
 * client retires each one as the transcript catches up, using the same
 * `reconcilePending` it already applies to its own optimistic copies
 * (`frontend/src/machines/chat-shared.ts`). One reconciliation, in one place,
 * rather than a second implementation here that could disagree with it.
 */

import type { EventBus } from "../../event-bus.js";
import { isRecord } from "../../../lib/is-record.js";
import type { SessionEntry } from "../../../cli/lib/session-entry.js";
import { userIdentity } from "../../../cli/lib/session-entry.js";

/**
 * How far back acceptance still means anything.
 *
 * Matched to `RUN_START_TIMEOUT_MS` (`webapp/routes/chat-send-run.ts`), the
 * longest a cold engine spawn is given. A message accepted longer ago than that
 * and still absent from the transcript is not pending any more — something
 * failed — and rendering it forever would be a comfortable lie rather than a
 * true "not yet". It stops being claimed instead.
 */
const ACCEPTED_WINDOW_MS = 10 * 60 * 1000;

/**
 * How many recent acceptances to consider. Far above any real burst of unsent
 * turns, and low enough that the read stays a bounded tail rather than a scan.
 */
const ACCEPTED_SCAN_LIMIT = 50;

/** `[image#N]` composer tokens, either form — see where this is applied. */
const IMAGE_TOKEN_RE = /\[image#?\d+]/g;

/**
 * An accepted message in the shape the client's pending list already takes.
 *
 * `reconcileKnownUuids` carries the entries that already existed WHEN THIS
 * MESSAGE WAS ACCEPTED, so the echo it is waiting for can only be an entry that
 * was not already there — see `history` on {@link readAcceptedMessages}.
 */
export type AcceptedMessage = SessionEntry & { reconcileKnownUuids: string[] };

/**
 * Is this bus event's session the one being asked about?
 *
 * An id-carrying row matches its own session and nothing else. A row with no id
 * matches only a bootstrap that has no session either — a send is accepted
 * before the engine assigns an id, so an unassigned message belongs to the
 * unassigned chat and to no existing one. Letting a null row match ANY session
 * (the first shape of this) would have shown a message from a brand-new chat
 * inside whatever conversation happened to be open.
 *
 * The id-less case is narrow in practice: the web client coins a session id and
 * reserves it before the first send (the frontend's
 * `components/chat/everywhere/resolve-conversation.ts`), so the URL carries a
 * real id by then. It remains for boxes that cannot coin.
 */
function matchesSession(eventSessionId: string | null, sessionId: string | null): boolean {
  if (eventSessionId === null) return sessionId === null;
  return eventSessionId === sessionId;
}

/**
 * Is this acceptance the asking user's to see?
 *
 * A row with no session cannot be told apart from another user's by session, so
 * it is told apart by who sent it. Fails closed: an identified sender is shown
 * only to that same identity, so a box where several people are each starting a
 * chat does not show them each other's unsent questions. A row with no sender
 * and a caller with no identity is the ordinary single-user or open-access box,
 * where there is nobody to keep it from.
 */
function matchesUser(rowEmail: string | null, viewerEmail: string | null): boolean {
  if (rowEmail === null) return true;
  return rowEmail === viewerEmail;
}

/**
 * A history entry as this reader needs it: what it is, and when it happened.
 *
 * Timestamps rather than uuids alone, because "already there" is a question
 * about a moment — see `history` on {@link readAcceptedMessages}.
 */
export interface HistoryMarker {
  uuid: string;
  timestamp: string;
}

/**
 * Entries that already existed when a message was accepted at `at`.
 *
 * An entry we cannot date counts as older. The echo of an acceptance is written
 * after it (the agent receives the message, then records it), so an undatable
 * entry is far more likely to be old history than the echo being waited for —
 * and treating it as a candidate would let it retire a pending message it has
 * nothing to do with.
 */
function baselineFor(history: HistoryMarker[], at: number): string[] {
  return history
    .filter((entry) => {
      const entryAt = Date.parse(entry.timestamp);
      return !Number.isFinite(entryAt) || entryAt < at;
    })
    .map((entry) => entry.uuid);
}

/**
 * Recent user messages this box accepted for `sessionId`, oldest-first.
 *
 * `now` is a parameter rather than a call to the clock so the window is
 * testable without waiting out ten minutes.
 */
export function readAcceptedMessages(
  eventBus: EventBus,
  { sessionId, now, viewerEmail, history }: {
    sessionId: string | null;
    now: Date;
    /** The asking user's identity, for the id-less rows — see {@link matchesUser}. */
    viewerEmail: string | null;
    /**
     * The history being returned alongside these, as identity plus time.
     *
     * Each accepted message gets the entries OLDER THAN ITSELF as its
     * reconciliation baseline. The baseline is what stops one of them being
     * retired by an OLD transcript entry that happens to repeat its words:
     * without it, a second "yes" in a conversation that already contains a
     * "yes" is answered by the first and vanishes on reload — the exact
     * disappearance this whole path exists to prevent.
     *
     * It has to be per-message and dated, not the whole list. Handing every
     * returned uuid to every acceptance also blacklists the message's OWN echo
     * whenever the transcript has already caught up by the time bootstrap runs
     * — which is precisely what a reload does. The pending copy then can never
     * be retired, and `reconcilePending` appends it after the server messages,
     * pinning a duplicate of the last few messages to the bottom of the chat
     * until the acceptance ages out of {@link ACCEPTED_WINDOW_MS}.
     */
    history: HistoryMarker[];
  },
): AcceptedMessage[] {
  const cutoff = now.getTime() - ACCEPTED_WINDOW_MS;
  const accepted: AcceptedMessage[] = [];
  for (const event of eventBus.readRecent({ event: "chat-user-message", limit: ACCEPTED_SCAN_LIMIT })) {
    // Bus payloads arrive `unknown` and are narrowed by the reader, the way
    // every other consumer does it — the row was already validated against the
    // `chat-user-message` schema on the way out of SQLite.
    const data = isRecord(event.data) ? event.data : {};
    const eventSessionId = typeof data["sessionId"] === "string" ? data["sessionId"] : null;
    const message = typeof data["message"] === "string" ? data["message"] : "";
    const timestamp = typeof data["timestamp"] === "string" ? data["timestamp"] : "";
    if (message === "") continue;
    if (!matchesSession(eventSessionId, sessionId)) continue;
    const rowUser = isRecord(data["user"]) ? data["user"] : null;
    const rowEmail = rowUser !== null && typeof rowUser["email"] === "string" ? rowUser["email"] : null;
    if (eventSessionId === null && !matchesUser(rowEmail, viewerEmail)) continue;
    const at = Date.parse(timestamp);
    if (!Number.isFinite(at) || at < cutoff) continue;

    // The bus carries the same attributed text the transcript will (the
    // `<typed user=… >` shell and all), which is what lets the client compare
    // the two and what lets the bubble render identically either way.
    //
    // Except for `[imageN]`: both the transcript and the client's optimistic
    // copy consume those tokens into image blocks, so their text no longer
    // holds them (`shared/chat-content-blocks.ts`). The bytes are not on the
    // bus, so there are no image blocks to make here — but the token has to go
    // the same way, or this text neither compares equal to the other two nor
    // renders without a literal "[image1]" in the bubble.
    const content = [{ type: "text" as const, text: message.replace(IMAGE_TOKEN_RE, "") }];
    const user = userIdentity(content, "user");
    const userEmail = userIdentity(content, "user-email");
    accepted.push({
      // Derived from the bus row id, so the same accepted message keeps the
      // same React key across refetches instead of remounting each time.
      uuid: `accepted-${String(event.id)}`,
      type: "user",
      timestamp,
      content,
      ...(user ? { user } : {}),
      ...(userEmail ? { userEmail } : {}),
      reconcileKnownUuids: baselineFor(history, at),
    });
  }
  return accepted;
}
