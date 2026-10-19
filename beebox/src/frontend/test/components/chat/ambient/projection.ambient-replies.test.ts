// # Ambient reply identity and attention
//
// A completion event is a refresh signal, not answer content. Only a complete
// persisted assistant group supplies a stable preview. Bounded tails must not
// interpret an arbitrary suffix as a whole callout.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { projectAmbientReply, observeAmbientReply, EMPTY_ATTENTION } from "../../../../src/components/chat/ambient/projection.js";
import type { SessionEntry } from "../../../../../cli/lib/session-entry.js";

function entry({ uuid, type, text }: { uuid: string; type: "user" | "assistant"; text: string }): SessionEntry {
  return { uuid, type, timestamp: "2026-09-07T00:00:00Z", content: [{ type: "text", text }] };
}
const question = entry({ uuid: "u1", type: "user", text: "Compare these" });
const answer = entry({ uuid: "a1", type: "assistant", text: '<callout context="Comparison">See [report](view:report.doc.card)</callout>' });

void test("line 17", async (t) => {
  // doctest:L18
  const full = projectAmbientReply("kitchen", { entries: [question, answer], total: 2, running: false });
  t.check([full.identity, full.complete, full.callouts.length], [
    "kitchen:a1",
    true,
    1,
  ]);

  // doctest:L22
  t.check(projectAmbientReply("kitchen", { entries: [question, answer], total: 2, running: true }).complete, false);

  // doctest:L25
  const suffix = projectAmbientReply("kitchen", { entries: [answer], total: 20, running: false });
  t.check([suffix.complete, suffix.identity, suffix.callouts.length, suffix.earlier], [
    true,
    null,
    0,
    true,
  ]);

  // doctest:L29
  t.check(projectAmbientReply("kitchen", { entries: [question, entry({ uuid: "", type: "assistant", text: "Legacy answer" })], total: 2, running: false }).identity, null);

  // doctest:L32
  t.check(projectAmbientReply("kitchen", { entries: [question], total: 1, running: false }).complete, false);
});

// Old history establishes a baseline. A new reply needs attention; another new
// reply never acknowledges its predecessor. Explicit dismissal only acknowledges
// the current identity, and another session cannot share that identity.
void test("Old history establishes a baseline.", async (t) => {
  // doctest:L41
  const baseline = observeAmbientReply(EMPTY_ATTENTION, "kitchen:a1");
  t.check(baseline.attention, false);

  // doctest:L45
  const changed = observeAmbientReply(baseline, "kitchen:a2");
  t.check(changed.attention, true);

  // doctest:L49
  t.check(observeAmbientReply(changed, null).attention, true);

  // doctest:L52
  const dismissed = { ...changed, attention: false, dismissedReply: changed.lastReply };
  t.check(observeAmbientReply(dismissed, "kitchen:a2").attention, false);

  // doctest:L56
  t.check(observeAmbientReply(dismissed, "kitchen:a3").attention, true);

  // doctest:L59
  t.check(projectAmbientReply("garden", { entries: [question, answer], total: 2, running: false }).identity, "garden:a1");
});

// Replayed completion events never revive dismissed notices, including empty
// outcomes without assistant UUIDs.
void test("Replayed completion events never revive dismissed notices, including empty ou...", async (t) => {
  // doctest:L67
  const { recordAmbientCompletion } = await import("../../../../src/components/chat/ambient/projection.js");
  const completed = recordAmbientCompletion(EMPTY_ATTENTION, "completion-one");
  const acknowledged = { ...completed, attention: false };
  t.check(recordAmbientCompletion(acknowledged, "completion-one").attention, false);

  // doctest:L73
  t.check(recordAmbientCompletion(acknowledged, "completion-two").attention, true);
});

// A route may show the retained previous transcript while a new landmark resolves.
// That transition must not acknowledge the previous conversation's reply.
void test("A route may show the retained previous transcript while a new landmark resolves.", async (t) => {
  // doctest:L81
  const { canAcknowledgeAmbientReply } = await import("../../../../src/components/chat/ambient/projection.js");
  t.check(["resolving", "unavailable", "ready"].map(kind => canAcknowledgeAmbientReply(true, kind)), [
    false,
    false,
    true,
  ]);

  // doctest:L85
  t.check(canAcknowledgeAmbientReply(false, "ready"), false);
});
