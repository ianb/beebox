// # ChatTarget — status mapping + restore planning
//
// `chatTargetStatus` (docs/plans/input-extraction.md, chunk 3) maps the chat
// machine's busy signals onto the target's status vocabulary; `planRestore`
// is the pure half of what happens when a dispatched emission comes back
// `rejected` — putting it back into the composer rather than losing it to
// the error banner. Both are framework-free (no React/DOM), so they're
// testable headlessly; `applyRestorePlan` runs against a real (also
// framework-free) emission store below; `acceptEmission` threads a `send`
// function and is covered by typecheck + manual verification instead.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { chatTargetStatus, planRestore, applyRestorePlan } from "../../../src/input/targets/chat-target.js";
import { createTypedEmission, createVoiceEmission } from "../../../src/input/emission.js";
import { createEmissionStore } from "../../../src/input/emission-store.js";
import type { EmissionDraft } from "../../../src/input/emission-store.js";

const emptyDraft: EmissionDraft = { text: "", images: [], pendingImages: 0, files: [], selections: [], uploadBatch: null };

// ## chatTargetStatus: idle -> ready, streaming or backend-busy -> busy
void test("chatTargetStatus: idle -> ready, streaming or backend-busy -> busy", async (t) => {
  t.check(chatTargetStatus({ isStreaming: false, processBusy: false }), {
    state: "ready",
  });

  t.check(chatTargetStatus({ isStreaming: true, processBusy: false }), {
    state: "busy",
    disposition: "will-queue",
  });

  t.check(chatTargetStatus({ isStreaming: false, processBusy: true }), {
    state: "busy",
    disposition: "will-queue",
  });
});

// Note: `unavailable` is part of the wider Target vocabulary but chat has no
// session-gone state that produces it today, so `chatTargetStatus` never
// returns it — there's no example for it here on purpose.
//
// ## planRestore: empty composer gets the rejected emission back verbatim
//
// The emission's text already carries its `[imageN]`/`[fileN]`/`[selectionN]`
// tokens, so an empty composer's restore is just "put the text back" — no
// re-insertion.
void test("Note:", async (t) => {
  const e = createTypedEmission({
    text: "look at [image1]",
    images: [{ id: 1, mimeType: "image/png", dataBase64: "aGk=" }],
    files: [],
    selections: [],
  });
  const plan = planRestore(emptyDraft, e);
  t.check(plan, {
    text: "look at [image1]",
    images: [
      {
        id: 1,
        mimeType: "image/png",
        dataBase64: "aGk=",
      },
    ],
    files: [],
    selections: [],
  });

  // ## planRestore: keyword control tags never reach the composer
  //
  // A rejected voice-keyword send carries its control tag in the emission text
  // (`<send-message phrase="..." />` and friends). The tag is a marker for the
  // persisted message record, not composer content, so the restore strips it —
  // every action's tag, which is also what keeps this pattern in sync with
  // `ACTION_TAG_NAMES` in `speech-keywords.ts`.

  const tagged = createVoiceEmission({
    text: 'remember the milk <send-message phrase="Send message" />',
    selections: [],
    diarized: false,
  });
  t.check(planRestore(emptyDraft, tagged), {
    text: "remember the milk",
    images: [],
    files: [],
    selections: [],
  });

  const allTags = [
    '<send-message phrase="Send message" />',
    '<send-close-message phrase="Send and close" />',
    '<send-checkpoint-message phrase="Send checkpoint" />',
    '<cancel-message phrase="Cancel message" />',
    '<mic-off phrase="Microphone off" />',
    '<erase-message phrase="Clear &quot;this&quot; message" />',
  ].join(" ");
  const swept = createVoiceEmission({ text: `keep this ${allTags}`, selections: [], diarized: false });
  t.check(planRestore(emptyDraft, swept), {
    text: "keep this",
    images: [],
    files: [],
    selections: [],
  });

  // Only voice emissions strip — the keyword pipeline is the only thing that
  // puts a tag into voice text. A TYPED message restores verbatim, so someone
  // literally typing a tag (discussing the markup) keeps their text:

  const typed = createTypedEmission({
    text: 'the composer leaked <erase-message phrase="Clear message" /> today',
    images: [],
    files: [],
    selections: [],
  });
  t.check(planRestore(emptyDraft, typed), {
    text: "the composer leaked <erase-message phrase=\"Clear message\" /> today",
    images: [],
    files: [],
    selections: [],
  });
});

// ## planRestore: text already typed appends after a newline instead of clobbering it
void test("planRestore: text already typed appends after a newline instead of clobbering it", async (t) => {
  const typedOverDraft = { ...emptyDraft, text: "meanwhile" };
  const voice = createVoiceEmission({ text: "add milk to the list", selections: [], diarized: false });
  const plan2 = planRestore(typedOverDraft, voice);
  t.check(plan2, {
    text: "meanwhile\nadd milk to the list",
    images: [],
    files: [],
    selections: [],
  });

  // ## planRestore: attachments/selections always re-added regardless of composer text

  const sel = [{ id: 1, ref: "/_content/notes/Bread.doc.card", text: "let it rise", position: "body" }];
  const e2 = createTypedEmission({ text: "note: [selection1]", images: [], files: [{ id: 1, path: "_tmp/report.pdf" }], selections: sel });
  const plan3 = planRestore(typedOverDraft, e2);
  t.check(plan3, {
    text: "meanwhile\nnote: [selection1]",
    images: [],
    files: [
      {
        id: 1,
        path: "_tmp/report.pdf",
      },
    ],
    selections: [
      {
        id: 1,
        ref: "/_content/notes/Bread.doc.card",
        text: "let it rise",
        position: "body",
      },
    ],
  });
});

// ## applyRestorePlan: restored ids are reserved, so new items can't collide
//
// The send that got rejected already `reset()` the store, dropping the id
// counters back to 1. The restored items keep their original ids (the text
// still carries the matching tokens), so the counters must advance past
// them — otherwise the next pasted image would mint a duplicate `[image1]`.
void test("The send that got rejected already reset() the store, dropping the id counter...", async (t) => {
  const store = createEmissionStore();
  store.editor.setText("was typing"); // simulates typing after the failed send
  const failed = createTypedEmission({
    text: "see [image1] and [image2]",
    images: [
      { id: 1, mimeType: "image/png", dataBase64: "aGk=" },
      { id: 2, mimeType: "image/png", dataBase64: "aG8=" },
    ],
    files: [{ id: 1, path: "_tmp/report.pdf" }],
    selections: [{ id: 3, ref: "/x.card", text: "t", position: "body", anchor: null, spokenWords: null }],
  });
  applyRestorePlan(store.editor, planRestore(store.get(), failed));
  t.check(store.get(), {
    text: "was typing\nsee [image1] and [image2]",
    images: [
      {
        id: 1,
        mimeType: "image/png",
        dataBase64: "aGk=",
        objectUrl: "data:image/png;base64,aGk=",
        byteLength: 3,
        original: {
          status: "failed",
          message: "Original not uploaded — the agent sees the reduced copy only",
        },
      },
      {
        id: 2,
        mimeType: "image/png",
        dataBase64: "aG8=",
        objectUrl: "data:image/png;base64,aG8=",
        byteLength: 3,
        original: {
          status: "failed",
          message: "Original not uploaded — the agent sees the reduced copy only",
        },
      },
    ],
    pendingImages: 0,
    files: [
      {
        id: 1,
        originalName: "report.pdf",
        size: 0,
        mimetype: "application/octet-stream",
        state: {
          status: "uploaded",
          path: "_tmp/report.pdf",
        },
      },
    ],
    selections: [
      {
        id: 3,
        ref: "/x.card",
        text: "t",
        position: "body",
        anchor: null,
        spokenWords: null,
      },
    ],
    uploadBatch: null,
  });

  t.check(
    // Fresh ids start past the restored ones — no [image1]/[file1]/[selection3] duplicates.
    [store.editor.nextImageId(), store.editor.nextFileId(), store.editor.nextSelectionId()],
    [3, 2, 4],
  );
});

// ## applyRestorePlan: a restored image keeps its landed original, or is marked lost
//
// A rejected send hands its images back through the emission, which carries a
// `path` only for an original that landed. That path is restored as `uploaded`,
// so the retry lists the same file line; an image with no path has no `File`
// to retry from, so it comes back `failed` and the message goes out with the
// pixels only.
void test("A rejected send hands its images back through the emission, which carries a p...", async (t) => {
  const store = createEmissionStore();
  const e = createTypedEmission({
    text: "receipt [image#1] and [image#2]",
    images: [
      { id: 1, mimeType: "image/jpeg", dataBase64: "AA", path: "_tmp/a.jpg" },
      { id: 2, mimeType: "image/png", dataBase64: "BB" },
    ],
    files: [], selections: [],
  });
  applyRestorePlan(store.editor, planRestore(emptyDraft, e));
  t.check(store.get(), {
    text: "receipt [image#1] and [image#2]",
    images: [
      {
        id: 1,
        mimeType: "image/jpeg",
        dataBase64: "AA",
        objectUrl: "data:image/jpeg;base64,AA",
        byteLength: 1,
        original: {
          status: "uploaded",
          path: "_tmp/a.jpg",
        },
      },
      {
        id: 2,
        mimeType: "image/png",
        dataBase64: "BB",
        objectUrl: "data:image/png;base64,BB",
        byteLength: 1,
        original: {
          status: "failed",
          message: "Original not uploaded — the agent sees the reduced copy only",
        },
      },
    ],
    pendingImages: 0,
    files: [],
    selections: [],
    uploadBatch: null,
  });
});
