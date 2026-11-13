// # Who offers, and who yields when offers cross
//
// Perfect negotiation (docs/plans/chat-calls.md, Track C): the smaller peer id
// is polite; the member who joined later makes the first offer; a colliding
// offer is ignored by the impolite side and accepted by the polite one.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { initiatesTo, isPolite, memberChanges, offerDecision } from "../../../src/lib/call/negotiation.js";

const person = { email: "x@example.com", name: "X" };
const members = ["peer-b", "peer-a", "peer-c"].map((peerId) => ({ peerId, person }));

void test("politeness is decided by peer id, the same on both sides", (t) => {
  t.check([isPolite("peer-a", "peer-b"), isPolite("peer-b", "peer-a")], [true, false]);
  t.end();
});

void test("the later member offers first; members who left are closed", (t) => {
  t.check([initiatesTo(members, { self: "peer-c", other: "peer-b" }), initiatesTo(members, { self: "peer-b", other: "peer-c" })], [true, false]);
  t.check(memberChanges({ members, self: "peer-c", open: new Set(["peer-b", "peer-gone"]) }), { connect: ["peer-a"], close: ["peer-gone"] });
  t.check(memberChanges({ members, self: "peer-b", open: new Set() }), { connect: [], close: [] });
  t.end();
});

void test("glare: an offer arriving mid-offer is ignored by the impolite side only", (t) => {
  const colliding = { makingOffer: true, signalingState: "have-local-offer", settingRemoteAnswer: false } as const;
  t.check(offerDecision({ ...colliding, polite: false }), "ignore");
  t.check(offerDecision({ ...colliding, polite: true }), "accept");
  t.check(offerDecision({ polite: false, makingOffer: false, signalingState: "stable", settingRemoteAnswer: false }), "accept");
  // Applying a remote answer is not a collision.
  t.check(offerDecision({ polite: false, makingOffer: false, signalingState: "have-local-offer", settingRemoteAnswer: true }), "accept");
  t.end();
});
