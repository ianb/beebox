// # Captured content attention
//
// The optional view context describes presentation, independently of destination.
// An explicit snapshot replaces legacy companion context, including clearing it.

import { test } from "tap";
import "agent-doctest/tap";
import { sendBodySchema, extractCardFields, buildSendInput } from "../../../src/webapp/routes/chat/helpers.js";
import { composeChatAppSnapshot, parseChatAppDeltas } from "../../../src/core/chat/features.js";
import { combineQueuedInputs } from "../../../src/core/chat/session/state.js";

void test("line 12", async (t) => {
  // doctest:L13
  const body = sendBodySchema.parse({ message: "this", session: "kitchen", contextDir: "_content/kitchen", openCard: "_content/stale.doc.card", viewContext: { surface: "card", focusedRef: "_content/house/Report.doc.card?view=chart#cost", transcript: "hidden" } });
  const fields = extractCardFields(body);
  t.check(fields.openCard, "_content/house/Report.doc.card");

  // doctest:L18
  t.check(body.contextDir, "_content/kitchen");

  // doctest:L21
  t.check(composeChatAppSnapshot(fields), "<chat-app open-card=\"_content/house/Report.doc.card\" surface=\"card\" transcript=\"hidden\"/>");

  // doctest:L24
  t.check(extractCardFields({ openCard: "_content/stale.doc.card", cardActivity: ["modified"], cardState: { modified: "stale details" }, viewContext: { surface: "dashboard", transcript: "hidden" } }), {
    viewContext: {
      surface: "dashboard",
      transcript: "hidden",
    },
  });

  // doctest:L27
  t.check(composeChatAppSnapshot(extractCardFields({ openCard: "_content/Old.doc.card" })), "<chat-app open-card=\"_content/Old.doc.card\"/>");

  // doctest:L30
  await t.checkText(parseChatAppDeltas('<chat-app surface="card" transcript="visible"/>').deltas.length, "0");
});

// Invalid URLs and hidden form data cannot become implicit context at the HTTP
// boundary. The schema strips unknown keys and rejects non-box references.
void test("Invalid URLs and hidden form data cannot become implicit context at the HTTP...", async (t) => {
  // doctest:L38
  t.check(
    sendBodySchema.safeParse({ message: "hi", session: "new", viewContext: { surface: "card", focusedRef: "https://example.com/?token=secret", transcript: "hidden" } }).success
    ,
    false,
  );

  // doctest:L41
  t.check(sendBodySchema.safeParse({ message: "hi", session: "new", viewContext: { surface: "card", focusedRef: "../../secret", transcript: "hidden" } }).success, false);

  // doctest:L44
  t.check(sendBodySchema.safeParse({ message: "hi", session: "new", viewContext: { surface: "other", focusedRef: "_config/settings.card", transcript: "hidden" } }).success, false);

  // doctest:L47
  t.check(sendBodySchema.parse({ message: "hi", session: "new", viewContext: { surface: "other", transcript: "hidden", formValue: "secret" } }).viewContext, {
    surface: "other",
    transcript: "hidden",
  });
});

// A queued turn retains the last snapshot. Activity from a different subject does
// not get relabeled as activity on the current card. Text and explicit selections
// remain in the original messages.
void test("A queued turn retains the last snapshot.", async (t) => {
  // doctest:L56
  const first = buildSendInput({ text: "first", images: undefined, channel: undefined, cardFields: extractCardFields({ viewContext: { surface: "card", focusedRef: "_content/A.doc.card", transcript: "visible" }, cardActivity: ["modified"], cardState: { modified: "changed A" } }) });
  const second = buildSendInput({ text: "second", images: undefined, channel: undefined, cardFields: extractCardFields({ viewContext: { surface: "card", focusedRef: "_content/B.doc.card", transcript: "hidden" }, cardActivity: ["scrolled"], cardState: { scrolled: "0.6" } }) });
  const combined = combineQueuedInputs([first, second]);
  t.check(combined.cardActivity, [
    "scrolled",
  ]);

  // doctest:L62
  t.check(combined.cardState, {
    scrolled: "0.6",
  });

  // doctest:L65
  t.check(combined.viewContext, {
    surface: "card",
    focusedRef: "_content/B.doc.card",
    transcript: "hidden",
  });

  // doctest:L68
  t.check(combineQueuedInputs([first, { text: "dashboard", viewContext: { surface: "dashboard", transcript: "hidden" } }]).openCard, undefined);
});
