// # Capture message chip parser
//
// `parseCaptureWrapper` is the single-wrapper compatibility helper used by the
// capture dev harness. Production transcript rendering uses the shared ordered-
// parts parser so text can surround the chip. `captureChipLabel` builds the
// one-line "Capture — N photos, M:SS audio" label. Both are pure — the wrapper
// string is a chat-vocabulary lock-in, so these are asserted against the exact
// output of `buildCaptureWrapper`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { parseCaptureWrapper, captureChipLabel } from "../../../src/components/chat/capture-message.js";
import { buildCaptureWrapper } from "../../../../core/capture/prepare/deliver.js";
import assert from "node:assert/strict";

/** Parse a wrapper that must be a capture. */
function chipOf(wrapper: string) {
  const model = parseCaptureWrapper(wrapper);
  assert.ok(model);
  return model;
}

// ## The exact wrapper from `buildCaptureWrapper` round-trips into the chip model
void test("The exact wrapper from `buildCaptureWrapper` round-trips into the chip model", async (t) => {
  const wrapper = buildCaptureWrapper({
    docPath: "tmp-capture/capture-20260709T1432-ab3f.capture-session.card",
    imageCount: 3,
    audioSeconds: 250,
    summary: "Walked through the kitchen.",
  });
  t.check(parseCaptureWrapper(wrapper), {
    doc: "tmp-capture/capture-20260709T1432-ab3f.capture-session.card",
    images: 3,
    audio: "4:10",
    summary: "Walked through the kitchen.",
    partial: false,
    transcriptionFailed: false,
  });

  // The chip label reads the counts:

  t.check(captureChipLabel(chipOf(wrapper)), "Capture — 3 photos, 4:10 audio");
});

// ## `partial` and `transcription-failed` flags parse to booleans
void test("`partial` and `transcription-failed` flags parse to booleans", async (t) => {
  const wrapper = buildCaptureWrapper({
    docPath: "tmp-capture/x.capture-session.card",
    imageCount: 1,
    audioSeconds: 5,
    summary: "hi",
    partial: true,
    transcriptionFailed: true,
  });
  const model = chipOf(wrapper);
  t.check(model, {
    doc: "tmp-capture/x.capture-session.card",
    images: 1,
    audio: "0:05",
    summary: "hi",
    partial: true,
    transcriptionFailed: true,
  });

  t.check(captureChipLabel(model), "Capture — 1 photo, 0:05 audio");
});

// ## A photos-only capture drops the audio segment (0:00 → no audio label)
void test("A photos-only capture drops the audio segment (0:00 → no audio label)", async (t) => {
  const wrapper = buildCaptureWrapper({
    docPath: "tmp-capture/x.capture-session.card",
    imageCount: 2,
    audioSeconds: 0,
    summary: "2 photos",
  });
  const model = chipOf(wrapper);
  t.check(model, {
    doc: "tmp-capture/x.capture-session.card",
    images: 2,
    audio: "0:00",
    summary: "2 photos",
    partial: false,
    transcriptionFailed: false,
  });
  t.check(captureChipLabel(model), "Capture — 2 photos");
});

// ## Non-capture text is not a capture
void test("Non-capture text is not a capture", async (t) => {
  t.check(parseCaptureWrapper("just a normal message"), null);

  t.check(parseCaptureWrapper("<capture images=\"1\">no doc attr</capture>"), null);
});

// ## The compatibility helper accepts exactly one wrapper
//
// The compatibility helper returns one model or `null`, so surrounding whitespace
// is tolerated but surrounding visible text is rejected. The production
// transcript parser does not have this restriction: it returns ordered text and
// capture parts without swallowing either.
void test("The compatibility helper returns one model or null, so surrounding whitespace...", async (t) => {
  const wrapper = buildCaptureWrapper({
    docPath: "tmp-capture/x.capture-session.card",
    imageCount: 1,
    audioSeconds: 5,
    summary: "hi",
  });

  // Surrounding whitespace still parses, to the same model.
  t.check(parseCaptureWrapper("\n\n" + wrapper + "\n"), parseCaptureWrapper(wrapper));

  t.check(
    // Leading prose cannot reduce to one compatibility model.
    parseCaptureWrapper("see this: " + wrapper),
    null,
  );

  t.check(
    // Neither can trailing prose.
    parseCaptureWrapper(wrapper + " what do you think?"),
    null,
  );
});
