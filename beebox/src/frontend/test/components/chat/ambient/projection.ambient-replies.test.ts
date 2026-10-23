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
  t.check(projectAmbientReply("kitchen", { entries: [question, answer], total: 2, running: false }), {
    identity: "kitchen:a1",
    complete: true,
    earlier: false,
    callouts: [{ context: "Comparison", body: "See [report](view:report.doc.card)" }],
    acks: [],
  });

  // The same transcript while the run is still going is not a reply yet:
  t.check(projectAmbientReply("kitchen", { entries: [question, answer], total: 2, running: true }), { identity: null, complete: false, earlier: false, callouts: [], acks: [] });

  // A bounded tail that cut the question: complete, but no identity and no callouts.
  t.check(projectAmbientReply("kitchen", { entries: [answer], total: 20, running: false }), { identity: null, complete: true, earlier: true, callouts: [], acks: [] });

  // A legacy assistant entry with no uuid has nothing stable to name:
  t.check(projectAmbientReply("kitchen", { entries: [question, entry({ uuid: "", type: "assistant", text: "Legacy answer" })], total: 2, running: false }), { identity: null, complete: true, earlier: true, callouts: [], acks: [] });

  t.check(projectAmbientReply("kitchen", { entries: [question], total: 1, running: false }), { identity: null, complete: false, earlier: false, callouts: [], acks: [] });
});

// Old history establishes a baseline. A new reply needs attention; another new
// reply never acknowledges its predecessor. Explicit dismissal only acknowledges
// the current identity, and another session cannot share that identity.
void test("Old history establishes a baseline.", async (t) => {
  const baseline = observeAmbientReply(EMPTY_ATTENTION, "kitchen:a1");
  t.check(baseline, { initialized: true, lastCompletion: null, lastReply: "kitchen:a1", attention: false, dismissedReply: null });

  const changed = observeAmbientReply(baseline, "kitchen:a2");
  t.check(changed, { initialized: true, lastCompletion: null, lastReply: "kitchen:a2", attention: true, dismissedReply: null });

  // A refresh with no reply keeps the last reply and its attention:
  t.check(observeAmbientReply(changed, null), { initialized: true, lastCompletion: null, lastReply: "kitchen:a2", attention: true, dismissedReply: null });

  const dismissed = { ...changed, attention: false, dismissedReply: changed.lastReply };
  t.check(observeAmbientReply(dismissed, "kitchen:a2"), { initialized: true, lastCompletion: null, lastReply: "kitchen:a2", attention: false, dismissedReply: "kitchen:a2" });

  t.check(observeAmbientReply(dismissed, "kitchen:a3"), { initialized: true, lastCompletion: null, lastReply: "kitchen:a3", attention: true, dismissedReply: "kitchen:a2" });

  t.check(projectAmbientReply("garden", { entries: [question, answer], total: 2, running: false }).identity, "garden:a1");
});

// Replayed completion events never revive dismissed notices, including empty
// outcomes without assistant UUIDs.
void test("Replayed completion events never revive dismissed notices, including empty ou...", async (t) => {
  const { recordAmbientCompletion } = await import("../../../../src/components/chat/ambient/projection.js");
  const completed = recordAmbientCompletion(EMPTY_ATTENTION, "completion-one");
  t.check(completed, { initialized: false, lastCompletion: "completion-one", lastReply: null, attention: true, dismissedReply: null });

  const acknowledged = { ...completed, attention: false };
  t.check(recordAmbientCompletion(acknowledged, "completion-one"), acknowledged);

  t.check(recordAmbientCompletion(acknowledged, "completion-two"), { initialized: false, lastCompletion: "completion-two", lastReply: null, attention: true, dismissedReply: null });
});

// A route may show the retained previous transcript while a new landmark resolves.
// That transition must not acknowledge the previous conversation's reply.
void test("A route may show the retained previous transcript while a new landmark resolves.", async (t) => {
  const { canAcknowledgeAmbientReply } = await import("../../../../src/components/chat/ambient/projection.js");
  t.check(["resolving", "unavailable", "ready"].map(kind => canAcknowledgeAmbientReply(true, kind)), [
    false,
    false,
    true,
  ]);

  t.check(canAcknowledgeAmbientReply(false, "ready"), false);
});
