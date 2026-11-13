/**
 * This tab's call, as the call bar shows it (docs/implemented-plans/chat-calls.md, Track C).
 * A pure reducer: the engine (`call/engine.ts`) feeds it the server's frames
 * and what the browser reports about media and connections.
 */

import type { CallMemberFrame, CallPeer, CallSummary } from "@core/chat/presence/types.js";

/**
 * Mirrors `CALL_MEMBER_CAP` in `core/chat/presence/types.ts`; a backend value
 * cannot be imported here until it moves to `src/shared/`.
 */
export const CALL_MEMBER_CAP = 3;

/** Why a connection to one member failed: no relay was configured, or the path failed anyway. */
export type FailCause = "no-relay" | "failed";
export type PeerLink = { state: "connecting" } | { state: "connected" } | { state: "failed"; cause: FailCause };

/** `lost`: the mic track ended (unplugged, taken by another app). `denied`: no mic; the person can still listen. */
export type MicState = "on" | "muted" | "denied" | "lost";
export type CameraState = "off" | "on" | "denied";
export type RecordingState = { state: "off" } | { state: "on" } | { state: "failed"; message: string };

/** `no-answer`: nobody joined in time. `full`: the call has its cap. `gone`: the call ended before this tab got in, or the connection to the box dropped. */
export type CallEndReason = "no-answer" | "full" | "gone";

export type CallUiState =
  | { phase: "idle" }
  | { phase: "ended"; sessionId: string; reason: CallEndReason }
  | {
    phase: "joining" | "in-call";
    sessionId: string;
    /** Null until the `joined` frame. */
    callId: string | null;
    selfPeerId: string | null;
    /** This device's real clock minus the server's at join. */
    clockOffsetMs: number | null;
    /** Every member, this tab included, in join order. */
    members: CallPeer[];
    /** Whether anyone else has been on the call: alone before that is ringing, after it is waiting. */
    everJoined: boolean;
    links: Record<string, PeerLink>;
    mic: MicState;
    camera: CameraState;
    transcribing: boolean;
    recording: RecordingState;
    /** Whether the ICE servers include a TURN relay; names the cause of a failed connection. */
    relay: boolean;
  };

export type InCall = Extract<CallUiState, { phase: "joining" | "in-call" }>;

/** What the browser reports about a peer connection, narrowed to what the bar shows. */
export type LinkReport = "connecting" | "connected" | "failed" | "closed";

export type CallEvent =
  | { type: "start"; sessionId: string; mic: MicState; relay: boolean; clockOffsetMs: number }
  | { type: "frame"; frame: CallMemberFrame }
  | { type: "link"; peerId: string; report: LinkReport }
  | { type: "mic"; mic: MicState }
  | { type: "camera"; camera: CameraState }
  | { type: "recording"; recording: RecordingState }
  /** The subscription failed or the server closed it without an `ended` frame. */
  | { type: "lost" }
  | { type: "leave" };

export const IDLE: CallUiState = { phase: "idle" };

function onFrame(state: InCall, { frame }: { frame: CallMemberFrame }): CallUiState {
  switch (frame.t) {
    case "joined":
      // A reconnect joins again as a new member, so what the old one knew is dropped.
      return { ...state, phase: "in-call", callId: frame.callId, selfPeerId: frame.peerId, members: [], links: {} };
    case "state": {
      const ids = new Set(frame.members.map((m) => m.peerId));
      const links = Object.fromEntries(Object.entries(state.links).filter(([id]) => ids.has(id)));
      const others = frame.members.filter((m) => m.peerId !== state.selfPeerId);
      return { ...state, members: frame.members, links, transcribing: frame.transcribing, everJoined: state.everJoined || others.length > 0 };
    }
    case "signal":
      return state;
    case "ended":
      // A join that never got in found the call already over.
      return { phase: "ended", sessionId: state.sessionId, reason: state.selfPeerId === null ? "gone" : frame.reason };
    case "full":
      return { phase: "ended", sessionId: state.sessionId, reason: "full" };
  }
}

function linkFor(report: Exclude<LinkReport, "closed">, relay: boolean): PeerLink {
  if (report === "failed") return { state: "failed", cause: relay ? "failed" : "no-relay" };
  return { state: report };
}

export function callReducer(state: CallUiState, event: CallEvent): CallUiState {
  if (event.type === "start") {
    return {
      phase: "joining", sessionId: event.sessionId, callId: null, selfPeerId: null, clockOffsetMs: event.clockOffsetMs, members: [],
      everJoined: false, links: {}, mic: event.mic, camera: "off", transcribing: false, recording: { state: "off" }, relay: event.relay,
    };
  }
  if (event.type === "leave") return IDLE;
  if (state.phase === "idle" || state.phase === "ended") return state;
  switch (event.type) {
    case "frame":
      return onFrame(state, event);
    case "link": {
      const { [event.peerId]: _dropped, ...rest } = state.links;
      if (event.report === "closed") return { ...state, links: rest };
      return { ...state, links: { ...rest, [event.peerId]: linkFor(event.report, state.relay) } };
    }
    case "mic":
      return { ...state, mic: event.mic };
    case "camera":
      return { ...state, camera: event.camera };
    case "recording":
      return { ...state, recording: event.recording };
    case "lost":
      return { phase: "ended", sessionId: state.sessionId, reason: "gone" };
  }
}

/** Map `RTCPeerConnection.connectionState`; `disconnected` often recovers, so it reads as connecting. */
export function linkReport(state: RTCPeerConnectionState): LinkReport {
  switch (state) {
    case "new":
    case "connecting":
    case "disconnected":
      return "connecting";
    case "connected":
      return "connected";
    case "failed":
      return "failed";
    case "closed":
      return "closed";
  }
}

/** The call in the chat this tab is present in, as the presence channel reports it. */
export interface PresenceCall {
  sessionId: string;
  call: CallSummary | null;
}

/** What the phone button beside the presence heads offers: start a call, join the one going, or nothing. */
export function callOffer(opts: { others: number; presence: PresenceCall | null; ui: CallUiState; selfEmail: string | null }): "start" | "join" | null {
  const { others, presence, ui, selfEmail } = opts;
  if (others === 0 || presence === null || ui.phase === "joining" || ui.phase === "in-call") return null;
  const call = presence.call;
  if (call === null) return "start";
  if (call.members.some((m) => m.email === selfEmail) || call.members.length >= CALL_MEMBER_CAP) return null;
  return "join";
}

export type CallBarView =
  | { kind: "none" }
  /** A call this tab is not on. `ringing`: only its starter is on it. */
  | { kind: "ringing" | "going"; callId: string; people: string[]; transcribing: boolean; full: boolean }
  /** This person is on the call from another tab or device. */
  | { kind: "other-tab"; transcribing: boolean }
  | { kind: "in-call"; call: InCall }
  | { kind: "ended"; reason: CallEndReason };

/** What the call bar in chat `sessionId` shows. This tab's own call shows in any chat. */
export function callBarView(opts: { ui: CallUiState; presence: PresenceCall | null; sessionId: string | null; selfEmail: string | null }): CallBarView {
  const { ui, presence, sessionId, selfEmail } = opts;
  if (ui.phase === "joining" || ui.phase === "in-call") return { kind: "in-call", call: ui };
  if (ui.phase === "ended" && ui.sessionId === sessionId) return { kind: "ended", reason: ui.reason };
  const call = presence !== null && presence.sessionId === sessionId ? presence.call : null;
  if (call === null) return { kind: "none" };
  if (call.members.some((m) => m.email === selfEmail)) return { kind: "other-tab", transcribing: call.transcribing };
  return {
    kind: call.members.length === 1 ? "ringing" : "going",
    callId: call.callId,
    people: call.members.map((m) => m.name),
    transcribing: call.transcribing,
    full: call.members.length >= CALL_MEMBER_CAP,
  };
}

/**
 * This device's clock minus the server's, from one timed round trip: the
 * server read its clock somewhere between sending and receiving, so the
 * midpoint stands for that moment. Network delay alone never reads as skew.
 * Only used to flag skew over a second; device clocks are never corrected.
 */
export function clockOffset(opts: { sentAtMs: number; receivedAtMs: number; serverNowMs: number }): number {
  return Math.round((opts.sentAtMs + opts.receivedAtMs) / 2 - opts.serverNowMs);
}
