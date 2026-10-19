// # Delivered user-message codec
//
// `DeliveredUserMessage` is the closed set of first-class user messages that the
// server delivers as pseudo-XML. Each kind must serialize, parse from persisted
// transcript text, and render through an exhaustive frontend dispatch.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  DELIVERED_USER_MESSAGE_KINDS,
  parseDeliveredUserMessageParts,
  serializeDeliveredUserMessage,
  type DeliveredUserMessage,
  type DeliveredUserMessageKind,
  type DeliveredUserMessagePart,
} from "../../src/shared/delivered-user-message.js";

const fixtures = {
  capture: {
    kind: "capture",
    doc: "tmp-capture/x.capture-session.card",
    images: 2,
    audio: "0:00",
    summary: "Two reference photos.",
    partial: false,
    transcriptionFailed: false,
  },
  upload: {
    kind: "upload",
    doc: "tmp-upload/b/Batch.upload-batch.card",
    files: 3,
    bytes: "2 KB",
    failed: 0,
    note: "Reference documents.",
    summary: "3 files uploaded (2 KB).",
  },
} satisfies { [K in DeliveredUserMessageKind]: Extract<DeliveredUserMessage, { kind: K }> };

const captureWire = serializeDeliveredUserMessage(fixtures.capture);
const uploadWire = serializeDeliveredUserMessage(fixtures.upload);

function partSummary(parts: DeliveredUserMessagePart[]) {
  return parts.map((part) => part.kind === "text"
    ? { kind: part.kind, text: part.text }
    : { kind: part.kind, doc: part.doc });
}

function serializedFixtures(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fixtures).map(([kind, message]) => [kind, serializeDeliveredUserMessage(message)]),
  );
}

function parsedFixtures(): Record<string, DeliveredUserMessagePart[]> {
  return Object.fromEntries(
    Object.entries(fixtures).map(([kind, message]) => [
      kind,
      parseDeliveredUserMessageParts(serializeDeliveredUserMessage(message)),
    ]),
  );
}

/** Each fixture serialized, parsed, and serialized again; undefined unless it parses to one chip. */
function roundTrippedFixtures(): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(fixtures).map(([kind, message]) => {
      const parts = parseDeliveredUserMessageParts(serializeDeliveredUserMessage(message));
      const parsed = parts.length === 1 ? parts.at(0) : undefined;
      return [kind, parsed !== undefined && parsed.kind !== "text" ? serializeDeliveredUserMessage(parsed) : undefined];
    }),
  );
}

// ## Every kind has canonical wire bytes and parses back to the same model
//
// The fixture record documents one canonical example per current kind. Source
// typechecking enforces the codec registry, serializer, and renderer dispatch;
// this doctest pins their runtime wire behavior. Canonical wire models preserve
// values such as `audio="0:00"`; the chip decides whether that value is visually
// omitted.
void test("The fixture record documents one canonical example per current kind.", async (t) => {
  t.check(serializedFixtures(), {
    capture: `<capture doc="tmp-capture/x.capture-session.card" images="2" audio="0:00">
Two reference photos.
</capture>`,
    upload: `<upload doc="tmp-upload/b/Batch.upload-batch.card" files="3" bytes="2 KB">
Reference documents.

3 files uploaded (2 KB).
</upload>`,
  });

  t.check(parsedFixtures(), {
    capture: [
      {
        kind: "capture",
        doc: "tmp-capture/x.capture-session.card",
        images: 2,
        audio: "0:00",
        summary: "Two reference photos.",
        partial: false,
        transcriptionFailed: false,
      },
    ],
    upload: [
      {
        kind: "upload",
        doc: "tmp-upload/b/Batch.upload-batch.card",
        files: 3,
        bytes: "2 KB",
        failed: 0,
        note: "Reference documents.",
        summary: "3 files uploaded (2 KB).",
      },
    ],
  });

  const kinds: string[] = [...DELIVERED_USER_MESSAGE_KINDS].toSorted();
  t.check(kinds, Object.keys(fixtures).toSorted());

  t.check(roundTrippedFixtures(), serializedFixtures());
});

// The serializer rejects every delimiter that would truncate a `doc` attribute.
void test("The serializer rejects every delimiter that would truncate a doc attribute.", async (t) => {
  await t.checkThrows(async () => (serializeDeliveredUserMessage({ ...fixtures.capture, doc: "tmp-capture/bad>path.card" })), "InvariantError");
});

// ## Persisted turns include a display-only `<chat-app>` snapshot
//
// This sanitized fixture has the exact structure observed in a real session
// JSONL: the snapshot is prepended to an otherwise ordinary delivered capture.
// The codec removes that display-only tag before it finds message blocks.
void test("This sanitized fixture has the exact structure observed in a real session JSONL:", async (t) => {
  const persisted = '<chat-app narration="off" prose="on" local-time="Tuesday 2026-08-04 13:42 CDT (afternoon)"/>\n' + captureWire;
  t.check(partSummary(parseDeliveredUserMessageParts(persisted)), [{ kind: "capture", doc: "tmp-capture/x.capture-session.card" }]);
});

// ## Queue-combined text and multiple deliveries remain in source order
//
// `ChatSession` joins queued sends with blank lines. The parser emits every
// structured block and preserves all surrounding user-visible text.
void test("ChatSession joins queued sends with blank lines.", async (t) => {
  const combined = "Please keep these together.\n\n" + captureWire + "\n\n" + uploadWire + "\n\nThen compare them.";
  t.check(partSummary(parseDeliveredUserMessageParts(combined)), [{ kind: "text", text: "Please keep these together.\n\n" }, { kind: "capture", doc: "tmp-capture/x.capture-session.card" }, { kind: "text", text: "\n\n" }, { kind: "upload", doc: "tmp-upload/b/Batch.upload-batch.card" }, { kind: "text", text: "\n\nThen compare them." }]);
});

// ## Invalid blocks stay visible without hiding later valid blocks
//
// A known tag with no `doc` is not a chip. Its bytes remain text, and scanning
// continues so a later valid delivery still renders structurally.
void test("A known tag with no doc is not a chip.", async (t) => {
  const malformed = '<capture images="1" audio="0:05">\nbroken\n</capture>';
  t.check(partSummary(parseDeliveredUserMessageParts(malformed + "\n\n" + uploadWire)), [{ kind: "text", text: "<capture images=\"1\" audio=\"0:05\">\nbroken\n</capture>\n\n" }, { kind: "upload", doc: "tmp-upload/b/Batch.upload-batch.card" }]);
});

// ## Prose mentions and unknown tags are ordinary text
//
// Only standalone registered blocks become structured parts. A same-line wrapper
// mention and an unknown future-looking tag stay literal.
void test("Only standalone registered blocks become structured parts.", async (t) => {
  const mention = "see this: " + captureWire;
  t.check(partSummary(parseDeliveredUserMessageParts(mention)), [{ kind: "text", text: "see this: <capture doc=\"tmp-capture/x.capture-session.card\" images=\"2\" audio=\"0:00\">\nTwo reference photos.\n</capture>" }]);

  const unknown = "<new-delivery doc=\"x.card\">\nhello\n</new-delivery>";
  t.check(partSummary(parseDeliveredUserMessageParts(unknown)), [{ kind: "text", text: "<new-delivery doc=\"x.card\">\nhello\n</new-delivery>" }]);
});

// ## A rejected opener cannot hide a later valid delivery
//
// After rejecting a prose opener, scanning resumes inside the rejected span so a
// later standalone block still becomes a chip. A malformed standalone opener is
// also rejected when it would otherwise swallow a nested delivered block.
void test("After rejecting a prose opener, scanning resumes inside the rejected span so...", async (t) => {
  const proseOpener = "does the <capture> tag work?\n\n" + captureWire;
  t.check(partSummary(parseDeliveredUserMessageParts(proseOpener)), [{ kind: "text", text: "does the <capture> tag work?\n\n" }, { kind: "capture", doc: "tmp-capture/x.capture-session.card" }]);

  const unterminated = '<capture doc="broken.card">\nunfinished\n\n' + captureWire;
  t.check(partSummary(parseDeliveredUserMessageParts(unterminated)), [{ kind: "text", text: "<capture doc=\"broken.card\">\nunfinished\n\n" }, { kind: "capture", doc: "tmp-capture/x.capture-session.card" }]);
});
