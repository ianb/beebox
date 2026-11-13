/**
 * Shapes shared by chat presence and calls (docs/chat-presence.md,
 * docs/chat-calls.md). Everything here is in memory only.
 */

/** A person present in a chat, as other people in it see them. */
export interface PresentPerson {
  email: string;
  name: string;
}

/** `others` is everyone present except the subscriber. */
export interface OthersFrame {
  t: "others";
  people: PresentPerson[];
}

/** The chat's call as people present see it. */
export interface CallSummary {
  callId: string;
  /** One entry per person on the call, earliest first. */
  members: PresentPerson[];
  transcribing: boolean;
  /** Real wall-clock ms, never the box's simulated clock. */
  startedAt: number;
}
export interface CallFrame {
  t: "call";
  call: CallSummary | null;
}

/** A frame on the `chatPresence.watch` stream; a client switches on `t`. */
export type ChatPresenceFrame = OthersFrame | CallFrame;

/** One subscription on a call, as the other members address it. */
export interface CallPeer {
  peerId: string;
  person: PresentPerson;
}

/** `no-answer`: nobody joined in time. */
export type CallEndReason = "no-answer";

/** A frame on the `chatCall.join` stream. */
export type CallMemberFrame =
  /** First frame: this subscription's peer id, and the server's real clock for the skew check. */
  | { t: "joined"; callId: string; peerId: string; serverNowMs: number }
  /** Every member, this one included, in join order; sent on every change. */
  | { t: "state"; members: CallPeer[]; transcribing: boolean }
  /** An opaque WebRTC payload from another member. */
  | { t: "signal"; from: string; data: unknown }
  /** The call is over; the stream ends after it. */
  | { t: "ended"; reason: CallEndReason }
  /** The call already has its cap of members; the stream ends after it. */
  | { t: "full" };

export const CALL_MEMBER_CAP = 3;
export const NO_ANSWER_MS = 45_000;

/** What an observer (the call transcript fold) learns about a call. */
export interface CallSnapshot {
  boxRoot: string;
  sessionId: string;
  callId: string;
  startedAt: number;
  startedBy: PresentPerson;
  members: CallPeer[];
  transcribing: boolean;
}
export type CallChange =
  | { kind: "started" }
  | { kind: "members" }
  | { kind: "transcribing"; by: PresentPerson; atMs: number }
  | { kind: "ended" };

export interface ChatPresenceOptions {
  /** Told of every call change, after the members are; errors are logged. */
  onCallChange?: (snapshot: CallSnapshot, change: CallChange) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => () => void;
  newId?: () => string;
}

export type CallJoinResult =
  | { ok: true; callId: string; peerId: string; leave: () => void }
  | { ok: false; reason: "full" | "no-call" };

/** Which call member a request comes from: its peer id, and the person it must belong to. */
export interface MemberRef {
  boxRoot: string;
  sessionId: string;
  callId: string;
  peerId: string;
  email: string;
}

export interface ChatPresence {
  /**
   * Join a chat's room as a watcher. `onFrame` is called at once with everyone
   * else present and the room's call, and again whenever either changes.
   * Returns `leave`, which is idempotent.
   */
  join(opts: { boxRoot: string; sessionId: string; person: PresentPerson; onFrame: (frame: ChatPresenceFrame) => void }): () => void;
  /**
   * Join the room's call, starting one when there is none and `callId` is null.
   * A null `callId` joins the call already going, so two people pressing call at
   * once land in one call. `send` receives this member's frames, starting with
   * `joined`; `leave` is idempotent.
   */
  joinCall(opts: { boxRoot: string; sessionId: string; callId: string | null; person: PresentPerson; send: (frame: CallMemberFrame) => void }): CallJoinResult;
  /** Forward `data` from member `from` to `to` in the same call. False when `from` is not the caller's or `to` is not a member. */
  signal(from: MemberRef, opts: { to: string; data: unknown }): boolean;
  /** Turn transcription on or off for the whole call. False when `member` is not the caller's. */
  setTranscribing(member: MemberRef, on: boolean): boolean;
  /** The call `member` is on, as an observer sees it; null when `member` is not the caller's. */
  callOf(member: MemberRef): CallSnapshot | null;
  /** Leave the call. False when `member` is not the caller's. */
  leaveCall(member: MemberRef): boolean;
  /** How many rooms have a watcher or a call. */
  size(): number;
}
