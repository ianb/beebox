/**
 * This tab's call (docs/implemented-plans/chat-calls.md, Track C): local media, one
 * `PeerLink` per other member, the `chatCall.join` subscription that is this
 * tab's membership, and its own mic's recording while the call is
 * transcribed. One call per tab. The UI reads `callEngine.getSnapshot()`
 * through `useSyncExternalStore`; state transitions are `callReducer`'s.
 */

import type { CallMemberFrame } from "@core/chat/presence/types.js";
import { invariant } from "@shared/invariant";
import { trpcClient } from "../trpc/client";
import { toastError } from "../../components/ui/toast-store";
import { onPageExit } from "./page-exit";
import { errorText, leaveMembership, openMic } from "./membership";
import { startCallRecording, type CallRecording } from "./recording";
import { reportCallActive } from "./native-call-state";
import { callReducer, clockOffset, IDLE, type CallEvent, type CallUiState, type InCall, type PresenceCall } from "../call-state";
import { memberChanges } from "./negotiation";
import { PeerLink, type SignalData } from "./peer-link";

export interface CallSnapshot {
  ui: CallUiState;
  /** This tab's mic and, while on, camera. */
  local: MediaStream | null;
  /** Each other member's media, by peer id. */
  remote: ReadonlyMap<string, MediaStream>;
  /** The call in the chat this tab is present in, as `chatPresence.watch` last said; null while not present. */
  presence: PresenceCall | null;
}


class CallEngine {
  private snapshot: CallSnapshot = { ui: IDLE, local: null, remote: new Map(), presence: null };
  private readonly listeners = new Set<() => void>();
  private local: MediaStream | null = null;
  private readonly links = new Map<string, PeerLink>();
  private readonly remote = new Map<string, MediaStream>();
  private sub: { unsubscribe: () => void } | null = null;
  private iceServers: RTCIceServer[] = [];
  private recording: { trackId: string; pending: Promise<CallRecording | null> } | null = null;
  /** The mic track whose recording failed; not retried until transcription restarts or the track changes. */
  private recordingFailedFor: string | null = null;
  private unlistenPage: (() => void) | null = null;
  private starting = false;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): CallSnapshot => this.snapshot;

  private emit(): void {
    this.snapshot = { ...this.snapshot, local: this.local, remote: new Map(this.remote) };
    for (const listener of this.listeners) listener();
  }

  /** The presence subscription (`PresenceHeads`) reports the chat's call here. */
  reportPresence(presence: PresenceCall | null): void {
    this.snapshot = { ...this.snapshot, presence };
    this.emit();
  }

  /** Reduce without touching the recording; recording transitions use this. */
  private apply(event: CallEvent): void {
    this.snapshot = { ...this.snapshot, ui: callReducer(this.snapshot.ui, event) };
    this.emit();
  }

  private dispatch(event: CallEvent): void {
    this.apply(event);
    this.syncRecording();
  }

  private inCall(): InCall | null {
    const ui = this.snapshot.ui;
    return ui.phase === "joining" || ui.phase === "in-call" ? ui : null;
  }

  private micTrack(): MediaStreamTrack | null {
    return this.local?.getAudioTracks()[0] ?? null;
  }

  /** Join the chat's call, or start one when `callId` is null and none is going. */
  async start(sessionId: string, callId: string | null): Promise<void> {
    // The nav button and the bar's Join can both be pressed while the first is still asking for the mic.
    if (this.inCall() !== null || this.starting) return;
    this.starting = true;
    try {
      await this.join(sessionId, callId);
    } finally {
      this.starting = false;
    }
  }

  private async join(sessionId: string, callId: string | null): Promise<void> {
    let relay = false;
    let clockOffsetMs = 0;
    try {
      const sentAtMs = Date.now();
      const ice = await trpcClient.chatCall.iceServers.query();
      clockOffsetMs = clockOffset({ sentAtMs, receivedAtMs: Date.now(), serverNowMs: ice.serverNowMs });
      this.iceServers = ice.iceServers;
      relay = ice.relay;
    } catch (e) {
      toastError("Could not start the call.", { cause: e });
      return;
    }
    const mic = await openMic();
    this.local = mic === null ? null : new MediaStream([mic]);
    if (mic !== null) this.watchMic(mic);
    this.dispatch({ type: "start", sessionId, mic: mic === null ? "denied" : "on", relay, clockOffsetMs });
    reportCallActive(true);
    this.unlistenPage = onPageExit(() => this.leave());
    const sub = trpcClient.chatCall.join.subscribe({ sessionId, callId }, {
      // The wire marks an `unknown` field optional; a signal's data is always sent.
      onData: (frame) => {
        if (this.sub === sub) this.onFrame(frame.t === "signal" ? { ...frame, data: frame.data } : frame);
        else if (frame.t === "joined") this.leaveOrphan({ sub, sessionId, frame });
      },
      onError: (err: { message: string }) => {
        if (this.sub !== sub) return;
        console.warn(`[call] call subscription failed: ${err.message}`);
        this.dispatch({ type: "lost" });
        this.teardown();
      },
      onComplete: () => {
        if (this.sub !== sub || this.inCall() === null) return;
        this.dispatch({ type: "lost" });
        this.teardown();
      },
    });
    this.sub = sub;
  }

  /**
   * A subscription this tab left before its `joined` frame came: leave that
   * membership explicitly now that it has ids, since tRPC may have dropped the
   * early stop (docs/chat-calls.md).
   */
  private leaveOrphan(opts: { sub: { unsubscribe: () => void }; sessionId: string; frame: { callId: string; peerId: string } }): void {
    void leaveMembership({ sessionId: opts.sessionId, callId: opts.frame.callId, peerId: opts.frame.peerId }).finally(() => opts.sub.unsubscribe());
  }

  private onFrame(frame: CallMemberFrame): void {
    const before = this.inCall();
    if (frame.t === "joined" && before?.callId != null && frame.callId !== before.callId && this.sub !== null) {
      // A reconnect repeats the original join; with a null call id after a restart
      // that would start a new call nobody chose. Leave it and end here.
      const sub = this.sub;
      this.sub = null;
      this.leaveOrphan({ sub, sessionId: before.sessionId, frame });
      this.dispatch({ type: "lost" });
      this.teardown();
      return;
    }
    if (frame.t === "joined" && before?.selfPeerId != null) {
      // A reconnect rejoined the same call as a new member; the old connections belong to the old one.
      this.closeLinks([...this.links.keys()]);
    }
    this.dispatch({ type: "frame", frame });
    const call = this.inCall();
    if (call === null) {
      this.teardown();
      return;
    }
    if (frame.t === "state" && call.selfPeerId !== null) {
      const { connect, close } = memberChanges({ members: frame.members, self: call.selfPeerId, open: new Set(this.links.keys()) });
      this.closeLinks(close);
      for (const peerId of connect) this.openLink(peerId, true);
    }
    if (frame.t === "signal" && call.members.some((m) => m.peerId === frame.from)) {
      const link = this.links.get(frame.from) ?? this.openLink(frame.from, false);
      void link.receive(frame.data);
    }
  }

  private openLink(other: string, initiate: boolean): PeerLink {
    const self = this.inCall()?.selfPeerId;
    invariant(typeof self === "string", "call: a link needs this tab's peer id");
    const link = new PeerLink({
      self, other, initiate, iceServers: this.iceServers, local: this.local,
      send: (data) => this.sendSignal(other, data),
      onReport: (report) => this.dispatch({ type: "link", peerId: other, report }),
      onRemote: (stream) => {
        this.remote.set(other, stream);
        this.emit();
      },
    });
    this.links.set(other, link);
    this.dispatch({ type: "link", peerId: other, report: "connecting" });
    return link;
  }

  private closeLinks(peerIds: readonly string[]): void {
    for (const peerId of peerIds) {
      this.links.get(peerId)?.close();
      this.links.delete(peerId);
      this.remote.delete(peerId);
      this.dispatch({ type: "link", peerId, report: "closed" });
    }
  }

  private sendSignal(to: string, data: SignalData): void {
    const call = this.inCall();
    if (call?.callId == null || call.selfPeerId === null) return;
    trpcClient.chatCall.signal
      .mutate({ sessionId: call.sessionId, callId: call.callId, peerId: call.selfPeerId, to, data })
      .catch((e: unknown) => console.warn(`[call] signal to ${to} failed: ${errorText(e)}`));
  }

  private watchMic(track: MediaStreamTrack): void {
    track.addEventListener("ended", () => {
      if (this.micTrack() === track) this.dispatch({ type: "mic", mic: "lost" });
    });
  }

  private syncLinks(): void {
    for (const link of this.links.values()) link.syncTracks(this.local);
    this.emit();
  }

  toggleMute(): void {
    const mic = this.micTrack();
    if (mic === null) return;
    mic.enabled = !mic.enabled;
    this.dispatch({ type: "mic", mic: mic.enabled ? "on" : "muted" });
  }

  /** Open the mic again after it was lost or denied. */
  async retryMic(): Promise<void> {
    const mic = await openMic();
    if (mic === null || this.inCall() === null) {
      mic?.stop();
      this.dispatch({ type: "mic", mic: "denied" });
      return;
    }
    const old = this.micTrack();
    if (old !== null) {
      old.stop();
      this.local?.removeTrack(old);
    }
    this.local ??= new MediaStream();
    this.local.addTrack(mic);
    this.watchMic(mic);
    this.syncLinks();
    this.dispatch({ type: "mic", mic: "on" });
  }

  async toggleCamera(): Promise<void> {
    const video = this.local?.getVideoTracks()[0];
    if (video !== undefined) {
      video.stop();
      this.local?.removeTrack(video);
      this.syncLinks();
      this.dispatch({ type: "camera", camera: "off" });
      return;
    }
    let track: MediaStreamTrack | undefined;
    try {
      track = (await navigator.mediaDevices.getUserMedia({ video: true })).getVideoTracks()[0];
    } catch (e) {
      console.warn(`[call] camera unavailable: ${errorText(e)}`);
    }
    if (track === undefined || this.inCall() === null) {
      track?.stop();
      this.dispatch({ type: "camera", camera: "denied" });
      return;
    }
    this.local ??= new MediaStream();
    this.local.addTrack(track);
    this.syncLinks();
    this.dispatch({ type: "camera", camera: "on" });
  }

  async setTranscribing(on: boolean): Promise<void> {
    const call = this.inCall();
    if (call?.callId == null || call.selfPeerId === null) return;
    try {
      await trpcClient.chatCall.setTranscribing.mutate({ sessionId: call.sessionId, callId: call.callId, peerId: call.selfPeerId, on });
    } catch (e) {
      toastError(on ? "Could not turn transcription on." : "Could not turn transcription off.", { cause: e });
    }
  }

  /** Leave the call, or clear an ended call's message. */
  leave(): void {
    const call = this.inCall();
    if (call !== null && call.selfPeerId === null) {
      // Not joined yet: keep the subscription until `joined` names this member, then leave it (`leaveOrphan`).
      this.sub = null;
    } else if (call?.callId != null && call.selfPeerId !== null) {
      // Explicit as well as by ending the subscription: tRPC can drop an early stop.
      void leaveMembership({ sessionId: call.sessionId, callId: call.callId, peerId: call.selfPeerId });
    }
    this.teardown();
    this.dispatch({ type: "leave" });
  }

  private teardown(): void {
    this.sub?.unsubscribe();
    this.sub = null;
    this.closeLinks([...this.links.keys()]);
    for (const track of this.local?.getTracks() ?? []) track.stop();
    this.local = null;
    this.syncRecording();
    this.unlistenPage?.();
    this.unlistenPage = null;
    reportCallActive(false);
    this.emit();
  }

  /** Record this tab's own mic exactly while the call is transcribed and the mic is live. */
  private syncRecording(): void {
    const call = this.inCall();
    const mic = this.micTrack();
    if (call?.transcribing !== true) this.recordingFailedFor = null;
    const want = call !== null && call.transcribing && mic !== null && mic.readyState === "live" && this.recordingFailedFor !== mic.id;
    const current = this.recording;
    if (current !== null && (!want || current.trackId !== mic.id)) {
      this.recording = null;
      void current.pending.then((rec) => rec?.stop()).then(
        () => {
          if (this.recording === null) this.apply({ type: "recording", recording: { state: "off" } });
        },
        (e: unknown) => this.apply({ type: "recording", recording: { state: "failed", message: errorText(e) } }),
      );
    }
    if (!want || this.recording !== null || call.callId === null || call.selfPeerId === null || call.clockOffsetMs === null) return;
    const trackId = mic.id;
    const entry = {
      trackId,
      pending: startCallRecording({
        stream: new MediaStream([mic]), sessionId: call.sessionId, callId: call.callId, peerId: call.selfPeerId, clockOffsetMs: call.clockOffsetMs,
      }).then(
        (rec) => {
          this.apply({ type: "recording", recording: { state: "on" } });
          return rec;
        },
        (e: unknown) => {
          console.warn(`[call] recording failed: ${errorText(e)}`);
          this.recordingFailedFor = trackId;
          if (this.recording === entry) this.recording = null;
          this.apply({ type: "recording", recording: { state: "failed", message: errorText(e) } });
          return null;
        },
      ),
    };
    this.recording = entry;
  }
}

export const callEngine = new CallEngine();
