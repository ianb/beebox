/**
 * Who offers to whom, and what to do when two offers cross: the decisions of
 * WebRTC "perfect negotiation"
 * (https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation),
 * kept pure so they are tested without a browser.
 */

import type { CallPeer } from "@core/chat/presence/types.js";

/** In each pair, the lexically smaller peer id is polite: it yields when offers collide. */
export function isPolite(self: string, other: string): boolean {
  return self < other;
}

/**
 * Whether `self` makes the first offer to `other`: the member who joined
 * later does. The earlier member opens its side when that offer arrives, so
 * the common case has no collision at all.
 */
export function initiatesTo(members: readonly CallPeer[], { self, other }: { self: string; other: string }): boolean {
  const ids = members.map((m) => m.peerId);
  return ids.indexOf(self) > ids.indexOf(other);
}

/** After a membership change: the connections to open now, and those to close. */
export function memberChanges(opts: { members: readonly CallPeer[]; self: string; open: ReadonlySet<string> }): { connect: string[]; close: string[] } {
  const { members, self, open } = opts;
  const ids = new Set(members.map((m) => m.peerId));
  const connect = members
    .map((m) => m.peerId)
    .filter((id) => id !== self && !open.has(id) && initiatesTo(members, { self, other: id }));
  const close = [...open].filter((id) => !ids.has(id));
  return { connect, close };
}

/**
 * What to do with an incoming offer. It collides when this side is mid-offer
 * or not stable (unless it is only applying a remote answer). The impolite
 * side ignores a colliding offer and waits for its own to be answered; the
 * polite side accepts it, and setting it rolls its own offer back.
 */
export function offerDecision(opts: {
  polite: boolean;
  makingOffer: boolean;
  signalingState: RTCSignalingState;
  settingRemoteAnswer: boolean;
}): "accept" | "ignore" {
  const ready = !opts.makingOffer && (opts.signalingState === "stable" || opts.settingRemoteAnswer);
  return !ready && !opts.polite ? "ignore" : "accept";
}
