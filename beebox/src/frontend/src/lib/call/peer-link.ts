/**
 * One `RTCPeerConnection` to one other call member, negotiated with WebRTC
 * "perfect negotiation" (decisions in `negotiation.ts`). Either side may
 * renegotiate at any time (a camera turning on or off); a collision is
 * resolved by politeness, never by a retry loop.
 */

import { z } from "zod";
import { isPolite, offerDecision } from "./negotiation";
import { linkReport, type LinkReport } from "../call-state";

/** What one member sends another through `chatCall.signal`; the server never reads it. */
const signalSchema = z.union([
  z.object({ description: z.object({ type: z.enum(["offer", "answer", "pranswer", "rollback"]), sdp: z.string().optional() }) }),
  z.object({ candidate: z.object({
    candidate: z.string().optional(),
    sdpMid: z.string().nullable().optional(),
    sdpMLineIndex: z.number().nullable().optional(),
    usernameFragment: z.string().nullable().optional(),
  }).nullable() }),
]);
export type SignalData = z.infer<typeof signalSchema>;

export interface PeerLinkOptions {
  self: string;
  other: string;
  iceServers: RTCIceServer[];
  /** Make the first offer now; otherwise wait for the other side's. */
  initiate: boolean;
  local: MediaStream | null;
  send: (data: SignalData) => void;
  onReport: (report: LinkReport) => void;
  /** The other member's media; called again whenever its tracks change. */
  onRemote: (stream: MediaStream) => void;
}

export class PeerLink {
  private readonly pc: RTCPeerConnection;
  private readonly polite: boolean;
  private makingOffer = false;
  private ignoreOffer = false;
  private settingRemoteAnswer = false;
  /** The signals applied so far, in arrival order; `apply` never rejects, so the chain never breaks. */
  private applying: Promise<void> = Promise.resolve();
  private local: MediaStream | null;

  constructor(private readonly opts: PeerLinkOptions) {
    this.pc = new RTCPeerConnection({ iceServers: opts.iceServers });
    this.polite = isPolite(opts.self, opts.other);
    this.local = opts.local;
    this.pc.onnegotiationneeded = () => { void this.offer(); };
    this.pc.onicecandidate = ({ candidate }) => opts.send({ candidate: candidate === null ? null : candidate.toJSON() });
    this.pc.onconnectionstatechange = () => opts.onReport(linkReport(this.pc.connectionState));
    this.pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      const changed = () => opts.onRemote(stream);
      stream.onaddtrack = changed;
      stream.onremovetrack = changed;
      track.onunmute = changed;
      track.onmute = changed;
      changed();
    };
    if (opts.initiate) {
      // With no mic there is no track to send, but there must still be audio to receive.
      if (this.local === null || this.local.getAudioTracks().length === 0) this.pc.addTransceiver("audio", { direction: "recvonly" });
      this.syncTracks(this.local);
    }
  }

  /** Send exactly the tracks of `local`: add new ones, swap a replaced track in place, drop removed ones. */
  syncTracks(local: MediaStream | null): void {
    this.local = local;
    const tracks = local === null ? [] : local.getTracks();
    const senders = this.pc.getSenders().filter((s) => s.track !== null);
    const sent = new Set(senders.map((s) => s.track));
    const unsent = tracks.filter((t) => !sent.has(t));
    for (const sender of senders) {
      if (sender.track !== null && tracks.includes(sender.track)) continue;
      const replacement = unsent.find((t) => t.kind === sender.track?.kind);
      if (replacement === undefined) {
        this.pc.removeTrack(sender);
        continue;
      }
      unsent.splice(unsent.indexOf(replacement), 1);
      sender.replaceTrack(replacement).catch((e: unknown) => console.warn("[call] replaceTrack failed", e));
    }
    for (const track of unsent) {
      if (local !== null) this.pc.addTrack(track, local);
    }
  }

  private async offer(): Promise<void> {
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      if (this.pc.localDescription !== null) this.opts.send({ description: this.pc.localDescription.toJSON() });
    } catch (e) {
      console.warn(`[call] offer to ${this.opts.other} failed`, e);
    } finally {
      this.makingOffer = false;
    }
  }

  /**
   * Apply a signal from the other member, after every earlier one has been
   * applied: a candidate that overtook its offer's `setRemoteDescription` would
   * be rejected ("remote description was null").
   */
  receive(raw: unknown): Promise<void> {
    this.applying = this.applying.then(() => this.apply(raw));
    return this.applying;
  }

  /** One signal; a malformed one is logged and dropped. */
  private async apply(raw: unknown): Promise<void> {
    const parsed = signalSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn(`[call] dropped a malformed signal from ${this.opts.other}`);
      return;
    }
    const data = parsed.data;
    try {
      if ("description" in data) await this.onDescription(data.description);
      else if (data.candidate !== null) await this.onCandidate(data.candidate);
    } catch (e) {
      console.warn(`[call] signal from ${this.opts.other} failed`, e);
    }
  }

  private async onDescription(description: RTCSessionDescriptionInit): Promise<void> {
    const decision = description.type === "offer"
      ? offerDecision({ polite: this.polite, makingOffer: this.makingOffer, signalingState: this.pc.signalingState, settingRemoteAnswer: this.settingRemoteAnswer })
      : "accept";
    this.ignoreOffer = decision === "ignore";
    if (this.ignoreOffer) return;
    this.settingRemoteAnswer = description.type === "answer";
    try {
      await this.pc.setRemoteDescription(description);
    } finally {
      this.settingRemoteAnswer = false;
    }
    if (description.type !== "offer") return;
    // Send our tracks on the transceivers the offer created before answering it.
    this.syncTracks(this.local);
    await this.pc.setLocalDescription();
    if (this.pc.localDescription !== null) this.opts.send({ description: this.pc.localDescription.toJSON() });
  }

  private async onCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (e) {
      // A candidate for an offer this side ignored is expected to fail.
      if (!this.ignoreOffer) throw e;
    }
  }

  close(): void {
    this.pc.close();
  }
}
