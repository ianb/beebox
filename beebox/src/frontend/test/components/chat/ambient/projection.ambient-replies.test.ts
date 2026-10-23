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
  const full = projectAmbientReply("kitchen", { entries: [question, answer], total: 2, running: false });
  t.check([full.identity, full.complete, full.callouts.length], [
    "kitchen:a1",
    true,
    1,
  ]);

  t.check(projectAmbientReply("kitchen", { entries: [question, answer], total: 2, running: true }).complete, false);

  const suffix = projectAmbientReply("kitchen", { entries: [answer], total: 20, running: false });
  t.check([suffix.complete, suffix.identity, suffix.callouts.length, suffix.earlier], [
    true,
    null,
    0,
    true,
  ]);

  t.check(projectAmbientReply("kitchen", { entries: [question, entry({ uuid: "", type: "assistant", text: "Legacy answer" })], total: 2, running: false }).identity, null);

  t.check(projectAmbientReply("kitchen", { entries: [question], total: 1, running: false }).complete, false);
});

// Old history establishes a baseline. A new reply needs attention; another new
// reply never acknowledges its predecessor. Explicit dismissal only acknowledges
// the current identity, and another session cannot share that identity.
void test("Old history establishes a baseline.", async (t) => {
  const baseline = observeAmbientReply(EMPTY_ATTENTION, "kitchen:a1");
  t.check(baseline.attention, false);

  const changed = observeAmbientReply(baseline, "kitchen:a2");
  t.check(changed.attention, true);

  t.check(observeAmbientReply(changed, null).attention, true);

  const dismissed = { ...changed, attention: false, dismissedReply: changed.lastReply };
  t.check(observeAmbientReply(dismissed, "kitchen:a2").attention, false);

  t.check(observeAmbientReply(dismissed, "kitchen:a3").attention, true);

  t.check(projectAmbientReply("garden", { entries: [question, answer], total: 2, running: false }).identity, "garden:a1");
});

// Replayed completion events never revive dismissed notices, including empty
// outcomes without assistant UUIDs.
void test("Replayed completion events never revive dismissed notices, including empty ou...", async (t) => {
  const { recordAmbientCompletion } = await import("../../../../src/components/chat/ambient/projection.js");
  const completed = recordAmbientCompletion(EMPTY_ATTENTION, "completion-one");
  const acknowledged = { ...completed, attention: false };
  t.check(recordAmbientCompletion(acknowledged, "completion-one").attention, false);

  t.check(recordAmbientCompletion(acknowledged, "completion-two").attention, true);
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

// The selected conversation gets an ambient panel while its transcript is off screen
// (focus layout, cards in both panes), and none while the transcript shows.
void test("The selected conversation gets an ambient panel only while its transcript is off screen.", async (t) => {
  const { ambientPanelHidden } = await import("../../../../src/components/chat/ambient/projection.js");
  const reply = { attention: true, busy: false, error: false };
  t.check(ambientPanelHidden({ selected: true, transcriptVisible: false, ...reply }), false);
  t.check(ambientPanelHidden({ selected: true, transcriptVisible: true, ...reply }), true);
  // A running turn shows the panel too, so a send made while the transcript is hidden is acknowledged:
  t.check(ambientPanelHidden({ selected: true, transcriptVisible: false, attention: false, busy: true, error: false }), false);
  // Another conversation is unaffected by transcript visibility; with nothing to report it stays hidden:
  t.check(ambientPanelHidden({ selected: false, transcriptVisible: true, ...reply }), false);
  t.check(ambientPanelHidden({ selected: true, transcriptVisible: false, attention: false, busy: false, error: false }), true);
});

// A plain-text reply (no callout or ack) is previewed as its own persisted text,
// so a selected chat with its transcript hidden shows what the agent said.
void test("A plain-text reply is previewed as its own text.", async (t) => {
  const ok = entry({ uuid: "a2", type: "assistant", text: "Ok." });
  t.check(projectAmbientReply("chat", { entries: [question, ok], total: 2, running: false }).preview, "Ok.");
  t.check(projectAmbientReply("chat", { entries: [question, ok], total: 2, running: true }).preview, "");
  t.check(projectAmbientReply("chat", { entries: [question, answer], total: 2, running: false }).preview, "");
});
