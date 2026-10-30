// # Captured content attention
//
// The optional view context describes presentation, independently of destination.
// An explicit snapshot replaces legacy companion context, including clearing it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { sendBodySchema, extractCardFields, buildSendInput } from "../../../src/webapp/routes/chat/helpers.js";
import { composeChatAppSnapshot, parseChatAppDeltas } from "../../../src/core/chat/features.js";
import { combineQueuedInputs } from "../../../src/core/chat/session/state.js";

/** The issues a rejected `safeParse` reports; `undefined` when the body parsed. */
const issuesOf = (r: ReturnType<typeof sendBodySchema.safeParse>) => r.error?.issues;
const custom = (path: string[], message: string) => ({ code: "custom" as const, path, message });

void test("line 12", async (t) => {
  const body = sendBodySchema.parse({ message: "this", session: "kitchen", contextDir: "_content/kitchen", openCard: "_content/stale.doc.card", viewContext: { surface: "card", focusedRef: "_content/house/Report.doc.card?view=chart#cost", transcript: "hidden" } });
  const fields = extractCardFields(body);
  t.check(fields, {
    viewContext: { surface: "card", focusedRef: "_content/house/Report.doc.card?view=chart#cost", transcript: "hidden" },
    openCard: "_content/house/Report.doc.card",
  });
  t.check(body, {
    message: "this",
    session: "kitchen",
    contextDir: "_content/kitchen",
    openCard: "_content/stale.doc.card",
    viewContext: { surface: "card", focusedRef: "_content/house/Report.doc.card?view=chart#cost", transcript: "hidden" },
  });

  t.check(composeChatAppSnapshot(fields), "<chat-app open-card=\"_content/house/Report.doc.card\" surface=\"card\" transcript=\"hidden\"/>");

  t.check(extractCardFields({ openCard: "_content/stale.doc.card", cardActivity: ["modified"], cardState: { modified: "stale details" }, viewContext: { surface: "dashboard", transcript: "hidden" } }), {
    viewContext: {
      surface: "dashboard",
      transcript: "hidden",
    },
  });

  t.check(composeChatAppSnapshot(extractCardFields({ openCard: "_content/Old.doc.card" })), "<chat-app open-card=\"_content/Old.doc.card\"/>");

  t.check(parseChatAppDeltas('<chat-app surface="card" transcript="visible"/>'), { deltas: [], cleaned: "" });
});

// A question beside the chat reaches the agent as the open card, like any
// card (docs/implemented-plans/questions-beside-the-chat.md, Track C). A tab from before
// that change may still send `openQuestion`; the send schema strips the
// unknown key, so the message parses and carries only `open-card`.
void test("A question beside the chat rides as open-card; a stale openQuestion is dropped", async (t) => {
  const Q = "_bookkeeping/questions/what-to-keep-track-of.question.card";
  const parsed = sendBodySchema.parse({ message: "lending", session: "new", openCard: Q, openQuestion: Q });
  const fields = extractCardFields(parsed);
  t.check(fields, { openCard: Q });
  t.check(composeChatAppSnapshot(fields), `<chat-app open-card="${Q}"/>`);
});

// Invalid URLs and hidden form data cannot become implicit context at the HTTP
// boundary. The schema strips unknown keys and rejects non-box references.
void test("Invalid URLs and hidden form data cannot become implicit context at the HTTP...", async (t) => {
  t.check(issuesOf(sendBodySchema.safeParse({ message: "hi", session: "new", viewContext: { surface: "card", focusedRef: "https://example.com/?token=secret", transcript: "hidden" } })), [custom(["viewContext", "focusedRef"], "Expected an in-box card reference")]);

  t.check(issuesOf(sendBodySchema.safeParse({ message: "hi", session: "new", viewContext: { surface: "card", focusedRef: "../../secret", transcript: "hidden" } })), [custom(["viewContext", "focusedRef"], "Expected an in-box card reference")]);

  t.check(issuesOf(sendBodySchema.safeParse({ message: "hi", session: "new", viewContext: { surface: "other", focusedRef: "_config/settings.card", transcript: "hidden" } })), [custom(["viewContext"], "Other surfaces cannot publish card context")]);

  t.check(sendBodySchema.parse({ message: "hi", session: "new", viewContext: { surface: "other", transcript: "hidden", formValue: "secret" } }), {
    message: "hi",
    session: "new",
    viewContext: { surface: "other", transcript: "hidden" },
  });
});

// A queued turn retains the last snapshot. Activity from a different subject does
// not get relabeled as activity on the current card. Text and explicit selections
// remain in the original messages.
void test("A queued turn retains the last snapshot.", async (t) => {
  const first = buildSendInput({ text: "first", images: undefined, channel: undefined, cardFields: extractCardFields({ viewContext: { surface: "card", focusedRef: "_content/A.doc.card", transcript: "visible" }, cardActivity: ["modified"], cardState: { modified: "changed A" } }) });
  const second = buildSendInput({ text: "second", images: undefined, channel: undefined, cardFields: extractCardFields({ viewContext: { surface: "card", focusedRef: "_content/B.doc.card", transcript: "hidden" }, cardActivity: ["scrolled"], cardState: { scrolled: "0.6" } }) });
  const combined = combineQueuedInputs([first, second]);
  t.check(combined, {
    text: "first\n\nsecond",
    images: [],
    viewContext: { surface: "card", focusedRef: "_content/B.doc.card", transcript: "hidden" },
    openCard: "_content/B.doc.card",
    cardActivity: ["scrolled"],
    cardState: { scrolled: "0.6" },
  });
  t.check(combineQueuedInputs([first, { text: "dashboard", viewContext: { surface: "dashboard", transcript: "hidden" } }]), {
    text: "first\n\ndashboard",
    images: [],
    viewContext: { surface: "dashboard", transcript: "hidden" },
  });
});
