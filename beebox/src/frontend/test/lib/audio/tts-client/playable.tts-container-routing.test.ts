// # TTS container routing
//
// The TTS backends disagree about container. OpenAI returns `audio/mpeg`; Gemini
// returns raw PCM that the server wraps as `audio/wav` (`services/tts.ts`).
// MediaSource plays the first and supports **no** WAV type, and appending WAV to a
// source buffer opened as `audio/mpeg` does not fail at `addSourceBuffer` — the
// element errors later with `MEDIA_ERR_SRC_NOT_SUPPORTED` and the utterance is
// silently lost. So the streaming client must decide from the response's own
// `Content-Type` rather than assuming one.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mediaTypeOf } from "../../../../src/lib/audio/tts-client/playable.js";

// ## The media type survives; other parameters do not
//
// `MediaSource.isTypeSupported` accepts a `codecs` parameter and rejects a header
// carrying anything else, so only `codecs` is kept.
void test("MediaSource.isTypeSupported accepts a codecs parameter and rejects a header c...", async (t) => {
  t.check(mediaTypeOf("audio/mpeg"), "audio/mpeg");

  t.check(mediaTypeOf("audio/wav"), "audio/wav");

  t.check(
    // A charset would make an otherwise-supported type fail the check.
    mediaTypeOf("audio/mpeg; charset=utf-8"),
    "audio/mpeg",
  );

  t.check(mediaTypeOf('audio/mp4; codecs="mp4a.40.2"'), "audio/mp4; codecs=\"mp4a.40.2\"");

  t.check(
    // A response with no Content-Type cannot claim to be streamable.
    mediaTypeOf(null),
    null,
  );

  t.check(mediaTypeOf(""), null);
});
