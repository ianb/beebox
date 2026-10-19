// # A typed send keeps its captured conversation through upload waits
//
// The real typed-submit coordinator captures before awaiting uploads and clears
// only after a durable dispatch. The injected dispatcher represents the pinned
// controller handle; its destination is chosen at capture, not at receipt time.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { submitTypedDraft } from "../../../src/components/chat/conversation/typed-submit.js";
import { createEmissionStore } from "../../../src/input/emission-store.js";
import { boundTurnFields } from "../../../src/machines/chatMachine/chat-bound-turn.js";
import type { EmissionDispatch } from "../../../src/components/chat/conversation/use-bound-emission/hook.js";
import type { Emission } from "../../../src/input/emission.js";
import type { Receipt } from "../../../src/input/targets/receipts.js";
import type { AttentionSnapshot } from "../../../../shared/chat-composer-binding.js";
import { captureVoiceSend } from "../../../src/components/chat/conversation/capture-voice-send.js";

/** A complete dispatch handle around `send`; only `release` is observable here. */
function dispatchOf(send: (emission: Emission) => Promise<Receipt>, release: () => void): EmissionDispatch {
  return Object.assign(send, { stage() {}, release, currentSessionId: () => null, assignedSessionId: async () => "session" });
}

// ## Voice capture refusal preserves the utterance and settles the mic path

// ## Navigate while uploading, then type a new draft before the late receipt
void test("Navigate while uploading, then type a new draft before the late receipt", async (t) => {
  // doctest:L25
  const store = createEmissionStore();
  store.editor.setText("Compare this quote");
  let selected = "kitchen";
  let releaseUpload = () => {};
  const uploads = new Promise<void>((resolve) => { releaseUpload = resolve; });
  let destination = "";
  let committedText = "";
  let releaseReceipt = () => {};
  const receipt = new Promise<Receipt>((resolve) => { releaseReceipt = () => resolve({ disposition: "sent", emissionId: "m", deduplicated: false }); });
  const work = submitTypedDraft({
    emissionStore: store,
    capture: () => {
      const captured = selected;
      return dispatchOf((emission) => {
        destination = captured;
        committedText = emission.text;
        return receipt;
      }, () => {});
    },
    awaitUploads: () => uploads,
    onCommitted: () => store.editor.setText(""),
    onReceipt() {},
  });
  selected = "garden";
  store.editor.setText("Compare this quote and its warranty");
  releaseUpload();
  await work;
  store.editor.setText("A new garden question");
  releaseReceipt();
  await receipt;
  t.check({ destination, committedText, draft: store.get().text }, {
    destination: "kitchen",
    committedText: "Compare this quote and its warranty",
    draft: "A new garden question",
  });
});

// ## Storage refusal preserves the whole draft and releases the pinned controller
void test("Storage refusal preserves the whole draft and releases the pinned controller", async (t) => {
  // doctest:L62
  const store = createEmissionStore();
  store.editor.setText("Keep this text");
  let released = false;
  let cleared = false;
  const reason = await submitTypedDraft({
      emissionStore: store,
      capture: () => dispatchOf(() => { throw new DOMException("Full", "QuotaExceededError"); }, () => { released = true; }),
      awaitUploads: async () => {},
      onCommitted() { cleared = true; },
      onReceipt() {},
    }).then(() => "", (error) => error.name);
  t.check({ draft: store.get().text, released, cleared, reason }, {
    draft: "Keep this text",
    released: true,
    cleared: false,
    reason: "QuotaExceededError",
  });
});

// ## Both HTTP paths use the immutable destination and independent attention
//
// The same projection is applied last by the streaming and queued POST sites.
// Existing targets request exact delivery; fresh Codex targets retain their
// engine and directory without pretending they have a reserved ID.
void test("The same projection is applied last by the streaming and queued POST sites.", async (t) => {
  // doctest:L84
  const attention: AttentionSnapshot = { surface: "card", transcript: "hidden", focusedRef: "/house/report.doc.card" };
  t.check(boundTurnFields({ boxSlug: "test1", target: { kind: "session", sessionId: "kitchen", contextDir: "kitchen" }, attention }), {
    session: "kitchen",
    exactSession: true,
    viewContext: {
      surface: "card",
      transcript: "hidden",
      focusedRef: "/house/report.doc.card",
    },
  });

  // doctest:L88
  t.check(boundTurnFields({ boxSlug: "test1", target: { kind: "start", clientConversationId: "client-start", contextDir: "garden", engine: "codex", model: "model-test" }, attention }), {
    session: "new",
    exactSession: false,
    contextDir: "garden",
    engine: "codex",
    model: "model-test",
    viewContext: {
      surface: "card",
      transcript: "hidden",
      focusedRef: "/house/report.doc.card",
    },
  });
});

void test("Voice capture refusal preserves the utterance and settles the mic path", async (t) => {
  // doctest:L99
  const store = createEmissionStore();
  store.editor.setText("Earlier draft");
  let micSettled = false;
  const captured = await captureVoiceSend({
    capture: () => { throw new DOMException("Conversation is resolving", "InvalidStateError"); },
    awaitUploads: async () => {}, readDraft: store.get,
    preserve: () => store.editor.setText(`${store.get().text} spoken utterance`),
    refused() { micSettled = true; },
  });
  t.check({ captured, text: store.get().text, micSettled }, {
    captured: null,
    text: "Earlier draft spoken utterance",
    micSettled: true,
  });
});

// ## An upload failure releases the voice capture before keeping its text
void test("An upload failure releases the voice capture before keeping its text", async (t) => {
  // doctest:L115
  const store = createEmissionStore();
  let released = false;
  let refused = false;
  const captured = await captureVoiceSend({
    capture: () => dispatchOf(async () => ({ disposition: "sent", emissionId: "m", deduplicated: false }), () => { released = true; }),
    awaitUploads: async () => { throw new DOMException("Upload failed", "NetworkError"); },
    readDraft: store.get,
    preserve: () => store.editor.setText("Spoken text"),
    refused() { refused = true; },
  });
  t.check({ captured, text: store.get().text, released, refused }, {
    captured: null,
    text: "Spoken text",
    released: true,
    refused: true,
  });
});
